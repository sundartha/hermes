import test from "node:test";
import assert from "node:assert/strict";
import { activatePaidTenant } from "../src/billing/activation.js";
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

function storeOn(s) {
  return {
    setKycLevel: (t, l) => setKycLevel(s, t, l),
    tenantSubscription: (t) => tenantSubscription(s, t),
    setProfile: (key, patch) => setProfile(s, key, patch),
    findTenantBySubscription: () => null,
    setTenantSubscription: (t, p) => setTenantSubscription(s, t, p),
    clearSuspendedAt: (t) => clearSuspendedAt(s, t),
    billingHoldActive: (t) => billingHoldActive(s, t, new Date().toISOString()),
    stampBudgetPeriod: (t, iso) => stampBudgetPeriod(s, t, iso).changed,
    clearBillingHold: (tenant) => clearBillingHold(s, tenant),
  };
}

function fakeAccounts() {
  const calls = { setStatus: [] };
  return { calls, setStatus: async (t, st) => calls.setStatus.push([t, st]) };
}

test("Ein fehlgeschlagenes Nummern-Provisioning (global_cap) aktiviert den Tenant nicht (GAP-04, gefixt in P4)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_gap04", {});
  setTenantSubscription(s, "t_gap04", { planSlug: "starter" });
  const accounts = fakeAccounts();

  await activatePaidTenant({
    store: storeOn(s),
    accounts,
    provision: async () => ({ ok: false, reason: "global_cap" }),
    billing: undefined,
    tenant: "t_gap04",
  });

  assert.ok(
    kycReached(s, "t_gap04", KYC_OUTBOUND_MIN),
    "Vorbedingung: KYC wurde angehoben (activation.js setzt es unbedingt, vor dem geklaerten Ergebnis)",
  );
  assert.deepEqual(
    accounts.calls.setStatus,
    [],
    "SOLL: OHNE geklaertes Provisioning darf der Tenant NICHT auf 'active' gesetzt werden; " +
      `heute tatsaechlich gesetzt: ${JSON.stringify(accounts.calls.setStatus)}`,
  );
});
