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
  const calls = { setStatus: [], invalidate: [], subscription: [], suspend: [] };
  return {
    calls,
    store: {
      findTenantBySubscription: (subId) => (tenantBySub && subId ? { id: tenantBySub } : null),
      // FW1-A: Existenz-Gate der Tenant-Aufloesung - dieses Double modelliert einen existierenden Tenant.
      tenantExists: () => true,
      setTenantSubscription: (tenant, patch) => calls.subscription.push([tenant, patch]),
      // tenant-prolif-c: Suspend stempelt den Grace-Anker.
      setSuspendedAtIfAbsent: (tenant) => calls.suspend.push(tenant),
      // 312k-Phase 4: der SUSPEND-Zweig liest cancelAtPeriodEnd VOR jeder Mutation (Muster
      // p3-payment-webhook.test.js/stripe-webhook-race.test.js fakeDeps). false (kein
      // gesetzter Vermerk) haelt dieses File auf dem Bestandsverhalten - hier wird nicht
      // gekuendigt, nur die Suspend-Wirkung selbst geprueft.
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
  // tenant_ref aus der Subscription-Metadata (createSubscription gibt es mit).
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.DELETED, data: { object: { id: "sub_1", metadata: { tenant_ref: "t_a" } } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [["t_a", "suspended"]], "Tenant suspendiert");
  assert.deepEqual(deps.calls.invalidate, ["t_a"], "Sessions des Tenants invalidiert");
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
});

test("Phase 2: payment_failed ohne aufloesbaren Tenant -> No-Op (kein Cross-Tenant-Suspend)", async () => {
  const deps = fakeDeps({ tenantBySub: null }); // kein Treffer
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.PAYMENT_FAILED, data: { object: { subscription: "sub_x", metadata: {} } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [], "kein Suspend ohne Tenant");
  assert.deepEqual(deps.calls.invalidate, [], "keine Session-Invalidierung ohne Tenant");
});
