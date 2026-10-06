import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startServer, DOMESTIC_TEST_NUMBER } from "./helpers.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import {
  makeDefaultState,
  createCall,
  activeCallsFor,
  tryReserveOutboundBudget,
  releaseOutboundReserveCents,
  reservationFor,
} from "../src/store/state-ops.js";

const TARGET_A = "+4915112340001";
const TARGET_B = "+4915112340002";
const HTTP_OK = 200;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;
const EIN_DATENSATZ = 1;
const ZWEI_DATENSAETZE = 2;
const TENANT = "T";
const VALID_TO = "+491711234567";
const OBJECTIVE = "Termin vereinbaren";
const WURF_MARKER = "e3-idempotenz-defekt";

const post = (url, to) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: OBJECTIVE }),
  });

test("A1: zwei gleichzeitige place_call auf dasselbe Ziel -> genau EIN Datensatz", async () => {
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: { ALLOWED_COUNTRY_CODES: "*", FAKE_ORIGINATE: "true" },
  });
  try {
    const [r1, r2] = await Promise.all([post(srv.localUrl, TARGET_A), post(srv.localUrl, TARGET_A)]);
    assert.equal(r1.status, HTTP_OK);
    assert.equal(r2.status, HTTP_OK);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    assert.equal(b1.callId, b2.callId, "beide Antworten nennen denselben Call");
    const dedupFlags = [b1.deduplicated, b2.deduplicated].sort();
    assert.deepEqual(dedupFlags, [false, true], "genau eine Antwort dedupliziert, genau eine nicht");
    assert.equal(srv.readStore().calls.length, 1, "es entstand genau EIN Anruf-Datensatz");
  } finally {
    await srv.stop();
  }
});

test("A2: sequenziell auf dasselbe Ziel WAEHREND der erste laeuft -> dedupliziert, kein zweiter Datensatz", async () => {
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: { ALLOWED_COUNTRY_CODES: "*", FAKE_ORIGINATE: "true" },
  });
  try {
    const r1 = await post(srv.localUrl, TARGET_A);
    assert.equal(r1.status, HTTP_OK);
    const b1 = await r1.json();
    assert.equal(b1.deduplicated, false);

    const r2 = await post(srv.localUrl, TARGET_A);
    assert.equal(r2.status, HTTP_OK);
    const b2 = await r2.json();
    assert.equal(b2.deduplicated, true, "der zweite Aufruf ist dedupliziert");
    assert.equal(b2.callId, b1.callId, "derselbe callId wie der erste");
    assert.equal(srv.readStore().calls.length, 1);
  } finally {
    await srv.stop();
  }
});

test("A3: zwei gleichzeitige place_call auf VERSCHIEDENE Ziele -> zwei Datensaetze, kein Dedup", async () => {
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: { ALLOWED_COUNTRY_CODES: "*", FAKE_ORIGINATE: "true" },
  });
  try {
    const [r1, r2] = await Promise.all([post(srv.localUrl, TARGET_A), post(srv.localUrl, TARGET_B)]);
    assert.equal(r1.status, HTTP_OK);
    assert.equal(r2.status, HTTP_OK);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    assert.notEqual(b1.callId, b2.callId, "verschiedene Ziele erzeugen verschiedene Anrufe");
    assert.equal(b1.deduplicated, false);
    assert.equal(b2.deduplicated, false);
    assert.equal(srv.readStore().calls.length, ZWEI_DATENSAETZE, "Ziel-Isolation: beide Datensaetze entstehen");
  } finally {
    await srv.stop();
  }
});

