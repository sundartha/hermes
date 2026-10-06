import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, PLAN_PRICE_BOOT_ENV } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { findPlan } from "../src/plans.js";

const GATE_PROOF_ENV = Object.freeze({ FAKE_ORIGINATE: "true" });
const TELNYX_OWNER_NUMBER = { e164: "+4915005559001", provider: "telnyx" };
const TO = "+4915112345678";
const A = "tenant-a",
  SUB_A = "sub-a",
  NUM_A_TELNYX = "+4915005559002";

function seedOwnerTelnyx(tenantOverrides = {}) {
  return seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ...tenantOverrides }] });
}

function seedTenantATelnyx({ kycLevel = "card", ownerName = "Alice A", status = "active", profiles, calls = [] } = {}) {
  return seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: A,
        status,
        idpSubject: SUB_A,
        ...(ownerName ? { ownerName } : {}),
        ...(kycLevel ? { kycLevel } : {}),
      },
    ],
    numbers: [
      { id: "num_a", e164: NUM_A_TELNYX, tenantId: A, provider: "telnyx", status: "active", providerNumberId: null },
    ],
    profiles: profiles ?? { [A]: { maxCallsPerHour: null } },
    calls,
  });
}

const bucket = (costEur) => ({ inputTokens: 0, outputTokens: 0, costEur, calls: costEur ? 1 : 0 });
const STARTER_MIN = findPlan("starter").includedMinutes;
const fiveDaysAgoSec = Math.floor(Date.now() / 1000) - 5 * 86400;
const voiceMinuteEvent = (tenantId, quantity) => ({
  id: `ue_${tenantId}`,
  tenantId,
  callId: null,
  kind: USAGE_EVENT_KIND.VOICE_MINUTE,
  quantity,
  costCents: 0,
  occurredAt: new Date().toISOString(),
  stripeMeterSent: false,
});

const REQUEST_OBJECTIVE = "Termin vereinbaren (P5-Gate-Beweis)";
async function placeCallFlagOn({ env = {}, seed, ownerNumber, identity, to = TO, status, grund }) {
  const srv = await startServer({ env: { ...GATE_PROOF_ENV, ...env }, seed, ownerNumber });
  try {
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(identity ? { "X-Internal-Identity": identity } : {}) },
      body: JSON.stringify({ to, objective: REQUEST_OBJECTIVE }),
    });
    assert.equal(res.status, status, `erwartete Deny-Antwort fuer Gate "${grund}"`);
    const created = srv.readStore().calls.filter((c) => c.goal === REQUEST_OBJECTIVE);
    assert.equal(created.length, 0, `Gate "${grund}": Origination nicht erreicht -> kein Call-Record`);
    return res;
  } finally {
    await srv.stop();
  }
}

test("Gate 0 FROZEN: OUTBOUND_FROZEN=true blockt (403)", async () => {
  const res = await placeCallFlagOn({
    env: { OUTBOUND_FROZEN: "true" },
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    status: 403,
    grund: "frozen",
  });
  assert.match((await res.json()).error, /gesperrt|OUTBOUND_FROZEN/);
});

test("Gate 1 TENANT_REJECT: unbekannte Identitaet blockt (403)", async () => {
  await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    identity: "sub-voellig-unbekannt",
    status: 403,
    grund: "tenant_unbekannt",
  });
});

test("Gate 2 KYC: kyc_level<card (otp) blockt (403)", async () => {
  const res = await placeCallFlagOn({
    seed: seedOwnerTelnyx({ kycLevel: "otp" }),
    ownerNumber: TELNYX_OWNER_NUMBER,
    status: 403,
    grund: "kyc",
  });
  assert.match((await res.json()).error, /KYC/i);
});

test("Gate 3 ownerName: fehlender Auftraggeber-Name blockt (403)", async () => {
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed: seedTenantATelnyx({ ownerName: null }),
    identity: SUB_A,
    status: 403,
    grund: "keine_identitaet",
  });
  assert.match((await res.json()).error, /Auftraggeber-Name/);
});

test("Gate 4 Denylist: Notruf-Kurzwahl blockt (403)", async () => {
  const res = await placeCallFlagOn({
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    to: "112",
    status: 403,
    grund: "denylist",
  });
  assert.match((await res.json()).error, /is blocked/);
});

