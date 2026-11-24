import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makePgTestStore } from "../pg-helpers.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";

test("Zeitplan-Erster-Lauf: haengt der erste Vertragsende-Lauf, werden die weiteren Zeitplaene trotzdem angemeldet", async () => {
  const { store, runner } = await makePgTestStore();
  let vertragsendeLaeuft = false;
  const nachladen = store.plattformBindungenNachladen;
  store.tenantsPendingContractEndCleanup = () => {
    vertragsendeLaeuft = true;
    return [{ id: "t_haengt" }];
  };
  store.plattformBindungenNachladen = () => (vertragsendeLaeuft ? new Promise(() => {}) : nachladen.call(store));
  const namen = [];
  const stumm = [mock.method(console, "log", () => {}), mock.method(console, "error", () => {}), mock.method(console, "warn", () => {})];
  try {
    const ergebnis = await wireWebLogin({
      app: express(),
      config: { ...webLoginBasisKonfiguration("https://api.workos.test"), billing: { paymentEnabled: false } },
      store,
      audit: () => {},
      provision: async () => ({}),
      zeitplan: { plane: async (name) => namen.push(name) },
      createPortalRunner: () => runner,
      stripeWebhookPath: "/webhooks/stripe",
      appPath: "/app",
    });
    void ergebnis.zeitplaeneAnmelden();
    await new Promise((fertig) => setImmediate(fertig));
    await new Promise((fertig) => setImmediate(fertig));
    assert.deepEqual(namen.sort(), ["cancellation-mail", "contract-end", "did-release", "session-aufbewahrung"]);
  } finally {
    for (const m of stumm) m.mock.restore();
  }
});
