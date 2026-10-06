import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStripeWebhook,
  applyStripeWebhookSerialized,
  SUBSCRIPTION_EVENT,
} from "../src/billing/webhook.js";
import { MONEY_EVENT, PAYMENT_ACTION_GRACE_HOURS } from "../src/billing/money-events.js";

const CUSTOMER = "cus_money1";
const TENANT = "t_money1";

function fakeMoneyStore({ customerId = CUSTOMER, tenantId = TENANT } = {}) {
  const calls = { setTenantSubscription: [], setBillingHold: [], clearBillingHold: [] };
  return {
    calls,
    findTenantByCustomer: (cid) => (customerId && cid === customerId ? { id: tenantId } : null),
    findTenantBySubscription: () => null,
    tenantExists: () => true,
    setTenantSubscription: (t, patch) => calls.setTenantSubscription.push([t, patch]),
    setBillingHold: (t, patch) => calls.setBillingHold.push([t, patch]),
    clearBillingHold: (t) => calls.clearBillingHold.push(t),
  };
}

function fakeAudit() {
  const calls = [];
  return { calls, audit: (event, _req, detail) => calls.push({ event, detail }) };
}

function baseDeps(store, audit) {
  return { store, accounts: {}, sessions: {}, audit, req: {}, provision: async () => {}, billing: undefined };
}

test("charge.dispute.created: unbedingtes Audit mit event=, KEIN Store-Write", async () => {
  const store = fakeMoneyStore();
  const { calls, audit } = fakeAudit();
  await applyStripeWebhook(
    { id: "evt_dispute1", type: MONEY_EVENT.DISPUTE_CREATED, data: { object: { customer: CUSTOMER } } },
    baseDeps(store, audit),
  );
  const moneyAudit = calls.find((c) => c.event === "stripe_money_event");
  assert.ok(moneyAudit, "Audit-Eintrag vorhanden");
  assert.match(moneyAudit.detail, /event=evt_dispute1/);
  assert.match(moneyAudit.detail, /type=charge\.dispute\.created/);
  assert.deepEqual(store.calls.setTenantSubscription, [], "kein Store-Write fuer WARN");
  assert.deepEqual(store.calls.setBillingHold, []);
});

test("charge.refunded: periodCreditRevoked:true", async () => {
  const store = fakeMoneyStore();
  const { audit } = fakeAudit();
  await applyStripeWebhook(
    { id: "evt_refund1", type: MONEY_EVENT.REFUNDED, data: { object: { customer: CUSTOMER } } },
    baseDeps(store, audit),
  );
  assert.deepEqual(store.calls.setTenantSubscription, [[TENANT, { periodCreditRevoked: true }]]);
});

test("customer.subscription.paused: billingHold=paused, keine Frist", async () => {
  const store = fakeMoneyStore();
  const { audit } = fakeAudit();
  await applyStripeWebhook(
    {
      id: "evt_paused1",
      type: MONEY_EVENT.SUBSCRIPTION_PAUSED,
      data: { object: { id: "sub_paused1", customer: CUSTOMER } },
    },
    baseDeps(store, audit),
  );
  assert.deepEqual(store.calls.setBillingHold, [[TENANT, { reason: "paused" }]]);
});

test("invoice.payment_action_required: dueAt ~= jetzt + 72h, Hold noch NICHT aktiv", async () => {
  const store = fakeMoneyStore();
  const { audit } = fakeAudit();
  const before = Date.now();
  await applyStripeWebhook(
    {
      id: "evt_par1",
      type: MONEY_EVENT.PAYMENT_ACTION_REQUIRED,
      data: { object: { subscription: "sub_par1", customer: CUSTOMER } },
    },
    baseDeps(store, audit),
  );
  assert.equal(store.calls.setBillingHold.length, 1);
  const [[tenant, patch]] = store.calls.setBillingHold;
  assert.equal(tenant, TENANT);
  assert.equal(patch.reason, "payment_action");
  const dueAtMs = Date.parse(patch.dueAtIso);
  const expectedMs = before + PAYMENT_ACTION_GRACE_HOURS * 60 * 60 * 1000;
  assert.ok(
    Math.abs(dueAtMs - expectedMs) < 5000,
    `dueAt liegt ~72h in der Zukunft (delta=${dueAtMs - expectedMs}ms)`,
  );
});

test("Doppelzustellung derselben event.id -> Wirkung genau einmal (applyStripeWebhookSerialized)", async () => {
  const store = fakeMoneyStore({ tenantId: "t_money_dedup" });
  const { audit } = fakeAudit();
  const event = {
    id: "evt_dedup1",
    type: MONEY_EVENT.REFUNDED,
    data: { object: { customer: CUSTOMER } },
  };
  await applyStripeWebhookSerialized(event, baseDeps(store, audit));
  await applyStripeWebhookSerialized(event, baseDeps(store, audit));
  assert.equal(store.calls.setTenantSubscription.length, 1, "genau EIN Write trotz zweifacher Zustellung");
});

test("ACTIVATE loescht Hold UND Revocation (Reversibilitaet)", async () => {
  const store = fakeMoneyStore();
  store.tenantStripe = () => ({ customerId: null, paymentMethodId: null });
  store.setTenantStripe = () => {};
  store.setKycLevel = () => {};
  store.clearSuspendedAt = () => {};
  store.setProfile = () => ({ profile: {}, changed: [] });
  const priorTenantSubscription = store.tenantSubscription;
  store.tenantSubscription = () => ({ planSlug: null });
  store.ensureTenant = async () => {};
  store.billingHoldActive = () => null;
  store.stampBudgetPeriod = () => false;
  const setStatusCalls = [];
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: { object: { id: "sub_reactivate1", status: "active", metadata: { tenant_ref: TENANT } } },
    },
    {
      store,
      accounts: { setStatus: async (t, st) => setStatusCalls.push([t, st]) },
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
      billing: undefined,
    },
  );
  assert.deepEqual(setStatusCalls, [[TENANT, "active"]]);
  assert.deepEqual(store.calls.clearBillingHold, [TENANT]);
  assert.ok(
    store.calls.setTenantSubscription.some(
      ([t, patch]) => t === TENANT && patch.periodCreditRevoked === false,
    ),
    "periodCreditRevoked wird auf false zurueckgesetzt",
  );
  void priorTenantSubscription;
});

test("unbekannter Tenant (customerId ohne Treffer) -> no_tenant-Audit, kein Write", async () => {
  const store = fakeMoneyStore({ customerId: null });
  const { calls, audit } = fakeAudit();
  await applyStripeWebhook(
    {
      id: "evt_unknown1",
      type: MONEY_EVENT.REFUNDED,
      data: { object: { customer: "cus_unbekannt" } },
    },
    baseDeps(store, audit),
  );
  assert.ok(calls.some((c) => c.event === "stripe_money_event_ignored" && c.detail === "no_tenant"));
  assert.deepEqual(store.calls.setTenantSubscription, []);
});
