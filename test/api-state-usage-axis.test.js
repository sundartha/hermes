// P5a (Achsen in Anzeige/Ablehnung getrennt): /api/state.usage traegt seit dieser Phase
// tenantCapEur (die EIGENE Tenant-Decke) statt maxBudgetEur (der globale Plattform-Cap).
// P5b (diese Datei): drei weitere TENANT-EIGENE Felder kommen dazu - der Spend-Monat-
// Verbrauch (spendMonthCostEur, ueber die nebeneffektfreie Leseprojektion
// spendMonthUsageCents aus P4), der zugehoerige Monatsschluessel (spendMonthKey) und die
// eigene In-Flight-Reserve (reservedEur). Muster test/api-read-parity.test.js:
// makeReadRoutes isoliert (Mock-Store, Fake-Config, Fake-Tenant-Resolver), kein
// Server-Spawn, kein Netz.
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

// usageOf ist per Test ueberschreibbar (Rollover-/Zukunfts-/Reserve-Faelle unten),
// deshalb Parameter statt fest verdrahtetem Bucket (F1: ein Argument, keine
// Duplizierung der uebrigen Mock-Methoden).
function makeMockStore(bucket = { inputTokens: 5, outputTokens: 7, costCents: 350, calls: 3 }) {
  return {
    load: () => ({ calls: [], actionItems: [], notifications: [], numbers: [] }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    usageOf: () => bucket,
    // Tenant-Achse: Cap 1000 ct (10 EUR) - unabhaengig vom Plattform-Cap unten.
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    // Eigene In-Flight-Reserve (P5b): 60 Cent, unabhaengig von costCents/spendMonth.
    reservationOf: () => 60,
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

// store ist per Test ueberschreibbar (T1/T2/T4 brauchen eigene Buckets/Spies),
// Default deckt den unveraenderten Bestandsfall ab (F1: ein Argument).
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

// T5 (Bestandstest erweitert): die Whitelist beweist weiterhin, dass kein Plattform-
// Wert in der Tenant-Usage-Projektion landet - jetzt mit den drei P5b-Feldern.
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
      [
        "calls",
        "costEur",
        "inputTokens",
        "outputTokens",
        "reservedEur",
        "spendMonthCostEur",
        "spendMonthKey",
        "tenantCapEur",
      ],
      "Whitelist beweist: keine Plattform-Groesse in der Usage-Projektion",
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

// T3: die EIGENE In-Flight-Reserve (reservationOf -> reservationFor), unabhaengig von
// costCents/spendMonth - eigener Test statt Nebenassertion, damit ein kuenftiger
// Reserve-Regressions-Fund hier genau EINE rote Zeile erzeugt (keine Vermischung mit
// der Whitelist-Pruefung oben).
test("GET /api/state usage: reservedEur aus der eigenen In-Flight-Reserve", async () => {
  const srv = await mount();
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.reservedEur, 0.6, "60 Cent eigene In-Flight-Reserve -> 0.6 EUR");
  } finally {
    await srv.stop();
  }
});

// T1 (ROT-VOR-FIX): Bucket traegt den Schluessel des VORMONATS (zeit-unabhaengig weit
// in der Vergangenheit, s. F.I.R.S.T. "Repeatable") -> die Leseprojektion muss den
// Rollover zeigen (0), OHNE den Lebenszeitwert (costEur) daneben zu verfaelschen, und
// MUSS das laufende Fenster anzeigen, nie den veralteten Bucket-Stempel.
test("GET /api/state usage: Rollover - spendMonthCostEur=0, costEur bleibt Lebenszeitwert, Fenster ist das laufende", async () => {
  const bucket = {
    inputTokens: 5,
    outputTokens: 7,
    costCents: 350,
    calls: 3,
    spendMonthKey: "2020-01",
    spendMonthCostCents: 500,
  };
  const srv = await mount(makeMockStore(bucket));
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();

    assert.equal(body.usage.spendMonthCostEur, 0, "Rollover -> 0");
    assert.equal(body.usage.costEur, 3.5, "Lebenszeit unveraendert daneben");
    assert.notEqual(
      body.usage.spendMonthKey,
      "2020-01",
      "angezeigt wird das LAUFENDE Fenster, nie der veraltete Bucket-Stempel",
    );
    assert.match(body.usage.spendMonthKey, /^\d{4}-\d{2}$/);
  } finally {
    await srv.stop();
  }
});

// T2 (Gegentest, zeit-unabhaengig): ein Schluessel in der ZUKUNFT gewinnt ueber den
// Monotonie-Riegel - die Projektion misst dieses Fenster und liefert den vollen Wert.
test("GET /api/state usage: laufendes (zukuenftiges) Fenster liefert den vollen Wert", async () => {
  const bucket = {
    inputTokens: 5,
    outputTokens: 7,
    costCents: 350,
    calls: 3,
    spendMonthKey: "2099-12",
    spendMonthCostCents: 500,
  };
  const srv = await mount(makeMockStore(bucket));
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();

    assert.equal(body.usage.spendMonthCostEur, 5);
    assert.equal(body.usage.spendMonthKey, "2099-12");
  } finally {
    await srv.stop();
  }
});

// T4 (Vorgabe 2, ausfuehrbar): die Projektion darf den Bucket NICHT anlegen, NICHT
// stempeln, NICHT inkrementieren. Vormonats-Schluessel = genau der Zustand, in dem ein
// Rollover an der Lesekante feuern wuerde. Zwei Polls, weil /api/state gepollt wird und
// ein Einmal-Effekt sonst durchrutschen koennte.
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
