import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "../pg-helpers.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";

const SECHS_STUNDEN_MS = 6 * 60 * 60_000;

function aufzeichnung() {
  const plaene = [];
  return {
    plaene,
    plane: async (name, intervallMs, lauf) => {
      plaene.push({ name, intervallMs, lauf });
    },
  };
}

async function webLogin(zeitplan, billing) {
  const { store, runner } = await makePgTestStore();
  const konfiguration = webLoginBasisKonfiguration("https://api.workos.test");
  const stumm = [mock.method(console, "log", () => {}), mock.method(console, "error", () => {})];
  try {
    await wireWebLogin({
      app: express(),
      config: { ...konfiguration, billing },
      store,
      audit: () => {},
      provision: async () => ({}),
      zeitplan,
      createPortalRunner: () => runner,
      stripeWebhookPath: "/webhooks/stripe",
      appPath: "/app",
    });
  } finally {
    for (const m of stumm) m.mock.restore();
  }
}

test("Sweep-Namen-1: das Web-Login meldet seine vier Sweeps und die Session-Aufbewahrung mit Takt 6 Stunden an", async () => {
  const zeitplan = aufzeichnung();
  await webLogin(zeitplan, { paymentEnabled: false });
  assert.deepEqual(zeitplan.plaene.map((p) => p.name).sort(), [
    "cancellation-mail",
    "contract-end",
    "did-release",
    "session-aufbewahrung",
  ]);
  for (const p of zeitplan.plaene) assert.equal(p.intervallMs, SECHS_STUNDEN_MS, p.name);
});

test("Sweep-Namen-2: mit aktiver Zahlung kommt der Stripe-Abgleich als fünfter Zeitplan dazu", async () => {
  const zeitplan = aufzeichnung();
  await webLogin(zeitplan, { paymentEnabled: true });
  assert.deepEqual(zeitplan.plaene.map((p) => p.name).sort(), [
    "cancellation-mail",
    "contract-end",
    "did-release",
    "session-aufbewahrung",
    "stripe-reconcile",
  ]);
  assert.equal(zeitplan.plaene.find((p) => p.name === "stripe-reconcile").intervallMs, SECHS_STUNDEN_MS);
});

test("Sweep-Namen-3: scheitert ein Sweep, nennt der Zeitplan ihn mit seinem Log-Kennzeichen", async () => {
  const zeitplan = aufzeichnung();
  await webLogin(zeitplan, { paymentEnabled: true });
  const fehler = mock.method(console, "error", () => {});
  try {
    for (const p of zeitplan.plaene.filter((e) => e.name !== "session-aufbewahrung")) p.lauf.beiFehler(new Error("kaputt"));
    assert.deepEqual(
      fehler.mock.calls.map((a) => a.arguments.join(" ")),
      ["[did-release] kaputt", "[contract-end] kaputt", "[cancellation-mail] kaputt", "[stripe-reconcile] kaputt"],
    );
  } finally {
    fehler.mock.restore();
  }
});

