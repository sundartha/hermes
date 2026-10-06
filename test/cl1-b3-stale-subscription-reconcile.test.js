import test from "node:test";
import assert from "node:assert/strict";
import { tenantsForStaleSubscriptionReconcile } from "../src/store/state-ops.js";
import { TENANT_STATUS } from "../src/store/defaults.js";
import { reconcileStaleSubscriptions, STALE_SUB_OUTCOME } from "../src/billing/stale-subscription-reconcile.js";

test("tenantsForStaleSubscriptionReconcile: nur Tenants mit Abo-Referenz UND status != active", () => {
  const state = {
    tenants: [
      { id: "t_stale", stripeSubscriptionId: "sub_a", status: TENANT_STATUS.SUSPENDED },
      { id: "t_aktiv_mit_abo", stripeSubscriptionId: "sub_b", status: TENANT_STATUS.ACTIVE },
      { id: "t_kein_abo", stripeSubscriptionId: null, status: TENANT_STATUS.SUSPENDED },
    ],
  };
  assert.deepEqual(
    tenantsForStaleSubscriptionReconcile(state).map((tenant) => tenant.id),
    ["t_stale"],
    "aktive Tenants und Tenants ohne Abo-Referenz bleiben draussen",
  );
});

function fakeStore(tenants) {
  return {
    load: () => ({ tenants }),
    setTenantSubscription: (tenantId, patch) => {
      const tenant = tenants.find((candidate) => candidate.id === tenantId);
      if (tenant && patch.subscriptionId !== undefined) tenant.stripeSubscriptionId = patch.subscriptionId;
    },
    tenantSubscription: (tenantId) => ({
      subscriptionId: tenants.find((candidate) => candidate.id === tenantId)?.stripeSubscriptionId ?? null,
    }),
  };
}

function fakeLogger() {
  const lines = [];
  return { lines, warn: (message) => lines.push(String(message)) };
}

test("Stripe=canceled + apply:true -> Referenz entwertet, Report cleared", async () => {
  const tenants = [{ id: "t_a", stripeSubscriptionId: "sub_a", status: TENANT_STATUS.SUSPENDED }];
  const store = fakeStore(tenants);
  const calls = [];
  const billing = { retrieveSubscription: async (id) => (calls.push(id), { status: "canceled" }) };
  const report = await reconcileStaleSubscriptions({ store, billing, apply: true });
  assert.deepEqual(calls, ["sub_a"]);
  assert.equal(tenants[0].stripeSubscriptionId, null, "Referenz entwertet");
  assert.deepEqual(report.cleared.map((entry) => entry.id), ["t_a"]);
  assert.deepEqual(report.alive, []);
  assert.deepEqual(report.errors, []);
});

test("Stripe=active (lebendes Abo) -> KEIN Schreibaufruf, Report alive", async () => {
  const tenants = [{ id: "t_b", stripeSubscriptionId: "sub_b", status: TENANT_STATUS.SUSPENDED }];
  const store = fakeStore(tenants);
  const billing = { retrieveSubscription: async () => ({ status: "active" }) };
  const report = await reconcileStaleSubscriptions({ store, billing, apply: true });
  assert.equal(tenants[0].stripeSubscriptionId, "sub_b", "Referenz bleibt - Abo lebt");
  assert.deepEqual(report.alive.map((entry) => entry.id), ["t_b"]);
  assert.deepEqual(report.cleared, []);
});

test("Stripe=incomplete_expired -> gilt ebenfalls als tot, Report cleared", async () => {
  const tenants = [{ id: "t_c", stripeSubscriptionId: "sub_c", status: TENANT_STATUS.SUSPENDED }];
  const store = fakeStore(tenants);
  const billing = { retrieveSubscription: async () => ({ status: "incomplete_expired" }) };
  const report = await reconcileStaleSubscriptions({ store, billing, apply: true });
  assert.deepEqual(report.cleared.map((entry) => entry.id), ["t_c"]);
});

test("status:null (Feld fehlt) -> KEIN Schreibaufruf, Report alive (nicht beurteilbar)", async () => {
  const tenants = [{ id: "t_d", stripeSubscriptionId: "sub_d", status: TENANT_STATUS.SUSPENDED }];
  const store = fakeStore(tenants);
  const billing = { retrieveSubscription: async () => ({ status: null }) };
  const report = await reconcileStaleSubscriptions({ store, billing, apply: true });
  assert.equal(tenants[0].stripeSubscriptionId, "sub_d", "unveraendert - kein Blind-Update");
  assert.deepEqual(report.alive.map((entry) => entry.id), ["t_d"]);
});

test("Trockenlauf (apply Default false): Kandidat steht im Report cleared, aber 0 Schreibaufrufe", async () => {
  const tenants = [{ id: "t_e", stripeSubscriptionId: "sub_e", status: TENANT_STATUS.SUSPENDED }];
  const store = fakeStore(tenants);
  const billing = { retrieveSubscription: async () => ({ status: "canceled" }) };
  const report = await reconcileStaleSubscriptions({ store, billing });
  assert.equal(report.apply, false);
  assert.deepEqual(report.cleared.map((entry) => entry.id), ["t_e"]);
  assert.equal(tenants[0].stripeSubscriptionId, "sub_e", "Trockenlauf schreibt nichts");
});

test("retrieveSubscription wirft -> kein Schreibaufruf, errors.length===1, Lauf endet regulaer (kein Wurf)", async () => {
  const tenants = [{ id: "t_f", stripeSubscriptionId: "sub_f", status: TENANT_STATUS.SUSPENDED }];
  const store = fakeStore(tenants);
  const billing = { retrieveSubscription: async () => { throw new Error("HTTP 500"); } };
  const logger = fakeLogger();
  const report = await reconcileStaleSubscriptions({ store, billing, apply: true, logger });
  assert.equal(tenants[0].stripeSubscriptionId, "sub_f", "unveraendert bei Fehler");
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].reason, STALE_SUB_OUTCOME.LOOKUP_FAILED);
  assert.ok(logger.lines.some((line) => line.includes("t_f")), "PII-frei geloggt, nur Tenant-id");
});
