// GAP-04 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-04").
// GEFIXT in P4: activatePaidTenant() wartet das Provisioning-Ergebnis ab (provisionCleared),
// statt den Status VOR provision() zu setzen. Rein, offline (Muster
// test/profile-a2-activation.test.js: echter state, duenner Store-Seam).
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
    // GAP-01: Perioden-Fenster des Budget-Gates. Wrapper-Parity zur Fassade
    // (json/pg): Uhr an der IO-Grenze, {changed} -> Boolean.
    billingHoldActive: (t) => billingHoldActive(s, t, new Date().toISOString()),
    stampBudgetPeriod: (t, iso) => stampBudgetPeriod(s, t, iso).changed,
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

  // provision() liefert einen expliziten Fehlschlag (globaler Nummern-Cap erschoepft) -
  // activatePaidTenant() wertet die Rueckgabe jetzt aus (provisionCleared) und aktiviert
  // NICHT, solange sie nicht geklaert ist.
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
