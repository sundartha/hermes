// P5a (Achsen in Anzeige/Ablehnung getrennt): /api/state.usage trug tenantCapEur (die
// EIGENE Tenant-Decke) statt maxBudgetEur (der globale Plattform-Cap). P5b fuegte drei
// weitere TENANT-EIGENE Geldfelder hinzu (spendMonthCostEur/spendMonthKey/reservedEur).
//
// KS-P8 (E4, diese Datei): der Kunde kauft Minuten, keine Euro - ALLE fuenf Geldfelder
// entfallen ERSATZLOS (kein Schluessel-behalten-Bedeutung-wechseln, dieselbe harte
// Migration wie maxBudgetEur -> tenantCapEur in P5a). An ihrer Stelle steht EIN Wert:
// planUsagePercent, der Anteil der verbrauchten Plan-Minuten in Prozent (billing/meter.js,
// EINE Quelle mit dem Minuten-Gate). Die reine Minuten-Ableitung selbst (Rollover-
// Semantik von spendMonthUsageCents/spendMonthWindowKey) ist Subjekt der Spend-Monat-Achse,
// nicht dieser API-Kante, und bleibt auf Unit-Ebene gepinnt in
// test/usage-spend-month-axis.test.js und test/ks-p5-current-period-credits.test.js -
// diese Datei prueft nur noch, dass KEIN Geldbetrag mehr an der API-Kante erscheint und
// dass die Leseprojektion weiterhin nebeneffektfrei bleibt.
//
// Muster test/api-read-parity.test.js: makeReadRoutes isoliert (Mock-Store, Fake-Config,
// Fake-Tenant-Resolver), kein Server-Spawn, kein Netz.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeReadRoutes } from "../src/routes/api-read.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const PLATFORM_CAP_EUR_TEXT = "7.79"; // config.platformSpendCapCents = 779 Cent

// usageOf ist per Test ueberschreibbar, deshalb Parameter statt fest verdrahtetem Bucket
// (F1: ein Argument, keine Duplizierung der uebrigen Mock-Methoden).
function makeMockStore(bucket = { inputTokens: 5, outputTokens: 7, costCents: 350, calls: 3 }) {
  return {
    load: () => ({ calls: [], actionItems: [], notifications: [], numbers: [], usageEvents: [] }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    // E4: /api/state scoped unbedingt ueber exportTenantData - der Mock-Store braucht
    // sie deshalb auch fuer diese usage-fokussierte Achse.
    exportTenantData: () => ({ calls: [], actionItems: [], notifications: [] }),
    usageOf: () => bucket,
    // KS-P8: kein Abo hinterlegt -> tenantQuotaView() liefert null -> planUsagePercent null.
    tenantSubscription: () => ({
      planSlug: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      periodCreditRevoked: false,
    }),
    getCalendar: () => [],
  };
}

function makeConfig() {
  return withConfigNamespaces({
    multiTenant: false,
    claudeModel: "claude-haiku-4-5",
    voiceEngine: "budget",
    platformSpendCapCents: 779, // != irgendein Tenant-Feld - beweist die getrennte Achse
  });
}

function makeTenant() {
  return {
    requestTenant: () => BOOTSTRAP_TENANT_ID,
    requireTenant: () => BOOTSTRAP_TENANT_ID,
    tenantOwnsCall: () => true,
  };
}

// store ist per Test ueberschreibbar, Default deckt den unveraenderten Bestandsfall ab
// (F1: ein Argument).
async function mount(store = makeMockStore()) {
  const app = express();
  app.use(express.json());
  app.use(makeReadRoutes({ store, config: makeConfig(), audit: () => {}, tenant: makeTenant() }));
  const server = await new Promise((res) => {
    const s = app.listen(0, () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: () => new Promise((r) => server.close(r)) };
}

// T5 (Bestandstest, KS-P8 aktualisiert): die Whitelist beweist weiterhin, dass kein
// Plattform-Wert in der Tenant-Usage-Projektion landet - jetzt mit GENAU vier Feldern,
// keinem Geldbetrag mehr.
test("GET /api/state usage: planUsagePercent ersetzt alle Geldfelder ersatzlos, kein Plattform-Leck", async () => {
  const srv = await mount();
  try {
    const res = await fetch(`${srv.base}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.usage.planUsagePercent, null, "kein Abo hinterlegt -> null, nie 0 %");
    assert.ok(!("maxBudgetEur" in body.usage), "maxBudgetEur entfaellt ersatzlos (harte Migration)");
    assert.deepEqual(
      Object.keys(body.usage).sort(),
      ["calls", "inputTokens", "outputTokens", "planUsagePercent"],
      "Whitelist beweist: keine Plattform-Groesse, kein Geldfeld in der Usage-Projektion",
    );
    assert.ok(
      !JSON.stringify(body.usage).includes(PLATFORM_CAP_EUR_TEXT),
      "der Plattform-Cap (7.79 EUR) taucht nirgends in der Tenant-Usage-Projektion auf",
    );
    assert.ok(!("costCents" in body.usage), "costCents ist intern, kein API-Leak");
    assert.ok(!("spendMonthCostCents" in body.usage), "spendMonthCostCents ist intern, kein API-Leak");
  } finally {
    await srv.stop();
  }
});

// T4 (Vorgabe 2, ausfuehrbar, KS-P8 uebernommen): die Projektion darf den Bucket NICHT
// anlegen, NICHT stempeln, NICHT inkrementieren. Zwei Polls, weil /api/state gepollt
// wird und ein Einmal-Effekt sonst durchrutschen koennte.
test("GET /api/state usage: reine Leseprojektion - Bucket bleibt byte-identisch, kein save()", async () => {
  const bucket = {
    inputTokens: 5,
    outputTokens: 7,
    costCents: 350,
    calls: 3,
    spendMonthKey: "2020-01",
    spendMonthCostCents: 500,
    costMicroCentsRem: 999,
  };
  let saveCalls = 0;
  const store = { ...makeMockStore(bucket), save: () => { saveCalls++; } };
  const srv = await mount(store);
  try {
    const before = JSON.stringify(bucket);
    await fetch(`${srv.base}/api/state`);
    await fetch(`${srv.base}/api/state`); // zweiter Poll: ein Rollover-Schreibeffekt
    // waere spaetestens hier sichtbar.
    assert.equal(
      JSON.stringify(bucket),
      before,
      "/api/state laesst den Bucket byte-identisch: kein Stempeln, kein Inkrementieren",
    );
    assert.equal(saveCalls, 0, "die Leseprojektion persistiert nichts");
  } finally {
    await srv.stop();
  }
});
