import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "../pg-helpers.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { planeLoeschtakt } from "../../src/store/webhook-zustellung.js";
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


const LOESCHTAKT_MS = 60_000;

async function loeschtakt(runner) {
  const zeitplan = aufzeichnung();
  const stumm = [mock.method(console, "log", () => {}), mock.method(console, "error", () => {})];
  try {
    await planeLoeschtakt({ runner, taktMs: LOESCHTAKT_MS, mitAblage: true, zeitplan });
    await new Promise((fertig) => setImmediate(fertig));
  } finally {
    for (const m of stumm) m.mock.restore();
  }
  return zeitplan;
}

test("Sweep-Namen-4: der Löschtakt der Webhook-Ablage meldet sich als webhook-zustellung im eingestellten Takt an", async () => {
  const { runner } = await makePgTestStore();
  const zeitplan = await loeschtakt(runner);
  assert.equal(zeitplan.plaene.length, 1);
  assert.equal(zeitplan.plaene[0].name, "webhook-zustellung");
  assert.equal(zeitplan.plaene[0].intervallMs, LOESCHTAKT_MS);
});

test("Sweep-Namen-5: scheitert das Löschen, meldet beiFehler es mit code= im Log", async () => {
  const kaputt = { withClient: async () => Promise.reject(Object.assign(new Error("kaputt"), { code: "55P03" })) };
  const zeitplan = await loeschtakt(kaputt);
  const fehler = mock.method(console, "error", () => {});
  try {
    await zeitplan.plaene[0].lauf.beiFehler(Object.assign(new Error("x"), { code: "XX000" }));
    assert.deepEqual(fehler.mock.calls.map((a) => a.arguments.join(" ")), [
      "[webhook-zustellung] loeschen_fehlgeschlagen code=XX000",
    ]);
  } finally {
    fehler.mock.restore();
  }
});
