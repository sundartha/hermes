// W5 Phase 2: Billing-Revoke. applyStripeWebhook MUSS bei customer.subscription.deleted
// UND invoice.payment_failed den Tenant suspendieren (accounts.setStatus("suspended")) UND
// seine Sessions invalidieren - sonst koennte ein gekuendigter/zahlungssaeumiger Kunde bis
// Cookie-Expiry weiterlesen ODER (mit der W5-Defense-in-depth, w5-abo-allowlist-gate.test.js)
// nicht abgewiesen werden. Reine Orchestrierung ueber injizierte Seams (kein IO/Netz,
// F.I.R.S.T.) - das Event-Mapping selbst deckt stripe-webhook-signature.test.js ab.
import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";

// Aufzeichnende Fake-Seams: store loest den Tenant ueber subscriptionId auf (Webhook-Pfad
// ohne tenant_ref), accounts/sessions protokollieren die Wirkungen.
function fakeDeps({ tenantBySub = null } = {}) {
  const calls = { setStatus: [], invalidate: [], subscription: [], cancelNumbers: [] };
  return {
    calls,
    store: {
      findTenantBySubscription: (subId) => (tenantBySub && subId ? { id: tenantBySub } : null),
      setTenantSubscription: (tenant, patch) => calls.subscription.push([tenant, patch]),
      markTenantNumbersCancelled: (tenant) => calls.cancelNumbers.push(tenant),
    },
    accounts: { setStatus: async (tenant, status) => calls.setStatus.push([tenant, status]) },
    sessions: { invalidateByTenant: async (tenant) => calls.invalidate.push(tenant) },
    audit: () => {},
    req: {},
  };
}

test("Phase 2: customer.subscription.deleted -> setStatus(suspended) + Sessions invalidiert", async () => {
  const deps = fakeDeps();
  // tenant_ref aus der Subscription-Metadata (createSubscription gibt es mit).
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.DELETED, data: { object: { id: "sub_1", metadata: { tenant_ref: "t_a" } } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [["t_a", "suspended"]], "Tenant suspendiert");
  assert.deepEqual(deps.calls.invalidate, ["t_a"], "Sessions des Tenants invalidiert");
  assert.deepEqual(deps.calls.cancelNumbers, ["t_a"], "Nummer(n) store-seitig als gekuendigt markiert (Fix P1)");
});

test("Phase 2: invoice.payment_failed -> Tenant ueber subscriptionId aufgeloest + suspendiert", async () => {
  // Invoice traegt kein tenant_ref -> Aufloesung ueber store.findTenantBySubscription.
  const deps = fakeDeps({ tenantBySub: "t_b" });
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.PAYMENT_FAILED, data: { object: { subscription: "sub_9", customer: "cus_9", metadata: {} } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [["t_b", "suspended"]], "Tenant suspendiert");
  assert.deepEqual(deps.calls.invalidate, ["t_b"], "Sessions des Tenants invalidiert");
  assert.deepEqual(deps.calls.cancelNumbers, ["t_b"], "Nummer(n) store-seitig als gekuendigt markiert (Fix P1)");
});

test("Phase 2: payment_failed ohne aufloesbaren Tenant -> No-Op (kein Cross-Tenant-Suspend)", async () => {
  const deps = fakeDeps({ tenantBySub: null }); // kein Treffer
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.PAYMENT_FAILED, data: { object: { subscription: "sub_x", metadata: {} } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [], "kein Suspend ohne Tenant");
  assert.deepEqual(deps.calls.invalidate, [], "keine Session-Invalidierung ohne Tenant");
  assert.deepEqual(deps.calls.cancelNumbers, [], "keine Nummer markiert ohne Tenant");
});
