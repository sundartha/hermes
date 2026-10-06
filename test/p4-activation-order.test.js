import test from "node:test";
import assert from "node:assert/strict";
import { activatePaidTenant } from "../src/billing/activation.js";
import { PROVISION_REASON, provisionCleared } from "../src/billing/provision-outcome.js";
import {
  makeDefaultState,
  registerTenant,
  tenantSubscription,
  setTenantSubscription,
  setProfile,
  setKycLevel,
  kycReached,
  clearSuspendedAt,
  billingHoldActive,
  clearBillingHold,
  stampBudgetPeriod,
} from "../src/store/state-ops.js";
import { KYC_OUTBOUND_MIN } from "../src/store/defaults.js";

function storeOn(s, { ensureTenantCalls = [] } = {}) {
  return {
    setKycLevel: (t, l) => setKycLevel(s, t, l),
    tenantSubscription: (t) => tenantSubscription(s, t),
    setProfile: (key, patch) => setProfile(s, key, patch),
    findTenantBySubscription: () => null,
    setTenantSubscription: (t, p) => setTenantSubscription(s, t, p),
    clearSuspendedAt: (t) => clearSuspendedAt(s, t),
    billingHoldActive: (t) => billingHoldActive(s, t, new Date().toISOString()),
    stampBudgetPeriod: (t, iso) => stampBudgetPeriod(s, t, iso).changed,
    ensureTenant: async (t) => {
      ensureTenantCalls.push(t);
    },
    clearBillingHold: (tenant) => clearBillingHold(s, tenant),
  };
}

function fakeAccounts() {
  const calls = { setStatus: [] };
  return { calls, setStatus: async (t, st) => calls.setStatus.push([t, st]) };
}

async function runActivation(reason) {
  const s = makeDefaultState();
  registerTenant(s, "t_order", {});
  setTenantSubscription(s, "t_order", { planSlug: "starter" });
  const accounts = fakeAccounts();
  const ensureTenantCalls = [];
  const r = await activatePaidTenant({
    store: storeOn(s, { ensureTenantCalls }),
    accounts,
    provision: async () => ({ ok: reason != null, reason }),
    billing: undefined,
    tenant: "t_order",
  });
  return { s, accounts, ensureTenantCalls, r };
}

for (const reason of Object.values(PROVISION_REASON)) {
  const cleared = provisionCleared({ ok: true, reason });
  test(`Grund '${reason}' -> ${cleared ? "aktiviert" : "aktiviert NICHT"}`, async () => {
    const { accounts, r } = await runActivation(reason);
    assert.equal(r.activated, cleared);
    assert.deepEqual(accounts.calls.setStatus, cleared ? [["t_order", "active"]] : []);
  });
}

test("unbekannter Grund -> NICHT geklaert, aktiviert nicht (fail-closed, nie raten)", async () => {
  const { accounts, r } = await runActivation("ein_frei_erfundener_grund");
  assert.equal(r.activated, false);
  assert.deepEqual(accounts.calls.setStatus, []);
});

test("already_provisioned aktiviert (Reaktivierungs-Regression: ein wieder zahlender, gesperrter Kunde bleibt nicht haengen)", async () => {
  const { accounts, r } = await runActivation(PROVISION_REASON.ALREADY_PROVISIONED);
  assert.equal(r.activated, true);
  assert.deepEqual(accounts.calls.setStatus, [["t_order", "active"]]);
});

test("Marker gesetzt VOR provision(), geloescht NUR bei Erfolg", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_marker", {});
  setTenantSubscription(s, "t_marker", { planSlug: "starter" });
  const seenDuringProvision = [];
  await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts(),
    provision: async () => {
      seenDuringProvision.push(tenantSubscription(s, "t_marker").activationPending);
      return { ok: false, reason: PROVISION_REASON.GLOBAL_CAP };
    },
    billing: undefined,
    tenant: "t_marker",
  });
  assert.deepEqual(seenDuringProvision, [true], "Marker steht VOR provision()");
  assert.equal(
    tenantSubscription(s, "t_marker").activationPending,
    true,
    "Marker bleibt bei fehlgeschlagenem Provisioning gesetzt (Operator-Retry findet den Tenant)",
  );

  const s2 = makeDefaultState();
  registerTenant(s2, "t_marker2", {});
  setTenantSubscription(s2, "t_marker2", { planSlug: "starter" });
  await activatePaidTenant({
    store: storeOn(s2),
    accounts: fakeAccounts(),
    provision: async () => ({ ok: true, reason: PROVISION_REASON.QUEUED }),
    billing: undefined,
    tenant: "t_marker2",
  });
  assert.equal(tenantSubscription(s2, "t_marker2").activationPending, false);
});

test("KYC wird in JEDEM Fall gesetzt (Erfolg und Fehlschlag)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_kyc_fail", {});
  setTenantSubscription(s, "t_kyc_fail", { planSlug: "starter" });
  await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts(),
    provision: async () => ({ ok: false, reason: PROVISION_REASON.PERSIST_ERROR }),
    billing: undefined,
    tenant: "t_kyc_fail",
  });
  assert.ok(kycReached(s, "t_kyc_fail", KYC_OUTBOUND_MIN));
});

test("ensureTenant (Spiegel-Nachzug) nur im Erfolgsfall", async () => {
  const { ensureTenantCalls: failCalls } = await runActivation(null);
  assert.deepEqual(failCalls, [], "kein ensureTenant bei Fehlschlag");

  const { ensureTenantCalls: okCalls } = await runActivation(PROVISION_REASON.QUEUED);
  assert.deepEqual(okCalls, ["t_order"], "ensureTenant genau einmal im Erfolgsfall");
});