test("Gate 5 E.164: nicht-E.164-Ziel blockt (400)", async () => {
  await placeCallFlagOn({
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    to: "12345",
    status: 400,
    grund: "format",
  });
});

test("Gate 6 Land: Ziel ausserhalb ALLOWED_COUNTRY_CODES blockt (403)", async () => {
  const res = await placeCallFlagOn({
    env: { ALLOWED_COUNTRY_CODES: "+49" },
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    to: "+12025550123",
    status: 403,
    grund: "land",
  });
  assert.match((await res.json()).error, /Country code/);
});

test("Gate 7 Stundenlimit: MAX_CALLS_PER_HOUR erreicht blockt (429)", async () => {
  const res = await placeCallFlagOn({
    env: { MAX_CALLS_PER_HOUR: "1" },
    seed: seedState({ calls: [seedCall({ id: "c_recent" })] }),
    status: 429,
    grund: "stundenlimit",
  });
  assert.match((await res.json()).error, /Hourly limit/);
});

test("Gate 8 Profil-Limit 0: profil-loser Tenant (DEFAULT=0) blockt (429)", async () => {
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed: seedTenantATelnyx({ profiles: {} }),
    identity: SUB_A,
    status: 429,
    grund: "stundenlimit",
  });
  assert.match((await res.json()).error, /Hourly limit/);
});

test("Gate 9 Cooldown: per-(Tenant,Ziel)-Cap erreicht blockt (429)", async () => {
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true", PER_TARGET_CALL_CAP: "1" },
    seed: seedTenantATelnyx({ calls: [seedCall({ id: "c_prior", tenantId: A })] }),
    identity: SUB_A,
    status: 429,
    grund: "ziel_limit",
  });
  assert.match((await res.json()).error, /Repeat limit/);
});

test("Gate 10 Verifikation: suspendierter Tenant blockt (403, Defense-in-depth)", async () => {
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed: seedTenantATelnyx({ status: "suspended" }),
    identity: SUB_A,
    status: 403,
    grund: "abo",
  });
  assert.match((await res.json()).error, /Subscription inactive|blocked/i);
});

test("Gate 11 Budget: erschoepftes Tenant-Budget blockt (402)", async () => {
  const seed = seedTenantATelnyx();
  seed.usage = { [BOOTSTRAP_TENANT_ID]: bucket(0), [A]: bucket(99) };
  const res = await placeCallFlagOn({
    env: { MULTI_TENANT: "true" },
    seed,
    identity: SUB_A,
    status: 402,
    grund: "budget",
  });
  assert.match((await res.json()).error, /budget limit/);
});

test("Gate 12 Minuten: erschoepftes Plan-Kontingent blockt (402)", async () => {
  const seed = seedTenantATelnyx();
  const tenantA = seed.tenants.find((t) => t.id === A);
  tenantA.stripePlanSlug = "starter";
  tenantA.stripeCurrentPeriodStart = fiveDaysAgoSec;
  seed.usageEvents = [voiceMinuteEvent(A, STARTER_MIN)];
  const res = await placeCallFlagOn({
    env: {
      MULTI_TENANT: "true",
      PAYMENT_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_test_x",
      STRIPE_API_BASE: "http://127.0.0.1:9",
      NUMBER_SETUP_FEE_CENTS: "500",
      ...PLAN_PRICE_BOOT_ENV,
    },
    seed,
    identity: SUB_A,
    status: 402,
    grund: "minutes",
  });
  assert.match((await res.json()).error, /Plan-Minuten/);
});

test("Gate 13 Reserve: Worst-Case-Reserve > Cap blockt (402)", async () => {
  const res = await placeCallFlagOn({
    env: { MAX_BUDGET_EUR: "5", VOICE_TARIFF_DEFAULT_CENTS: "400" },
    seed: seedOwnerTelnyx(),
    ownerNumber: TELNYX_OWNER_NUMBER,
    to: "+12025550123",
    status: 402,
    grund: "reserve_ueber_rest",
  });
  assert.match((await res.json()).error, /\d+\.\d{2} EUR short/);
});
