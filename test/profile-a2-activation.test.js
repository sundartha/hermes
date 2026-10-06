import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import { activatePaidTenant, profileAuditDetail } from "../src/billing/activation.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantSubscription,
  setProfile,
  tenantSubscription,
  setKycLevel,
  kycReached,
  clearSuspendedAt,
  billingHoldActive,
  stampBudgetPeriod,
  tenantExists,
} from "../src/store/state-ops.js";
import { sanitizeProfile, KYC_OUTBOUND_MIN } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";

function storeOn(s) {
  return {
    setKycLevel: (t, l) => setKycLevel(s, t, l),
    tenantSubscription: (t) => tenantSubscription(s, t),
    setProfile: (key, patch) => setProfile(s, key, patch),
    findTenantBySubscription: () => null,
    tenantExists: (tenant) => tenantExists(s, tenant),
    setTenantSubscription: (t, p) => setTenantSubscription(s, t, p),
    clearSuspendedAt: (t) => clearSuspendedAt(s, t),
    billingHoldActive: (t) => billingHoldActive(s, t, new Date().toISOString()),
    stampBudgetPeriod: (t, iso) => stampBudgetPeriod(s, t, iso).changed,
    ensureTenant: async () => {},
    clearBillingHold: () => {},
  };
}

function fakeAccounts() {
  const calls = { setStatus: [] };
  return {
    calls,
    setStatus: async (t, st) => calls.setStatus.push([t, st]),
  };
}

test("sanitizeProfile haelt maxCallsPerHour=null, droppt Nicht-Zahl", () => {
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: null }), { maxCallsPerHour: null });
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: 5 }), { maxCallsPerHour: 5 });
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: "viele" }), {});
});

test("profileAuditDetail mappt ok/skip/none auf das Audit-Fragment", () => {
  assert.equal(profileAuditDetail({ provisioned: true, keys: 6 }), "profile=ok:6");
  assert.equal(profileAuditDetail({ provisioned: false, reason: "no_plan" }), "profile=skip:no_plan");
  assert.equal(profileAuditDetail(undefined), "profile=none");
});

test("activatePaidTenant provisioniert das Tier-Profil auf die tenantId (alle 8 Felder)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const acc = fakeAccounts();
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: acc,
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: "t_a",
  });

  assert.deepEqual(s.profiles["t_a"], planProfileFor("starter"));
  assert.equal(s.profiles["t_a"].maxCallsPerHour, null);
  assert.deepEqual(r.profile, { provisioned: true, reason: null, keys: 8 });
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]]);
  assert.equal(kycReached(s, "t_a", KYC_OUTBOUND_MIN), true);
});

test("vorbestehendes unrestricted=true + allowedNumbers -> nach Aktivierung false/[]", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "business" });
  s.profiles["t_a"] = { unrestricted: true, allowedNumbers: ["+491701234567"], maxCallsPerHour: 99 };
  await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts(),
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: "t_a",
  });
  assert.equal(s.profiles["t_a"].unrestricted, false);
  assert.deepEqual(s.profiles["t_a"].allowedNumbers, []);
  assert.equal(s.profiles["t_a"].maxCallsPerHour, null);
});

test("kein/unbekannter planSlug -> SKIP no_plan, kein undefined-Profil", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts(),
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: "t_a",
  });
  assert.equal(r.profile.reason, "no_plan");
  assert.equal(Object.keys(s.profiles).length, 0);
});

test("Webhook-ACTIVATE mit plan_slug provisioniert identisch (auf die tenantId)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  const acc = fakeAccounts();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: {
          id: "sub_1",
          status: "active",
          metadata: { tenant_ref: "t_a", plan_slug: "business" },
        },
      },
    },
    {
      store: storeOn(s),
      accounts: acc,
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
    },
  );
  assert.deepEqual(s.profiles["t_a"], planProfileFor("business"));
});

test("planSlug-loser Webhook (frischer Tenant) -> SKIP, kein Profil, KYC/Status gesetzt", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  const acc = fakeAccounts();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: { id: "sub_1", status: "active", metadata: { tenant_ref: "t_a" } },
      },
    },
    {
      store: storeOn(s),
      accounts: acc,
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
    },
  );
  assert.equal(Object.keys(s.profiles).length, 0);
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]]);
  assert.equal(kycReached(s, "t_a", KYC_OUTBOUND_MIN), true);
});

function fakeExemptBilling({ exempt = true, throwErr = null } = {}) {
  const log = [];
  return {
    log,
    async retrieveSubscription(subscriptionId) {
      log.push(subscriptionId);
      if (throwErr) throw throwErr;
      return { planSlug: null, numberSetupFeeExempt: exempt };
    },
  };
}

test("activatePaidTenant: billing.retrieveSubscription liefert exempt:true -> VOR provision() persistiert (Race-Schutz)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { subscriptionId: "sub_free" });
  const billing = fakeExemptBilling({ exempt: true });
  await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts(),
    billing,
    provision: async () => {
      assert.equal(
        tenantSubscription(s, "t_a").numberSetupFeeExempt,
        true,
        "Flag VOR provision() gesetzt",
      );
      return { ok: true, reason: "queued" };
    },
    tenant: "t_a",
  });
  assert.deepEqual(billing.log, ["sub_free"]);
  assert.equal(tenantSubscription(s, "t_a").numberSetupFeeExempt, true);
});

test("activatePaidTenant: billing.retrieveSubscription wirft -> Flag bleibt false, KYC/Status/Provisioning laufen trotzdem durch (fail-soft)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { subscriptionId: "sub_broken" });
  const billing = fakeExemptBilling({ throwErr: new Error("Stripe HTTP 500") });
  const acc = fakeAccounts();
  const provisioned = [];
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: acc,
    billing,
    provision: async (t) => {
      provisioned.push(t);
      return { ok: true, reason: "queued" };
    },
    tenant: "t_a",
  });
  assert.equal(
    tenantSubscription(s, "t_a").numberSetupFeeExempt,
    false,
    "Flag bleibt unberuehrt (fail-closed Default) - ein Stripe-Hakler darf keinen stillen Bypass ausloesen",
  );
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]], "Status-Flip laeuft trotz Stripe-Fehler");
  assert.deepEqual(
    provisioned,
    ["t_a"],
    "Provisioning laeuft trotz Stripe-Fehler (P8: ein Stripe-Hakler blockt nie KYC/Status/Provisioning)",
  );
  assert.equal(r.profile.reason, "no_plan");
});

test("Webhook-ACTIVATE mit billing setzt numberSetupFeeExempt IDENTISCH zum direkten Pfad (beide Race-Teilnehmer treffen denselben Code)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  const billing = fakeExemptBilling({ exempt: true });
  const acc = fakeAccounts();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: {
          id: "sub_webhook_free",
          status: "active",
          metadata: { tenant_ref: "t_a", plan_slug: "business" },
        },
      },
    },
    {
      store: storeOn(s),
      accounts: acc,
      billing,
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
    },
  );
  assert.equal(
    tenantSubscription(s, "t_a").numberSetupFeeExempt,
    true,
    "Webhook-Pfad setzt das Flag ueber dieselbe activation.js-Logik wie der direkte Pfad",
  );
  assert.deepEqual(billing.log, ["sub_webhook_free"]);
});