test("A4: ein beendeter (nicht mehr aktiver) Anruf sperrt das Ziel NICHT - Positiv-Kontrolle des Fensters", async () => {
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: { ALLOWED_COUNTRY_CODES: "*" },
  });
  try {
    const r1 = await post(srv.localUrl, TARGET_A);
    assert.equal(r1.status, HTTP_INTERNAL_ERROR, "Offline-Originate scheitert -> 500, Datensatz wird 'failed'");
    assert.equal(srv.readStore().calls.length, EIN_DATENSATZ, "der erste Datensatz entsteht");
    const [ersterAnruf] = srv.readStore().calls;
    assert.equal(ersterAnruf.status, "failed", "der Offline-Originate beendet ihn sofort");

    const r2 = await post(srv.localUrl, TARGET_A);
    assert.equal(r2.status, HTTP_INTERNAL_ERROR);
    assert.equal(srv.readStore().calls.length, ZWEI_DATENSAETZE, "ein zweiter, eigener Datensatz entsteht");
  } finally {
    await srv.stop();
  }
});

function kettenStoreTeilB(state, overrides = {}) {
  return {
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
    load: () => ({
      numbers: [{ tenantId: TENANT, status: "active", provider: "telnyx", e164: "+491700000000" }],
    }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice", settings: { allowResearch: false } }),
    resolveProfile: () => ({
      unrestricted: true,
      allowedCountryCodes: null,
      maxCallsPerHour: null,
      allowedNumbers: [],
      allowConsult: false,
      allowLookup: false,
    }),
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    withStoreLock: (fn) => fn(),
    tryReserveOutboundBudget: (tenantId, cents) => tryReserveOutboundBudget(state, tenantId, cents, {}, new Date().toISOString()),
    tenantBudgetSnapshot: () => ({ capCents: 1000000, spentCents: 0, remainingCents: 1000000 }),
    reserveExceedsBudget: () => false,
    claimPlatformSpendWarning: () => null,
    resolveCallLanguage: () => "de",
    activeCallsFor: (tenantId) => activeCallsFor(state, tenantId),
    releaseOutboundReserveCents: (tenantId, cents) => releaseOutboundReserveCents(state, tenantId, cents),
    reservationOf: (tenantId) => reservationFor(state, tenantId),
    createCall: (felder) => {
      const call = createCall(state, felder);
      return call;
    },
    recordCostProfile: () => {},
    save: () => {},
    ...overrides,
  };
}

function zaehlenderStore(basis, werfendeQuelle = null) {
  const aufrufe = new Map();
  const store = {};
  for (const [name, fn] of Object.entries(basis)) {
    store[name] = (...args) => {
      aufrufe.set(name, (aufrufe.get(name) || 0) + 1);
      if (name === werfendeQuelle) throw new Error(`${WURF_MARKER} quelle=${name}`);
      return fn(...args);
    };
  }
  return { store, aufrufe };
}

function testConfig(overrides = {}) {
  return withConfigNamespaces({
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    platformSpendCapCents: 800,
    allowedCountryCodes: ["+49"],
    maxCallsPerHour: 100,
    perTargetWindowMs: 3600000,
    perTargetCallCap: 100,
    multiTenant: false,
    diagnosticRetentionDays: 0,
    ownerSelfCallEnabled: false,
    ownerSelfCallTenantIds: [],
    elevenLabsOutbound: { enabled: false },
    telnyxAssistant: { enabled: false },
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
    ...overrides,
  });
}

async function postCallTeilB({ store, config, audit = () => {} }) {
  let wahlversuche = 0;
  const { makeOutboundGates } = await import("../src/telephony/outbound-gates.js");
  const { makeCallRoutes } = await import("../src/routes/api-calls.js");
  const { gates: outboundGates, callQuotaDenial } = makeOutboundGates({
    store,
    config,
    requestTenant: () => TENANT,
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
    audit,
  });
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      config,
      audit,
      outboundGates,
      callQuotaDenial,
      voiceControl: () => ({
        originateCall: async () => {
          wahlversuche += 1;
          return { sid: "sid_idempotenz" };
        },
      }),
      originateElevenLabsCall: async () => {
        wahlversuche += 1;
      },
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: {
        requestTenant: () => TENANT,
        requireTenant: () => TENANT,
        tenantOwnsCall: () => true,
      },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: VALID_TO, objective: OBJECTIVE }),
    });
    return { status: res.status, body: await res.json(), wahlversuche };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("B1: Reserve nach Dedup ist EXAKT der Wert nach einem einzelnen Anruf", async () => {
  process.env.PRECALL_BRIEFING_ENABLED = "false";
  process.env.ASSISTANT_CONTEXT_ENABLED = "false";
  process.env.IN_CALL_CONSULT_ENABLED = "false";
  process.env.CONSULT_ENABLED = "false";
  process.env.METRICS_ENABLED = "false";

  const einzelState = makeDefaultState();
  const einzelStore = kettenStoreTeilB(einzelState);
  const einzel = await postCallTeilB({ store: einzelStore, config: testConfig() });
  assert.equal(einzel.status, HTTP_OK);
  const reserveNachEinem = reservationFor(einzelState, TENANT);

  const zweiState = makeDefaultState();
  const zweiStore = kettenStoreTeilB(zweiState);
  const erster = await postCallTeilB({ store: zweiStore, config: testConfig() });
  assert.equal(erster.status, HTTP_OK);
  assert.equal(erster.body.deduplicated, false);
  const zweiter = await postCallTeilB({ store: zweiStore, config: testConfig() });
  assert.equal(zweiter.status, HTTP_OK);
  assert.equal(zweiter.body.deduplicated, true);

  assert.equal(
    reservationFor(zweiState, TENANT),
    reserveNachEinem,
    "die deduplizierte Reserve ist vollstaendig zurueckgegeben - der Ledger zeigt genau EINEN Anruf",
  );
});

