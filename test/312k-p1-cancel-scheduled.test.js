import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStripeWebhook,
  applyStripeWebhookSerialized,
  interpretStripeEvent,
  SUBSCRIPTION_EVENT,
  WEBHOOK_ACTION,
} from "../src/billing/webhook.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantSubscription,
  tenantSubscription,
} from "../src/store/state-ops.js";
import { KYC_LEVEL } from "../src/store/defaults.js";

const TENANT = "t_312k";

function fakeDeps({ tenantBySub = null } = {}) {
  const calls = {
    setStatus: [],
    invalidate: [],
    subscription: [],
    kyc: [],
    provision: [],
    stripe: [],
    suspend: [],
    clearSuspend: [],
    clearBillingHold: [],
    audit: [],
  };
  return {
    calls,
    store: {
      findTenantBySubscription: (subId) => (tenantBySub && subId ? { id: tenantBySub } : null),
      tenantExists: () => true,
      setTenantSubscription: (tenant, patch) => calls.subscription.push([tenant, patch]),
      setKycLevel: (tenant, level) => calls.kyc.push([tenant, level]),
      tenantStripe: () => ({ customerId: null, paymentMethodId: null }),
      setTenantStripe: (tenant, patch) => calls.stripe.push([tenant, patch]),
      tenantSubscription: () => ({ planSlug: null }),
      setProfile: () => ({ profile: {}, changed: [] }),
      setSuspendedAtIfAbsent: (tenant) => calls.suspend.push(tenant),
      clearSuspendedAt: (tenant) => calls.clearSuspend.push(tenant),
      ensureTenant: async () => {},
      clearBillingHold: (tenant) => calls.clearBillingHold.push(tenant),
      billingHoldActive: () => null,
      stampBudgetPeriod: () => false,
    },
    accounts: {
      setStatus: async (tenant, status) => calls.setStatus.push([tenant, status]),
      accountByTenant: async () => null,
    },
    sessions: { invalidateByTenant: async (tenant) => calls.invalidate.push(tenant) },
    audit: (name, _req, detail) => calls.audit.push([name, detail]),
    req: {},
    provision: async (tenant) => {
      calls.provision.push(tenant);
      return { ok: true, reason: "queued" };
    },
  };
}

const PERIOD_END = 1_900_000_000;

function cancelEvent({ id, created, subId = "sub_312k", tenant = TENANT, planSlug = "starter" } = {}) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: subId,
        status: "active",
        cancel_at_period_end: true,
        current_period_end: PERIOD_END,
        metadata: { tenant_ref: tenant, plan_slug: planSlug },
      },
    },
  };
}

function revokeEvent({ id, created, subId = "sub_312k", tenant = TENANT, planSlug = "starter" } = {}) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: subId,
        status: "active",
        cancel_at_period_end: false,
        current_period_end: PERIOD_END,
        metadata: { tenant_ref: tenant, plan_slug: planSlug },
      },
    },
  };
}

function deletedEvent({ id, created, subId = "sub_312k", tenant = TENANT } = {}) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: subId, metadata: { tenant_ref: tenant } } },
  };
}

test("interpretStripeEvent: cancel_at_period_end=true bei active -> CANCEL_SCHEDULED (nicht ACTIVATE)", () => {
  const out = interpretStripeEvent(cancelEvent({ id: "evt_i1", created: 1 }));
  assert.equal(out.action, WEBHOOK_ACTION.CANCEL_SCHEDULED);
  assert.equal(out.cancelAtPeriodEnd, true);
});

test("interpretStripeEvent: cancel_at_period_end=false (explizit) -> ACTIVATE mit cancelAtPeriodEnd:false", () => {
  const out = interpretStripeEvent(revokeEvent({ id: "evt_i2", created: 1 }));
  assert.equal(out.action, WEBHOOK_ACTION.ACTIVATE);
  assert.equal(out.cancelAtPeriodEnd, false);
});

test("interpretStripeEvent: Feld fehlt (Bestandsform ohne cancel_at_period_end) -> ACTIVATE OHNE cancelAtPeriodEnd-Key", () => {
  const out = interpretStripeEvent({
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: { object: { id: "sub_x", status: "active", metadata: { tenant_ref: TENANT } } },
  });
  assert.equal(out.action, WEBHOOK_ACTION.ACTIVATE);
  assert.equal("cancelAtPeriodEnd" in out, false, "kein falsches false ohne Beleg (Bestandscharakterisierung bleibt gruen)");
});

test("312k-P1 Test 1: updated cancel_at_period_end=true/active -> Kuendigung vermerkt, KEIN clearSuspendedAt/setStatus/KYC/provision/BillingHold-Reset", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(cancelEvent({ id: "evt_1", created: 1 }), deps);
  assert.deepEqual(
    deps.calls.subscription,
    [[TENANT, { cancelAtPeriodEnd: true, subscriptionId: "sub_312k", planSlug: "starter", currentPeriodEnd: PERIOD_END }]],
    "Kuendigung + aktuelle Periode vermerkt",
  );
  assert.deepEqual(deps.calls.clearSuspend, [], "clearSuspendedAt wird NICHT aufgerufen (der gefaehrliche Befund aus Teil A)");
  assert.deepEqual(deps.calls.clearBillingHold, [], "kein Billing-Hold-Reset");
  assert.deepEqual(deps.calls.setStatus, [], "kein Statuswechsel - der Tenant bleibt aktiv, weil er bezahlt hat");
  assert.deepEqual(deps.calls.kyc, [], "keine KYC-Hebung durch eine blosse Kuendigungsvormerkung");
  assert.deepEqual(deps.calls.provision, [], "kein Provisioning-Trigger");
  assert.equal(deps.calls.audit.length, 1);
  assert.equal(deps.calls.audit[0][0], "stripe_webhook_cancel_scheduled");
});

