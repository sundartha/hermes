import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import { activateSubscriptionFromCheckoutSession } from "../src/billing/subscribe.js";
import * as storeFacade from "../src/store.js";
import {
  makeDefaultState,
  registerTenant,
  setKycLevel,
  tenantSubscription,
  setTenantSubscription,
  setProfile,
  clearSuspendedAt,
  billingHoldActive,
  setBillingHold,
  clearBillingHold,
  stampBudgetPeriod,
  tenantStripe,
  setTenantStripe,
  tenantExists,
  usageFor,
} from "../src/store/state-ops.js";

const TENANT = "t_fw1_known";
const GHOST_TENANT = "t_fw1_ghost";
const NOW_ISO = "2026-09-07T00:00:00.000Z";
const MS_PER_SECOND = 1000;

const WRITE_METHODS = Object.freeze([
  "setTenantSubscription",
  "setBillingHold",
  "setKycLevel",
  "setTenantStripe",
  "setSuspendedAtIfAbsent",
  "clearSuspendedAt",
  "clearBillingHold",
  "setProfile",
  "ensureTenant",
  "stampBudgetPeriod",
]);

function recordingStore({ known = true } = {}) {
  const calls = { writes: [], tenantExists: 0 };
  const store = {
    tenantExists: (_tenantId) => {
      calls.tenantExists += 1;
      return known;
    },
    tenantStripe: () => ({ customerId: null, paymentMethodId: null }),
    tenantSubscription: () => ({ planSlug: null, cancelAtPeriodEnd: false }),
    billingHoldActive: () => null,
    findTenantBySubscription: () => null,
    findTenantByCustomer: () => null,
  };
  for (const method of WRITE_METHODS) {
    store[method] = (...args) => {
      calls.writes.push({ method, args });
    };
  }
  return { calls, store };
}

function fakeAudit() {
  const calls = [];
  return { calls, audit: (event, _req, detail) => calls.push({ event, detail }) };
}

function fakeAccounts() {
  const calls = [];
  return { calls, setStatus: async (tenant, status) => calls.push({ tenant, status }) };
}

function createdEvent(tenantRef, { subscriptionId = "sub_x" } = {}) {
  return {
    type: SUBSCRIPTION_EVENT.CREATED,
    data: { object: { id: subscriptionId, status: "active", metadata: { tenant_ref: tenantRef } } },
  };
}

function deletedEvent(tenantRef, { subscriptionId = "sub_x" } = {}) {
  return {
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: subscriptionId, metadata: { tenant_ref: tenantRef } } },
  };
}

function refundedEvent(tenantRef) {
  return {
    type: "charge.refunded",
    id: "evt_refund_1",
    data: { object: { id: "ch_1", customer: null, metadata: { tenant_ref: tenantRef } } },
  };
}

