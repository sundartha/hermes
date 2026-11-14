import assert from "node:assert/strict";
import { before, test } from "node:test";

import express from "express";
import { makeLeitungsplaetze } from "../../src/store.js";
import { schalteNebenkanaeleAb, seedState, tempDataDir } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT = "T";
const VALID_TO = "+491711234567";
const HTTP_SERVICE_UNAVAILABLE = 503;

let makeCallRoutes;
let makeOutboundGates;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.js"));
  ({ makeOutboundGates } = await import("../../src/telephony/outbound-gates.js"));
});

const store = () => ({
  tenantLanguage: () => "de",
  countOutboundCallsSince: () => 0,
  tenantPrivateNumber: () => null,
  tenantGeo: () => ({ country: "DE", defaultLanguage: "de" }),
  load: () => ({ numbers: [{ tenantId: TENANT, status: "active", provider: "telnyx", e164: "+491700000000" }] }),
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
  tryReserveOutboundBudget: () => true,
  tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
  reserveExceedsBudget: () => true,
  claimPlatformSpendWarning: () => null,
  resolveCallLanguage: () => "de",
  activeCallsFor: () => [],
  releaseOutboundReserveCents: () => true,
  createCall: () => {
    throw new Error("Datenbank weg");
  },
  recordCostProfile: () => {},
  save: () => {},
});

const config = () =>
  withConfigNamespaces({
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

test("Scheitert das Anlegen des Anrufs, gibt POST /api/calls die Datenbank-Reserve dieses Anrufs und Mandanten frei", async () => {
  const s = store();
  const cfg = config();
  const audit = () => {};
  const freigaben = [];
  const budgetReservierung = {
    reservieren: async () => ({ reserviert: true }),
    freigeben: async (angabe) => {
      freigaben.push(angabe);
    },
  };
  const { gates: outboundGates, callQuotaDenial } = makeOutboundGates({
    store: s,
    config: cfg,
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
      store: s,
      leitungsplaetze: makeLeitungsplaetze(),
      budgetReservierung,
      config: cfg,
      audit,
      outboundGates,
      callQuotaDenial,
      voiceControl: () => ({ originateCall: async () => ({ sid: "sid" }) }),
      originateElevenLabsCall: async () => ({ sid: "sid" }),
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
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: VALID_TO, objective: "Termin vereinbaren" }),
    });
    assert.equal(res.status, HTTP_SERVICE_UNAVAILABLE);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(freigaben.length, 1);
  assert.equal(freigaben[0].tenantId, TENANT);
  assert.match(freigaben[0].callId, /^call_/);
});
