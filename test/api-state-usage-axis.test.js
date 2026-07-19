// P5a (Achsen in Anzeige/Ablehnung getrennt): /api/state.usage traegt seit dieser Phase
// tenantCapEur (die EIGENE Tenant-Decke) statt maxBudgetEur (der globale Plattform-Cap).
// Muster test/api-read-parity.test.js: makeReadRoutes isoliert (Mock-Store, Fake-Config,
// Fake-Tenant-Resolver), kein Server-Spawn, kein Netz.
//
// Der Plattform-Cap (config.platformSpendCapCents) steht hier BEWUSST weit vom
// Tenant-Cap (tenantBudgetSnapshot) entfernt (7.79 EUR vs. 10 EUR) - jede versehentliche
// Ableitung aus dem globalen Cap statt aus dem injizierten Snapshot waere sofort sichtbar
// (Wert UND Text unterscheiden sich).
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeReadRoutes } from "../src/routes/api-read.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const PLATFORM_CAP_EUR_TEXT = "7.79"; // config.platformSpendCapCents = 779 Cent

function makeMockStore() {
  return {
    load: () => ({ calls: [], actionItems: [], notifications: [], numbers: [] }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    usageOf: () => ({ inputTokens: 5, outputTokens: 7, costCents: 350, calls: 3 }),
    // Tenant-Achse: Cap 1000 ct (10 EUR) - unabhaengig vom Plattform-Cap unten.
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    getCalendar: () => [],
  };
}

function makeConfig() {
  return withConfigNamespaces({
    multiTenant: false,
    claudeModel: "claude-haiku-4-5",
    voiceEngine: "budget",
    platformSpendCapCents: 779, // != tenantCapEur (1000 ct) - beweist die getrennte Achse
  });
}

function makeTenant() {
  return {
    requestTenant: () => BOOTSTRAP_TENANT_ID,
    requireTenant: () => BOOTSTRAP_TENANT_ID,
    tenantOwnsCall: () => true,
  };
}

async function mount() {
  const app = express();
  app.use(express.json());
  app.use(
    makeReadRoutes({ store: makeMockStore(), config: makeConfig(), audit: () => {}, tenant: makeTenant() }),
  );
  const server = await new Promise((res) => {
    const s = app.listen(0, () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: () => new Promise((r) => server.close(r)) };
}

test("GET /api/state usage: tenantCapEur ersetzt maxBudgetEur ersatzlos, kein Plattform-Leck", async () => {
  const srv = await mount();
  try {
    const res = await fetch(`${srv.base}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.usage.tenantCapEur, 10, "1000 Cent Tenant-Cap -> 10 EUR");
    assert.ok(!("maxBudgetEur" in body.usage), "maxBudgetEur entfaellt ersatzlos (harte Migration)");
    assert.deepEqual(
      Object.keys(body.usage).sort(),
      ["calls", "costEur", "inputTokens", "outputTokens", "tenantCapEur"],
      "Whitelist beweist: keine Plattform-Groesse in der Usage-Projektion",
    );
    assert.ok(
      !JSON.stringify(body.usage).includes(PLATFORM_CAP_EUR_TEXT),
      "der Plattform-Cap (7.79 EUR) taucht nirgends in der Tenant-Usage-Projektion auf",
    );
  } finally {
    await srv.stop();
  }
});
