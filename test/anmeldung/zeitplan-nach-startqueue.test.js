import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "../pg-helpers.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const STRIPE_PFAD = "/webhooks/stripe";
const HTTP_NICHT_GEFUNDEN = 404;
const HTTP_NICHT_ANGEMELDET = 401;

async function verdrahten({ zeitplan, zahlung }) {
  const { store, runner } = await makePgTestStore();
  const app = express();
  const stumm = [mock.method(console, "log", () => {}), mock.method(console, "error", () => {})];
  try {
    const ergebnis = await wireWebLogin({
      app,
      config: { ...webLoginBasisKonfiguration("https://api.workos.test"), billing: { paymentEnabled: zahlung } },
      store,
      audit: () => {},
      provision: async () => ({}),
      zeitplan,
      createPortalRunner: () => runner,
      stripeWebhookPath: STRIPE_PFAD,
      appPath: "/app",
    });
    return { app, ergebnis };
  } finally {
    for (const m of stumm) m.mock.restore();
  }
}

async function anfrage(app, methode, pfad) {
  const server = app.listen(0);
  await new Promise((fertig) => server.once("listening", fertig));
  try {
    return await abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, { method: methode });
  } finally {
    server.close();
  }
}

test("Zeitplan-Queue-1: wirft die Queue beim Anmelden, sind Portal-Route und Stripe-Webhook trotzdem montiert", async () => {
  const zeitplan = {
    plane: async () => {
      throw new Error("Queue nicht erreichbar");
    },
  };
  const { app } = await verdrahten({ zeitplan, zahlung: true });
  assert.equal((await anfrage(app, "GET", "/api/portal/state")).status, HTTP_NICHT_ANGEMELDET);
  assert.notEqual((await anfrage(app, "POST", STRIPE_PFAD)).status, HTTP_NICHT_GEFUNDEN);
});

test("Zeitplan-Queue-2: wirft die Queue, bricht erst zeitplaeneAnmelden ab, nicht das Verdrahten", async () => {
  const zeitplan = {
    plane: async () => {
      throw new Error("Queue nicht erreichbar");
    },
  };
  const { ergebnis } = await verdrahten({ zeitplan, zahlung: false });
  await assert.rejects(ergebnis.zeitplaeneAnmelden(), /Queue nicht erreichbar/);
});

test("Zeitplan-Queue-3: ohne Zahlung wird vor zeitplaeneAnmelden nichts geplant, danach genau die vier Zeitplaene", async () => {
  const namen = [];
  const { ergebnis } = await verdrahten({ zeitplan: { plane: async (name) => namen.push(name) }, zahlung: false });
  assert.deepEqual(namen, []);
  await ergebnis.zeitplaeneAnmelden();
  assert.deepEqual(namen.sort(), ["cancellation-mail", "contract-end", "did-release", "session-aufbewahrung"]);
});

test("Zeitplan-Queue-4: mit Zahlung kommt stripe-reconcile erst nach zeitplaeneAnmelden dazu", async () => {
  const namen = [];
  const { ergebnis } = await verdrahten({ zeitplan: { plane: async (name) => namen.push(name) }, zahlung: true });
  assert.deepEqual(namen, []);
  await ergebnis.zeitplaeneAnmelden();
  assert.deepEqual(namen.sort(), ["cancellation-mail", "contract-end", "did-release", "session-aufbewahrung", "stripe-reconcile"]);
});