test("312k-P1 Test 1b: unbekannter Plan-Slug im CANCEL_SCHEDULED-Event -> fail-closed ignoriert (Muster ACTIVATE)", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(cancelEvent({ id: "evt_1b", created: 1, planSlug: "nicht_im_katalog" }), deps);
  assert.deepEqual(deps.calls.subscription, [], "kein Store-Write bei unbekanntem Slug");
  assert.equal(deps.calls.audit[0][0], "stripe_webhook_ignored");
});

test("312k-P1 Test 2a (Webhook-Dispatch): updated cancel_at_period_end=false -> ACTIVATE-Patch traegt cancelAtPeriodEnd:false, normale Aktivierungslogik greift wieder", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(revokeEvent({ id: "evt_2a", created: 1 }), deps);
  const [tenant, patch] = deps.calls.subscription[0];
  assert.equal(tenant, TENANT);
  assert.equal(patch.cancelAtPeriodEnd, false, "der Vermerk wird aktiv geloescht, nicht nur uebersprungen");
  assert.deepEqual(deps.calls.kyc, [[TENANT, KYC_LEVEL.CARD]], "normale Aktivierungslogik greift wieder");
  assert.deepEqual(deps.calls.setStatus, [[TENANT, "active"]]);
  assert.deepEqual(deps.calls.provision, [TENANT]);
});

test("312k-P1 Test 2b (Store-Ebene): setTenantSubscription/tenantSubscription Roundtrip inkl. Ruecknahme - Vermerk ist weg", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_store_cancel", {});
  assert.equal(tenantSubscription(s, "t_store_cancel").cancelAtPeriodEnd, false, "fail-closed Default false");
  setTenantSubscription(s, "t_store_cancel", { cancelAtPeriodEnd: true });
  assert.equal(tenantSubscription(s, "t_store_cancel").cancelAtPeriodEnd, true, "Kuendigung vermerkt");
  setTenantSubscription(s, "t_store_cancel", { cancelAtPeriodEnd: false });
  assert.equal(tenantSubscription(s, "t_store_cancel").cancelAtPeriodEnd, false, "Ruecknahme: Vermerk ist weg");
});

test("312k-P1 Test 3: customer.subscription.deleted bleibt SUSPEND (kein gespeichertes Abo -> nichts zu entwerten, s. CL1-B2)", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(deletedEvent({ id: "evt_3", created: 1 }), deps);
  assert.deepEqual(deps.calls.setStatus, [[TENANT, "suspended"]]);
  assert.deepEqual(deps.calls.invalidate, [TENANT]);
  assert.deepEqual(deps.calls.suspend, [TENANT]);
  assert.deepEqual(deps.calls.provision, [], "Suspend kauft nie");
  assert.deepEqual(deps.calls.subscription, [], "SUSPEND patcht keine Abo-Felder - unveraendert durch diese Phase");
});

test("312k-P1 Test 4a: Event-ID-Dedup gilt auch fuer CANCEL_SCHEDULED", async () => {
  const subId = "sub_312k_dedup";
  const deps = fakeDeps();
  const evt = cancelEvent({ id: "evt_312k_dup", created: 1_800_000_000, subId });
  await applyStripeWebhookSerialized(evt, deps);
  await applyStripeWebhookSerialized(evt, deps);
  assert.equal(deps.calls.subscription.length, 1, "Retry desselben Events ist ein No-op (Dedup)");
});

test("312k-P1 Test 4b: Stale-Guard - ein AELTERES CANCEL_SCHEDULED nach bereits verarbeitetem SUSPEND wird verworfen", async () => {
  const subId = "sub_312k_stale";
  const deps = fakeDeps();
  const later = 1_800_000_200;
  const earlier = 1_800_000_000;
  await applyStripeWebhookSerialized(deletedEvent({ id: "evt_312k_susp", created: later, subId }), deps);
  await applyStripeWebhookSerialized(cancelEvent({ id: "evt_312k_old_cancel", created: earlier, subId }), deps);
  assert.deepEqual(deps.calls.setStatus, [[TENANT, "suspended"]], "SUSPEND bleibt der zuletzt angewendete Zustand");
  assert.equal(deps.calls.subscription.length, 0, "das veraltete CANCEL_SCHEDULED wurde verworfen, kein Patch");
});

test("312k-P1 Test 4c: ein tatsaechlich SPAETERES CANCEL_SCHEDULED nach SUSPEND wird angewendet (kein Pauschal-Block)", async () => {
  const subId = "sub_312k_after_suspend";
  const deps = fakeDeps();
  const earlier = 1_800_000_000;
  const later = 1_800_000_300;
  await applyStripeWebhookSerialized(deletedEvent({ id: "evt_312k_susp2", created: earlier, subId }), deps);
  await applyStripeWebhookSerialized(cancelEvent({ id: "evt_312k_new_cancel", created: later, subId }), deps);
  assert.equal(deps.calls.subscription.length, 1, "ein tatsaechlich SPAETERES CANCEL_SCHEDULED wird angewendet, kein Stale");
});
