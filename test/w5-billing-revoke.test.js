import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";

function fakeDeps({ tenantBySub = null } = {}) {
  const calls = { setStatus: [], invalidate: [], subscription: [], suspend: [] };
  return {
    calls,
    store: {
      findTenantBySubscription: (subId) => (tenantBySub && subId ? { id: tenantBySub } : null),
      tenantExists: () => true,
      setTenantSubscription: (tenant, patch) => calls.subscription.push([tenant, patch]),
      setSuspendedAtIfAbsent: (tenant) => calls.suspend.push(tenant),
      tenantSubscription: () => ({ planSlug: null, cancelAtPeriodEnd: false }),
    },
    accounts: { setStatus: async (tenant, status) => calls.setStatus.push([tenant, status]) },
    sessions: { invalidateByTenant: async (tenant) => calls.invalidate.push(tenant) },
    audit: () => {},
    req: {},
  };
}

test("Phase 2: customer.subscription.deleted -> setStatus(suspended) + Sessions invalidiert", async () => {
  const deps = fakeDeps();
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.DELETED, data: { object: { id: "sub_1", metadata: { tenant_ref: "t_a" } } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [["t_a", "suspended"]], "Tenant suspendiert");
  assert.deepEqual(deps.calls.invalidate, ["t_a"], "Sessions des Tenants invalidiert");
});

test("Phase 2: invoice.payment_failed -> Tenant ueber subscriptionId aufgeloest + suspendiert", async () => {
  const deps = fakeDeps({ tenantBySub: "t_b" });
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.PAYMENT_FAILED, data: { object: { subscription: "sub_9", customer: "cus_9", metadata: {} } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [["t_b", "suspended"]], "Tenant suspendiert");
  assert.deepEqual(deps.calls.invalidate, ["t_b"], "Sessions des Tenants invalidiert");
});

test("Phase 2: payment_failed ohne aufloesbaren Tenant -> No-Op (kein Cross-Tenant-Suspend)", async () => {
  const deps = fakeDeps({ tenantBySub: null });
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.PAYMENT_FAILED, data: { object: { subscription: "sub_x", metadata: {} } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [], "kein Suspend ohne Tenant");
  assert.deepEqual(deps.calls.invalidate, [], "keine Session-Invalidierung ohne Tenant");
});