test("FW1-A1: ACTIVATE mit unbekanntem tenant_ref wird ignoriert, kein Write", async () => {
  const { calls, store } = recordingStore({ known: false });
  const { calls: auditCalls, audit } = fakeAudit();
  await applyStripeWebhook(createdEvent(GHOST_TENANT), {
    store,
    accounts: fakeAccounts(),
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.equal(calls.writes.length, 0, "kein einziger Schreibzugriff");
  assert.deepEqual(
    auditCalls.map((entry) => entry.detail),
    [`action=activate tenant=${GHOST_TENANT} unknown_tenant`],
  );
});

test("FW1-A2: SUSPEND (deleted) mit unbekanntem tenant_ref wird ignoriert, kein Write", async () => {
  const { calls, store } = recordingStore({ known: false });
  const { calls: auditCalls, audit } = fakeAudit();
  const accounts = fakeAccounts();
  await applyStripeWebhook(deletedEvent(GHOST_TENANT), {
    store,
    accounts,
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.equal(accounts.calls.length, 0, "kein setStatus");
  assert.equal(calls.writes.length, 0, "kein einziger Schreibzugriff");
  assert.deepEqual(
    auditCalls.map((entry) => entry.detail),
    [`action=suspend tenant=${GHOST_TENANT} unknown_tenant`],
  );
});

test("FW1-A3: Geld-Ereignis mit unbekanntem tenant_ref wird ignoriert, kein Write", async () => {
  const { calls, store } = recordingStore({ known: false });
  const { calls: auditCalls, audit } = fakeAudit();
  await applyStripeWebhook(refundedEvent(GHOST_TENANT), { store, audit, req: {} });
  assert.equal(calls.writes.length, 0, "kein einziger Schreibzugriff");
  assert.deepEqual(
    auditCalls.map((entry) => entry.event),
    ["stripe_money_event", "stripe_money_event_ignored"],
    "unbedingtes Audit bleibt VOR der Aufloesung stehen",
  );
  assert.equal(auditCalls[1].detail, `tenant=${GHOST_TENANT} unknown_tenant`);
});

test("FW1-A4: ACTIVATE mit bekanntem tenant_ref aktiviert unveraendert", async () => {
  const { calls, store } = recordingStore({ known: true });
  const { audit } = fakeAudit();
  const accounts = fakeAccounts();
  await applyStripeWebhook(createdEvent(TENANT), {
    store,
    accounts,
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.deepEqual(accounts.calls, [{ tenant: TENANT, status: "active" }]);
  assert.ok(calls.writes.some((entry) => entry.method === "setKycLevel"), "KYC wird gehoben");
  assert.ok(
    calls.writes.some((entry) => entry.method === "clearBillingHold"),
    "FW1-B: die Ruecknahme laeuft jetzt ueber activatePaidTenant, auch im Webhook-Pfad",
  );
});

test("FW1-A5: Geld-Ereignis mit bekanntem tenant_ref wirkt unveraendert", async () => {
  const { calls, store } = recordingStore({ known: true });
  const { audit } = fakeAudit();
  await applyStripeWebhook(refundedEvent(TENANT), { store, audit, req: {} });
  assert.deepEqual(
    calls.writes.filter((entry) => entry.method === "setTenantSubscription"),
    [{ method: "setTenantSubscription", args: [TENANT, { periodCreditRevoked: true }] }],
  );
});

test("FW1-A6: no_tenant bleibt byte-identisch, kein tenantExists-Aufruf", async () => {
  const { calls, store } = recordingStore({ known: true });
  const { calls: auditCalls, audit } = fakeAudit();
  const event = {
    type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
    data: { object: { subscription: "sub_missing", customer: null, metadata: {} } },
  };
  await applyStripeWebhook(event, {
    store,
    accounts: fakeAccounts(),
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.deepEqual(auditCalls.map((entry) => entry.detail), ["action=suspend no_tenant"]);
  assert.equal(calls.tenantExists, 0, "no_tenant-Pfad ohne jeden Store-Zugriff");
});

test("FW1-A7: store.js re-exportiert tenantExists (sonst TypeError zur Laufzeit)", () => {
  assert.equal(typeof storeFacade.tenantExists, "function", "tenantExists fehlt in der Fassade");
});

function stateStore(state) {
  return {
    setKycLevel: (tenant, level) => setKycLevel(state, tenant, level),
    tenantSubscription: (tenant) => tenantSubscription(state, tenant),
    setTenantSubscription: (tenant, patch) => setTenantSubscription(state, tenant, patch),
    setProfile: (key, patch) => setProfile(state, key, patch),
    clearSuspendedAt: (tenant) => clearSuspendedAt(state, tenant),
    billingHoldActive: (tenant) => billingHoldActive(state, tenant, NOW_ISO),
    clearBillingHold: (tenant) => clearBillingHold(state, tenant),
    stampBudgetPeriod: (tenant, periodIso) => stampBudgetPeriod(state, tenant, periodIso).changed,
    ensureTenant: async () => {},
    tenantStripe: (tenant) => tenantStripe(state, tenant),
    setTenantStripe: (tenant, patch) => setTenantStripe(state, tenant, patch),
    findTenantBySubscription: () => null,
    tenantExists: (tenant) => tenantExists(state, tenant),
    setSuspendedAtIfAbsent: () => {},
  };
}

const CHECKOUT_OUTCOME = Object.freeze({
  customerId: "cus_fw1",
  paymentMethodId: "pm_fw1",
  subscriptionId: "sub_fw1_checkout",
  currentPeriodStart: 1890864000,
  currentPeriodEnd: 1893456000,
  planSlug: "starter",
});

function withHold(state) {
  registerTenant(state, TENANT, {});
  setTenantStripe(state, TENANT, { customerId: CHECKOUT_OUTCOME.customerId, paymentMethodId: null });
  setBillingHold(state, TENANT, { reason: "paused" });
  setTenantSubscription(state, TENANT, { periodCreditRevoked: true });
  return state;
}

test("FW1-B1: Checkout-Rueckkehr ok-Pfad hebt Beanstandung auf und stempelt danach", async () => {
  const state = makeDefaultState();
  withHold(state);
  const store = stateStore(state);
  const result = await activateSubscriptionFromCheckoutSession({
    store,
    billing: { getSubscriptionCheckoutResult: async () => CHECKOUT_OUTCOME },
    accounts: { setStatus: async () => {} },
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: TENANT,
    sessionId: "cs_fw1_ok",
    expectedPlanSlug: "starter",
  });
  assert.equal(result.ok, true);
  assert.equal(billingHoldActive(state, TENANT, NOW_ISO), null, "Hold geraeumt");
  assert.equal(tenantSubscription(state, TENANT).periodCreditRevoked, false);
  assert.ok(usageFor(state, TENANT).budgetPeriodKey, "Periode wurde gestempelt");
});

test("FW1-B2: Checkout-Rueckkehr mit ungeklaertem Provisioning laesst die Beanstandung stehen", async () => {
  const state = makeDefaultState();
  withHold(state);
  const store = stateStore(state);
  const result = await activateSubscriptionFromCheckoutSession({
    store,
    billing: { getSubscriptionCheckoutResult: async () => CHECKOUT_OUTCOME },
    accounts: { setStatus: async () => {} },
    provision: async () => ({ ok: false, reason: "tenant_cap" }),
    tenant: TENANT,
    sessionId: "cs_fw1_cap",
    expectedPlanSlug: "starter",
  });
  assert.equal(result.ok, true, "der Checkout-Return selbst meldet ok (activated steckt in result.provisioned)");
  assert.equal(billingHoldActive(state, TENANT, NOW_ISO), "paused", "Hold bleibt (fail-closed)");
  assert.equal(tenantSubscription(state, TENANT).periodCreditRevoked, true, "Beanstandung bleibt");
  assert.equal(usageFor(state, TENANT).budgetPeriodKey, null, "kein Stempel ohne geklaertes Provisioning");
});

test("FW1-B3: Webhook-ACTIVATE raeumt einen aktiven Hold und stempelt (budget_period=reset)", async () => {
  const state = makeDefaultState();
  withHold(state);
  const store = stateStore(state);
  const { calls: auditCalls, audit } = fakeAudit();
  const event = {
    type: SUBSCRIPTION_EVENT.CREATED,
    data: {
      object: {
        id: "sub_fw1_b3",
        status: "active",
        metadata: { tenant_ref: TENANT },
        current_period_start: CHECKOUT_OUTCOME.currentPeriodStart,
        current_period_end: CHECKOUT_OUTCOME.currentPeriodEnd,
      },
    },
  };
  await applyStripeWebhook(event, {
    store,
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  assert.equal(billingHoldActive(state, TENANT, NOW_ISO), null, "Hold geraeumt");
  const activateAudit = auditCalls.find((entry) => entry.event === "stripe_webhook_activate");
  assert.ok(activateAudit, "Activate-Audit vorhanden");
  assert.match(activateAudit.detail, /budget_period=reset/);
});

test("FW1-B4: Webhook-ACTIVATE ohne Hold stempelt einmal, kein Doppel-Baseline-Reset", async () => {
  const state = makeDefaultState();
  registerTenant(state, TENANT, {});
  setTenantStripe(state, TENANT, { customerId: CHECKOUT_OUTCOME.customerId, paymentMethodId: null });
  const store = stateStore(state);
  const { calls: auditCalls, audit } = fakeAudit();
  const event = {
    type: SUBSCRIPTION_EVENT.CREATED,
    data: {
      object: {
        id: "sub_fw1_b4",
        status: "active",
        metadata: { tenant_ref: TENANT },
        current_period_start: CHECKOUT_OUTCOME.currentPeriodStart,
        current_period_end: CHECKOUT_OUTCOME.currentPeriodEnd,
      },
    },
  };
  await applyStripeWebhook(event, {
    store,
    accounts: { setStatus: async () => {} },
    sessions: { invalidateByTenant: async () => {} },
    audit,
    req: {},
    provision: async () => ({ ok: true, reason: "queued" }),
    billing: undefined,
  });
  const bucket = usageFor(state, TENANT);
  const baselineAfterFirstApply = bucket.budgetPeriodBaselineCents;
  const secondAttempt = stampBudgetPeriod(
    state,
    TENANT,
    new Date(CHECKOUT_OUTCOME.currentPeriodStart * MS_PER_SECOND).toISOString(),
  );
  assert.equal(secondAttempt.changed, false, "zweiter Stempelversuch derselben Periode ist No-Op");
  assert.equal(bucket.budgetPeriodBaselineCents, baselineAfterFirstApply, "keine Doppel-Baseline");
  const activateAudit = auditCalls.find((entry) => entry.event === "stripe_webhook_activate");
  assert.match(activateAudit.detail, /budget_period=reset/);
});
