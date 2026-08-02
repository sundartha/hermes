// LCT P3 (Review-Blocker Runde 1): HTTP-/Verdrahtungs-Test fuer den Endpunkt
// POST /api/billing/cost-truing/sweep. Der Bestandstest cost-truing-observe.test.js
// prueft ausschliesslich die Fabrik makeCostTruing() in-process; die Kette
// server.js (makeCostTruing) -> deps -> app.js (buildApp) -> makeBillingRoutes(costTruing)
// -> Routenpfad -> Antwort-Shape braucht einen eigenen Test.
//
// AUTH-P6: cost-truing/sweep ist seither eine Betreiber-Route (webAuthMw+adminMw, nur
// MIT operatorAuth gemountet). (A)-(B) migriert auf In-Process-Mount von
// makeBillingRoutes MIT einer ECHTEN makeCostTruing()-Instanz (kein Sweep-Stub) - die
// Fixturen benutzen weiterhin bewusst provider=twilio: der Twilio-Adapter hat keine
// Beleg-Methoden (fetchCostRecordPool/assignCostRecords) -> trueOneCall zaehlt den Call
// als uebersprungen, ohne je einen Provider zu kontaktieren (netzfrei, wie bisher).
// (C) misst das Basic-Auth-Gate selbst und bleibt darum ein echter Spawn-Test,
// UNVERAENDERT.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startServer, externalIp } from "./helpers.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { makeCostTruing } from "../src/billing/cost-truing.js";
import { voiceControl } from "../src/telephony/registry.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { makeStubStore, fakeConfig } from "./cost-truing-harness.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER, COST_TRUING_SOURCE } from "../src/store/defaults.js";

const EXTERNAL_IP = externalIp();
const MS_PER_MINUTE = 60 * 1000;
// Weiter zurueck als der costTruingDelayMinutes-Default der fakeConfig (180 Minuten),
// damit der Call im Sweep faellig ist.
const ENDED_MINUTES_AGO = 200;

// PII-Fixturen: markant, damit ein Leak in der Antwort nicht in generischen Zahlen
// untergeht (die Antwort darf NUR Zaehler + Quote tragen).
const PII_PHONE = "+4915155512345";

