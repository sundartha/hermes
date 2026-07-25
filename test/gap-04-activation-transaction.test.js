// GAP-04 (Katalog: tasks/i18n-tests/11-luecken-und-e2e.md, Abschnitt "GAP-04").
// Aktivierung und Nummern-Lieferung sind eine Transaktion: activatePaidTenant() setzt
// KYC + Status VOR provision() und wertet dessen Rueckgabe nicht aus. Rein, offline
// (Muster test/profile-a2-activation.test.js: echter state, duenner Store-Seam).
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
  };
}

function fakeAccounts() {
  const calls = { setStatus: [] };
  return { calls, setStatus: async (t, st) => calls.setStatus.push([t, st]) };
}

test("GAP-04 SOLL: ein fehlgeschlagenes Nummern-Provisioning (global_cap) darf den Tenant NICHT trotzdem aktivieren", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_gap04", {});
  setTenantSubscription(s, "t_gap04", { planSlug: "starter" });
  const accounts = fakeAccounts();

  // provision() liefert einen expliziten Fehlschlag (globaler Nummern-Cap erschoepft) -
  // activatePaidTenant() nimmt provision als reine Callback-Referenz entgegen und liest
  // NIRGENDS deren Rueckgabewert (src/billing/activation.js:70-71).
  await activatePaidTenant({
    store: storeOn(s),
    accounts,
    provision: async () => ({ ok: false, reason: "global_cap" }),
    billing: undefined,
    tenant: "t_gap04",
  });

  assert.ok(
    kycReached(s, "t_gap04", KYC_OUTBOUND_MIN),
    "Vorbedingung: KYC wurde angehoben (activation.js setzt es VOR provision(), unbedingt)",
  );
  assert.deepEqual(
    accounts.calls.setStatus,
    [],
    "SOLL: OHNE erfolgreiches Provisioning darf der Tenant NICHT auf 'active' gesetzt werden " +
      "(kein Storno/Alarm-Audit existiert als Kompensation - activatePaidTenant nimmt provision() " +
      "als reine Callback-Referenz und wertet die Rueckgabe an keiner Stelle aus, activation.js:70-71); " +
      `heute tatsaechlich gesetzt: ${JSON.stringify(accounts.calls.setStatus)}`,
  );
});