test("B2: createCall wirft (Wurf NACH der Gate-Kette) -> 503, Reserve 0, kein Wahlversuch, kein Leak", async () => {
  process.env.PRECALL_BRIEFING_ENABLED = "false";
  process.env.ASSISTANT_CONTEXT_ENABLED = "false";
  process.env.IN_CALL_CONSULT_ENABLED = "false";
  process.env.CONSULT_ENABLED = "false";
  process.env.METRICS_ENABLED = "false";

  const rejectionListener = (err) => {
    throw new Error(`unhandledRejection waehrend B2: ${err?.message}`);
  };
  process.on("unhandledRejection", rejectionListener);
  try {
    const state = makeDefaultState();
    const basis = kettenStoreTeilB(state);
    const { store } = zaehlenderStore(basis, "createCall");
    const ergebnis = await postCallTeilB({ store, config: testConfig() });

    assert.equal(ergebnis.status, HTTP_SERVICE_UNAVAILABLE);
    assert.ok(ergebnis.body.error, "die Antwort ist JSON mit error");
    assert.equal(reservationFor(state, TENANT), 0, "die Reserve DIESES Requests ist zurueckgegeben");
    assert.equal(ergebnis.wahlversuche, 0, "es wurde nicht gewaehlt");
    assert.ok(
      !JSON.stringify(ergebnis.body).includes(WURF_MARKER),
      "die Antwort traegt kein Innenleben des Wurfs",
    );
  } finally {
    process.off("unhandledRejection", rejectionListener);
  }
});

test("B3: ein Werfer VOR createCall (resolveCallLanguage, nach NICHT_KETTEN_QUELLEN erst nach der Kette gelesen) -> 503, Reserve 0", async () => {
  process.env.PRECALL_BRIEFING_ENABLED = "false";
  process.env.ASSISTANT_CONTEXT_ENABLED = "false";
  process.env.IN_CALL_CONSULT_ENABLED = "false";
  process.env.CONSULT_ENABLED = "false";
  process.env.METRICS_ENABLED = "false";

  const state = makeDefaultState();
  const basis = kettenStoreTeilB(state);
  const { store } = zaehlenderStore(basis, "resolveCallLanguage");
  const ergebnis = await postCallTeilB({ store, config: testConfig() });

  assert.equal(ergebnis.status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(reservationFor(state, TENANT), 0);
  assert.equal(ergebnis.wahlversuche, 0);
});