async function startSweepApp(state) {
  const store = makeStubStore(state);
  const config = fakeConfig();
  const costTruing = makeCostTruing({ store, config, voiceControl, audit: () => {}, messaging: {} });
  const app = express();
  app.use(
    makeBillingRoutes({
      config,
      store,
      audit: () => {},
      billing: {},
      tenant: {},
      costTruing,
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    close: () => new Promise((r) => server.close(r)),
  };
}

// Antwort-Frist der Testanfrage. Notwendig, weil Express 4 die Rejection eines async-
// Handlers NICHT faengt: ist costTruing nicht durchgereicht, wirft der Handler, es wird
// NIE geantwortet und ein Fetch ohne Frist haenge unbegrenzt - der Blocker-Fall fiele
// dann als Suite-Haenger statt als roter Test auf. Grosszuegig: der Sweep laeuft hier
// netzfrei ueber hoechstens zwei Calls.
const SWEEP_RESPONSE_TIMEOUT_MS = 15000;

const sweep = (app) =>
  fetch(`${app.base}/api/billing/cost-truing/sweep`, {
    method: "POST",
    signal: AbortSignal.timeout(SWEEP_RESPONSE_TIMEOUT_MS),
  });

function endedOutboundCall(state, { minutesAgo = ENDED_MINUTES_AGO } = {}) {
  const call = createCall(state, {
    direction: "outbound",
    from: PII_PHONE,
    to: PII_PHONE,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: PROVIDER.TWILIO,
  });
  call.status = "completed";
  call.answeredAt = new Date(Date.now() - (minutesAgo + 1) * MS_PER_MINUTE).toISOString();
  call.endedAt = new Date(Date.now() - minutesAgo * MS_PER_MINUTE).toISOString();
  call.twilioSid = "CAtest1";
  return call;
}

// (A) Verdrahtungs- und Shape-Beweis am leeren Store: der Endpunkt existiert, costTruing
// ist als Dependency angekommen (waere es undefined, faellt der Handler in einen
// TypeError -> 500), und die Antwort traegt genau die neun Zaehler-/Quoten-Felder.
// GELD-PFAD: Nenner 0 -> coveragePercent 0, NICHT 100 und NICHT null/NaN - der
// Nenner-0-Freispruch waere die fail-open-Variante genau der Zahl, die ab P4 den Flip
// freigibt.
test("POST /api/billing/cost-truing/sweep, leerer Store: 200 + volle Zaehler-Shape, Deckung 0 bei Nenner 0", async () => {
  const app = await startSweepApp(makeDefaultState());
  try {
    const res = await sweep(app);
    assert.equal(res.status, 200, "Endpunkt verdrahtet (kein 404 durch Pfad-Tippfehler)");
    const body = await res.json();
    assert.deepEqual(body, {
      skipped: false,
      candidates: 0,
      coveragePercent: 0,
      measured: 0,
      incomplete: 0,
      noEstimate: 0,
      unavailable: 0,
      skippedCalls: 0,
      failed: 0,
    });
  } finally {
    await app.close();
  }
});

// (B) Derselbe Endpunkt gegen echte Store-Daten: ein bereits abgeglichener Call (Zaehler
// der Deckungsquote) + ein faelliger Kandidat ohne Provider-Faehigkeit (Nenner, wird
// uebersprungen) -> Quote 50 %. Beweist, dass der Handler den ECHTEN Sweep laeuft
// (Kandidaten-Erkennung + Quote aus dem geladenen Spiegel), nicht nur eine leere Antwort
// zurueckgibt. Zusaetzlich: die Antwort traegt KEINE PII (keine Rufnummer, keine Call-ID).
test("POST /api/billing/cost-truing/sweep mit Store-Daten: echter Sweep (Kandidat + Quote), Antwort PII-frei", async () => {
  const seed = makeDefaultState();
  const proven = endedOutboundCall(seed);
  proven.costTruedAt = new Date().toISOString();
  proven.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  proven.actualCostMicroCents = 8636870;
  const candidate = endedOutboundCall(seed);

  const app = await startSweepApp(seed);
  try {
    const res = await sweep(app);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      skipped: false,
      candidates: 1, // nur der noch nicht abgeglichene Call
      coveragePercent: 50, // 1 von 2 beendeten Outbound-Calls beweisbar vollstaendig
      measured: 0,
      incomplete: 0,
      noEstimate: 0,
      unavailable: 0,
      skippedCalls: 1, // Twilio-Adapter ohne Beleg-Methoden -> sauberes No-op
      failed: 0,
    });
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(PII_PHONE), "keine Rufnummer in der Antwort");
    assert.ok(!raw.includes(candidate.id), "keine Call-ID in der Antwort");

    // Das No-op darf KEIN Feld schreiben und KEINEN Versuch verbrauchen (sonst liefe der
    // Kandidat nach COST_TRUING_MAX_ATTEMPTS Sweeps still aus dem Job heraus).
    const stored = app.store.load().calls.find((c) => c.id === candidate.id);
    assert.equal(stored.costTruedAt, null);
    assert.equal(stored.costTruedSource, null);
    assert.equal(stored.costTruingAttempts, 0);
  } finally {
    await app.close();
  }
});

// (C) Auth fail-closed (CLAUDE.md Regel 3): der Endpunkt liegt hinter der bestehenden
// /api/*-Basic-Auth. Extern (keine localhost-Ausnahme) ohne Credentials -> 401, kein
// Sweep. UNVERAENDERT (echter Spawn-Server): misst das Gate, nicht die Route.
test(
  "POST /api/billing/cost-truing/sweep extern ohne Creds -> 401 (Basic-Auth fail-closed)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      const res = await fetch(`${srv.externalUrl}/api/billing/cost-truing/sweep`, {
        method: "POST",
      });
      assert.equal(res.status, 401);
    } finally {
      await srv.stop();
    }
  },
);
