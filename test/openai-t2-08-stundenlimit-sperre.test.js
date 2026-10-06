import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { startServer, DOMESTIC_TEST_NUMBER } from "./helpers.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { makeCallRoutes } from "../src/routes/api-calls.js";
import { terminateAndBillCall, billThunk } from "../src/telephony/call-termination.js";
import { GATE_TEXTS } from "../src/i18n/gate-texts.js";

const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const ORIGINATE_FAILURE_STATUSES = [HTTP_SERVER_ERROR, HTTP_BAD_GATEWAY];
const OBJECTIVE = "Termin vereinbaren";
const DEFAULT_TENANT = "t208";
const OWNER_NAME = "Alice";
const LLM_MOCK_DELAY_MS = 300;
const HOUR_LIMIT_T1 = 2;
const HOUR_LIMIT_T1_REQUESTS = 8;
const HOUR_LIMIT_T2 = 2;
const HOUR_LIMIT_T2_A_REQUESTS = 4;
const T1_TARGET_SUFFIX_START = 10;
const T2_TARGET_SUFFIX_START = 20;

function startDelayedLlmMock(delayMs) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    req.resume();
    setTimeout(() => {
      res.writeHead(HTTP_SERVER_ERROR, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "probe" } }));
    }, delayMs);
  });
  return {
    server,
    get hits() {
      return hits;
    },
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function briefingEnv(llmPort) {
  return {
    ALLOWED_COUNTRY_CODES: "*",
    FAKE_ORIGINATE: "true",
    PRECALL_BRIEFING_ENABLED: "true",
    ASSISTANT_CONTEXT_ENABLED: "true",
    LLM_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-dummy",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${llmPort}`,
  };
}

function postDe(baseUrl, to, identity) {
  return fetch(`${baseUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to, objective: OBJECTIVE }),
  });
}

test("T1: N parallele place_call eines Mandanten am Stundenlimit -> hoechstens L werden gewaehlt", async () => {
  const LIMIT = HOUR_LIMIT_T1;
  const TOTAL_REQUESTS = HOUR_LIMIT_T1_REQUESTS;
  const llm = startDelayedLlmMock(LLM_MOCK_DELAY_MS);
  await llm.listen();
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    env: { ...briefingEnv(llm.server.address().port), MAX_CALLS_PER_HOUR: String(LIMIT) },
  });
  try {
    const targets = Array.from({ length: TOTAL_REQUESTS }, (_unused, index) => `+4915112340${String(T1_TARGET_SUFFIX_START + index)}`);
    const responses = await Promise.all(targets.map((to) => postDe(srv.localUrl, to)));
    const statuses = responses.map((response) => response.status);
    const okCount = statuses.filter((status) => status === HTTP_OK).length;
    const deniedCount = statuses.filter((status) => status === HTTP_TOO_MANY).length;
    assert.equal(
      okCount,
      LIMIT,
      `erwartet genau ${LIMIT}x 200 (Limit), bekommen: ${JSON.stringify(statuses)}`,
    );
    assert.equal(
      deniedCount,
      TOTAL_REQUESTS - LIMIT,
      `erwartet genau ${TOTAL_REQUESTS - LIMIT}x 429, bekommen: ${JSON.stringify(statuses)}`,
    );
    const deniedRes = responses.find((response) => response.status === HTTP_TOO_MANY);
    const deniedBody = await deniedRes.json();
    assert.equal(deniedBody.error, GATE_TEXTS.en.hourLimit, "429-Body muss der bisherige hourLimit-Text sein");
    assert.ok(
      llm.hits >= LIMIT,
      `Positiv-Kontrolle: die LLM-Attrappe muss mindestens ${LIMIT}x getroffen worden sein (hits=${llm.hits}) - sonst war das Rennfenster nicht offen und der Test beweist nichts`,
    );
    assert.equal(srv.readStore().calls.length, LIMIT, "genau L Datensaetze duerfen entstanden sein");
  } finally {
    await srv.stop();
    await llm.close();
  }
});

test("T2: Stundenlimit gilt weiterhin PRO Tenant, auch mit geoeffnetem Rennfenster - Tenant B bleibt frei", async () => {
  const LIMIT = HOUR_LIMIT_T2;
  const TENANT_A_REQUESTS = HOUR_LIMIT_T2_A_REQUESTS;
  const SUB_A = "sub-t208-a";
  const SUB_B = "sub-t208-b";
  const NUM_A = "+4915120020001";
  const NUM_B = "+4915120020002";
  const llm = startDelayedLlmMock(LLM_MOCK_DELAY_MS);
  await llm.listen();
  const activeNumber = (id, e164, tenantId) => ({
    id,
    e164,
    tenantId,
    provider: "telnyx",
    status: "active",
    providerNumberId: null,
  });
  const { seedState } = await import("./helpers.js");
  const { BOOTSTRAP_TENANT_ID } = await import("../src/store/defaults.js");
  const seed = seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      { id: "tenant-t208-a", status: "active", idpSubject: SUB_A, ownerName: "Alice", kycLevel: "card" },
      { id: "tenant-t208-b", status: "active", idpSubject: SUB_B, ownerName: "Bob", kycLevel: "card" },
    ],
    numbers: [
      activeNumber("num_t208_a", NUM_A, "tenant-t208-a"),
      activeNumber("num_t208_b", NUM_B, "tenant-t208-b"),
    ],
    profiles: { "tenant-t208-a": { maxCallsPerHour: null }, "tenant-t208-b": { maxCallsPerHour: null } },
  });
  const srv = await startServer({
    seed,
    env: {
      ...briefingEnv(llm.server.address().port),
      MULTI_TENANT: "true",
      MAX_CALLS_PER_HOUR: String(LIMIT),
    },
  });
  try {
    const targetsA = Array.from(
      { length: TENANT_A_REQUESTS },
      (_unused, index) => `+4915112350${String(T2_TARGET_SUFFIX_START + index)}`,
    );
    const [responsesA, responseB] = await Promise.all([
      Promise.all(targetsA.map((to) => postDe(srv.localUrl, to, SUB_A))),
      postDe(srv.localUrl, "+491511235099", SUB_B),
    ]);
    const statusesA = responsesA.map((response) => response.status);
    const okA = statusesA.filter((status) => status === HTTP_OK).length;
    assert.equal(okA, LIMIT, `Tenant A: erwartet genau ${LIMIT}x 200, bekommen: ${JSON.stringify(statusesA)}`);
    assert.notEqual(
      responseB.status,
      HTTP_TOO_MANY,
      `Tenant B darf NICHT wegen Tenant A's Rennen blockiert werden - hier: ${responseB.status}`,
    );
    assert.ok(
      llm.hits >= LIMIT,
      `Positiv-Kontrolle: die LLM-Attrappe muss mindestens ${LIMIT}x getroffen worden sein (hits=${llm.hits})`,
    );
  } finally {
    await srv.stop();
    await llm.close();
  }
});

