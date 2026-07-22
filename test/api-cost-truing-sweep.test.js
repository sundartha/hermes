// LCT P3 (Review-Blocker Runde 1): HTTP-/Verdrahtungs-Test fuer den NEUEN Endpunkt
// POST /api/billing/cost-truing/sweep. Der Bestandstest cost-truing-observe.test.js
// prueft ausschliesslich die Fabrik makeCostTruing() in-process; die Kette
// server.js (makeCostTruing) -> deps -> app.js (buildApp) -> makeBillingRoutes(costTruing)
// -> Routenpfad -> Antwort-Shape beruehrte KEIN Test. Eine vergessene deps-Weitergabe oder
// ein Tippfehler im Pfad waere durch die gesamte Suite gefallen (Muster + Vorgeschichte:
// test/api-flush-meters.test.js). Spawn-Test (startServer), netzfrei.
//
// NETZFREIHEIT: die Fixturen benutzen bewusst provider=twilio. Der Twilio-Adapter hat
// keine Beleg-Methoden (fetchCostRecordPool/assignCostRecords) -> trueOneCall zaehlt den
// Call als uebersprungen, ohne je einen Provider zu kontaktieren. Damit laeuft der echte
// Sweep end-to-end, ohne Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, externalIp } from "./helpers.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER, COST_TRUING_SOURCE } from "../src/store/defaults.js";

const EXTERNAL_IP = externalIp();
const MS_PER_MINUTE = 60 * 1000;
// Weiter zurueck als der COST_TRUING_DELAY_MINUTES-Default (30, in BASE_ENV gepinnt),
// damit der Call im Sweep faellig ist.
const ENDED_MINUTES_AGO = 200;

// PII-Fixturen: markant, damit ein Leak in der Antwort nicht in generischen Zahlen
// untergeht (die Antwort darf NUR Zaehler + Quote tragen).
const PII_PHONE = "+4915155512345";

// Antwort-Frist der Testanfrage. Notwendig, weil Express 4 die Rejection eines async-
// Handlers NICHT faengt: ist costTruing nicht durchgereicht, wirft der Handler, es wird
// NIE geantwortet und ein Fetch ohne Frist haenge unbegrenzt - der Blocker-Fall fiele
// dann als Suite-Haenger statt als roter Test auf. Grosszuegig: der Sweep laeuft hier
// netzfrei ueber hoechstens zwei Calls.
const SWEEP_RESPONSE_TIMEOUT_MS = 15000;

const sweep = (srv) =>
  fetch(`${srv.localUrl}/api/billing/cost-truing/sweep`, {
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
  const srv = await startServer();
  try {
    const res = await sweep(srv);
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
    await srv.stop();
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

  const srv = await startServer({ seed });
  try {
    const res = await sweep(srv);
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
    const stored = srv.readStore().calls.find((c) => c.id === candidate.id);
    assert.equal(stored.costTruedAt, null);
    assert.equal(stored.costTruedSource, null);
    assert.equal(stored.costTruingAttempts, 0);
  } finally {
    await srv.stop();
  }
});

// (C) Auth fail-closed (CLAUDE.md Regel 3): der neue Endpunkt liegt hinter der
// bestehenden /api/*-Basic-Auth. Extern (keine localhost-Ausnahme) ohne Credentials
// -> 401, kein Sweep. Muster test/single-origin-serving.test.js.
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
