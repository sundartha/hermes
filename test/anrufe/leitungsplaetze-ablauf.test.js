import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeLeitungsplaetze } from "../../src/store.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeOutboundGates } from "../../src/telephony/outbound-gates.js";
import { makeCallRoutes } from "../../src/routes/api-calls.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const TENANT = "T";
const OBJECTIVE = "Termin vereinbaren";
const HOECHSTDAUER_S = 60;
const PUFFER_S = 120;
const ABLAUF_MS = (HOECHSTDAUER_S + PUFFER_S) * 1000;
const START_MS = 1_800_000_000_000;
const ZIEL_ERSTER = "+491711234501";
const ZIEL_ZWEITER = "+491711234502";
const LANGE_DAUER_S = 100000;
const NUTZABLE_TELNYX_PLAETZE = 90;

function testStore(echt) {
  return {
    ...echt,
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
    load: () => ({ numbers: [{ tenantId: TENANT, status: "active", provider: "telnyx", e164: "+491700000000" }] }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice", settings: { allowResearch: false } }),
    resolveProfile: () => ({ unrestricted: true, allowedCountryCodes: null, maxCallsPerHour: null, allowedNumbers: [], allowConsult: false, allowLookup: false }),
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    tenantBudgetSnapshot: () => ({ capCents: 1000000, spentCents: 0, remainingCents: 1000000 }),
    reserveExceedsBudget: () => false,
    claimPlatformSpendWarning: () => null,
    resolveCallLanguage: () => "de",
  };
}

const config = withConfigNamespaces({
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
});

async function starteRoute(leitungsplaetze) {
  const { store: echterStore } = await makePgTestStore();
  const store = testStore(echterStore);
  const audit = () => {};
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
      leitungsplaetze,
      config,
      audit,
      outboundGates,
      callQuotaDenial,
      voiceControl: () => ({ originateCall: async () => ({ sid: "sid_ablauf" }) }),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => TENANT, requireTenant: () => TENANT, tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/calls`;
  const post = async (to) => {
    const res = await abrufMitFrist(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, objective: OBJECTIVE, max_duration_s: HOECHSTDAUER_S }),
    });
    return res.status;
  };
  return { post, stop: () => new Promise((resolve) => server.close(resolve)) };
}

test("Ablauf: der Telnyx-Platz eines ueber POST /api/calls gestarteten Anrufs wird bei Hoechstdauer plus 120 s frei, eine Millisekunde davor nicht", async () => {
  process.env.PRECALL_BRIEFING_ENABLED = "false";
  process.env.ASSISTANT_CONTEXT_ENABLED = "false";
  process.env.IN_CALL_CONSULT_ENABLED = "false";
  process.env.CONSULT_ENABLED = "false";
  process.env.METRICS_ENABLED = "false";
  let jetzt = START_MS;
  const leitungsplaetze = makeLeitungsplaetze({ jetztMs: () => jetzt });
  const srv = await starteRoute(leitungsplaetze);
  try {
    assert.equal(await srv.post(ZIEL_ERSTER), HTTP_OK, "der erste Anruf belegt einen Platz");
    for (let index = 1; index < NUTZABLE_TELNYX_PLAETZE; index += 1) {
      await leitungsplaetze.belegenAusgehend({ callId: `vorbelegt_${index}`, weg: "telnyx", maxDauerS: LANGE_DAUER_S });
    }
    jetzt = START_MS + ABLAUF_MS - 1;
    assert.equal(await srv.post(ZIEL_ZWEITER), HTTP_UNAVAILABLE, "eine Millisekunde vor dem Ablauf ist der Platz noch belegt");
    jetzt = START_MS + ABLAUF_MS;
    assert.equal(await srv.post(ZIEL_ZWEITER), HTTP_OK, "zur Ablaufzeit ist der Platz frei");
  } finally {
    await srv.stop();
  }
});