function testConfig(overrides = {}) {
  return withConfigNamespaces({
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    platformSpendCapCents: 1000000,
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

function makeMemoryStore({ numbers, throwOnCreateCall = { value: false } } = {}) {
  const calls = [];
  return {
    calls,
    tenantLanguage: () => "de",
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
    load: () => ({ numbers: numbers.map((number) => ({ ...number, provider: "telnyx", status: "active" })) }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: OWNER_NAME, settings: { allowResearch: false } }),
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
    tryReserveOutboundBudget: () => true,
    tenantBudgetSnapshot: () => ({ capCents: 1000000, spentCents: 0, remainingCents: 1000000 }),
    reserveExceedsBudget: () => false,
    claimPlatformSpendWarning: () => null,
    resolveCallLanguage: () => "de",
    countOutboundCallsSince: (_iso, { tenantId, to } = {}) =>
      calls.filter((call) => call.tenantId === tenantId && (to === undefined || call.to === to)).length,
    activeCallsFor: (tenantId) => calls.filter((call) => call.tenantId === tenantId && !call.ended),
    releaseOutboundReserveCents: () => true,
    createCall: (felder) => {
      if (throwOnCreateCall.value) throw new Error("createCall-Wurf (Test-Simulation)");
      const call = { id: `call_${calls.length + 1}`, ended: false, startedAt: new Date().toISOString(), ...felder };
      calls.push(call);
      return call;
    },
    getCall: (id) => calls.find((existing) => existing.id === id) ?? null,
    endCallRecord: (id, status) => {
      const call = calls.find((existing) => existing.id === id);
      if (call) {
        call.status = status;
        call.ended = true;
      }
    },
    recordFailureReason: () => {},
    recordCostProfile: () => {},
    save: () => {},
  };
}

async function startTestApp({ store, config, voiceControl }) {
  const audit = () => {};
  const { gates: outboundGates, callQuotaDenial } = makeOutboundGates({
    store,
    config,
    requestTenant: (req) => req?.headers?.["x-test-tenant"] || DEFAULT_TENANT,
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
      voiceControl: voiceControl || (() => ({ originateCall: async () => ({ sid: "sid_t208" }) })),
      originateElevenLabsCall: async () => ({}),
      terminateAndBillCall,
      hangUpAction: () => null,
      billThunk,
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: {
        requestTenant: (req) => req.headers["x-test-tenant"] || DEFAULT_TENANT,
        requireTenant: (req) => req.headers["x-test-tenant"] || DEFAULT_TENANT,
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
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function postLocal(baseUrl, to, tenant) {
  return fetch(`${baseUrl}/api/calls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(tenant ? { "x-test-tenant": tenant } : {}),
    },
    body: JSON.stringify({ to, objective: OBJECTIVE }),
  });
}

test("T3: ein Wurf im Claim (createCall) -> 503, 0 Datensaetze, Reserve frei - naechste Anfrage 200", async () => {
  const throwOnCreateCall = { value: true };
  const store = makeMemoryStore({
    numbers: [{ tenantId: DEFAULT_TENANT, e164: "+491700000001" }],
    throwOnCreateCall,
  });
  const app = await startTestApp({ store, config: testConfig() });
  try {
    const first = await postLocal(app.baseUrl, "+491711111111");
    assert.equal(first.status, HTTP_SERVICE_UNAVAILABLE, "ein Wurf im Claim muss 503 antworten");
    assert.equal(store.calls.length, 0, "kein Datensatz darf entstanden sein");

    throwOnCreateCall.value = false;
    const second = await postLocal(app.baseUrl, "+491711111111");
    assert.equal(second.status, HTTP_OK, "die Sperre darf nach dem Wurf nicht haengen bleiben");
    assert.equal(store.calls.length, 1, "der zweite Versuch verbraucht seinen eigenen Slot");
  } finally {
    await app.close();
  }
});

test("T4: nicht platzierter Anruf behaelt den Slot (Stundenlimit) - Mandant B bleibt frei", async () => {
  const TENANT_A = "t208-a";
  const TENANT_B = "t208-b";
  const store = makeMemoryStore({
    numbers: [
      { tenantId: TENANT_A, e164: "+491700000002" },
      { tenantId: TENANT_B, e164: "+491700000003" },
    ],
  });
  const failingVoiceControl = () => ({
    originateCall: async () => {
      throw new Error("Originate-Wurf (Test-Simulation)");
    },
  });
  const app = await startTestApp({
    store,
    config: testConfig({ maxCallsPerHour: 1 }),
    voiceControl: failingVoiceControl,
  });
  try {
    const first = await postLocal(app.baseUrl, "+491711111112", TENANT_A);
    assert.ok(
      ORIGINATE_FAILURE_STATUSES.includes(first.status),
      `erster Anruf muss am Originate scheitern (500/502), war: ${first.status}`,
    );
    assert.equal(store.calls.length, 1, "ein Datensatz muss entstanden sein (der gescheiterte Anruf)");
    assert.equal(store.calls[0].status, "failed", "der Datensatz muss als failed markiert sein");

    const second = await postLocal(app.baseUrl, "+491711111113", TENANT_A);
    assert.equal(
      second.status,
      HTTP_TOO_MANY,
      "derselbe Mandant muss jetzt am Stundenlimit (1) abgelehnt werden - der gescheiterte Anruf behaelt den Slot",
    );
    const secondBody = await second.json();
    assert.equal(secondBody.error, GATE_TEXTS.de.hourLimit);

    const thirdOtherTenant = await postLocal(app.baseUrl, "+491711111112", TENANT_B);
    assert.ok(
      ORIGINATE_FAILURE_STATUSES.includes(thirdOtherTenant.status),
      `Mandant B darf NICHT durch Mandant A's Stundenlimit gesperrt sein, war: ${thirdOtherTenant.status}`,
    );
  } finally {
    await app.close();
  }
});

test("T5: Ziel-Cap zaehlt einen beendeten (gescheiterten) Anruf mit - zweiter Versuch am selben Ziel 429 ziel_limit", async () => {
  const store = makeMemoryStore({
    numbers: [{ tenantId: DEFAULT_TENANT, e164: "+491700000004" }],
  });
  const failingVoiceControl = () => ({
    originateCall: async () => {
      throw new Error("Originate-Wurf (Test-Simulation)");
    },
  });
  const target = "+491711111114";
  const app = await startTestApp({
    store,
    config: testConfig({ perTargetCallCap: 1 }),
    voiceControl: failingVoiceControl,
  });
  try {
    const first = await postLocal(app.baseUrl, target);
    assert.ok(ORIGINATE_FAILURE_STATUSES.includes(first.status), `erster Anruf muss scheitern, war: ${first.status}`);
    assert.equal(store.calls.length, 1);

    const second = await postLocal(app.baseUrl, target);
    assert.equal(second.status, HTTP_TOO_MANY, "der Ziel-Cap (1) muss jetzt greifen");
    const secondBody = await second.json();
    assert.equal(secondBody.error, GATE_TEXTS.de.perTargetLimit);
    assert.equal(store.calls.length, 1, "es darf KEIN zweiter Datensatz fuer dasselbe Ziel entstehen");
  } finally {
    await app.close();
  }
});

test("T6: Dedup hat Vorrang vor der Quote - zwei parallele Anfragen an DASSELBE Ziel", async () => {
  const store = makeMemoryStore({
    numbers: [{ tenantId: DEFAULT_TENANT, e164: "+491700000005" }],
  });
  const target = "+491711111115";
  const app = await startTestApp({ store, config: testConfig() });
  try {
    const [responseA, responseB] = await Promise.all([
      postLocal(app.baseUrl, target),
      postLocal(app.baseUrl, target),
    ]);
    assert.equal(responseA.status, HTTP_OK);
    assert.equal(responseB.status, HTTP_OK);
    const [bodyA, bodyB] = await Promise.all([responseA.json(), responseB.json()]);
    const deduplicatedFlags = [bodyA.deduplicated, bodyB.deduplicated].sort();
    assert.deepEqual(
      deduplicatedFlags,
      [false, true],
      "genau EINE der beiden Antworten muss deduplicated:true tragen, die andere false",
    );
    assert.equal(store.calls.length, 1, "es darf nur EIN Datensatz entstehen (bestehende A1-Semantik)");
  } finally {
    await app.close();
  }
});
