import assert from "node:assert/strict";
import { test } from "node:test";

import { activatePaidTenant } from "../../src/billing/activation.ts";
import { runPaidWithoutNumberSweep } from "../../src/billing/paid-without-number-watch.ts";
import { backfillPlanProfiles } from "../../src/billing/backfill-profiles.ts";
import { KYC_LEVEL } from "../../src/store/defaults.js";
import {
  tenantActiveSubscriber,
  makeDefaultState,
  registerTenant,
  tenantSubscription,
  setTenantSubscription,
  setProfile,
  setKycLevel,
  clearSuspendedAt,
  billingHoldActive,
  clearBillingHold,
  stampBudgetPeriod,
} from "../../src/store/state-ops.js";

const TENANT = "t_fehlertext_aktivierung";

const FEHLER_FAELLE = [
  { name: "Error mit Meldung", wirf: () => { throw new Error("Stripe unerreichbar"); }, text: "Stripe unerreichbar" },
  { name: "geworfener Text", wirf: () => { throw "Stripe weg"; }, text: "Stripe weg" },
];

function storeOn(zustand) {
  return {
    setKycLevel: (t, l) => setKycLevel(zustand, t, l),
    tenantSubscription: (t) => tenantSubscription(zustand, t),
    setProfile: (key, patch) => setProfile(zustand, key, patch),
    setTenantSubscription: (t, p) => setTenantSubscription(zustand, t, p),
    clearSuspendedAt: (t) => clearSuspendedAt(zustand, t),
    billingHoldActive: (t) => billingHoldActive(zustand, t, new Date().toISOString()),
    stampBudgetPeriod: (t, iso) => stampBudgetPeriod(zustand, t, iso).changed,
    clearBillingHold: (t) => clearBillingHold(zustand, t),
    ensureTenant: async () => undefined,
  };
}

for (const fall of FEHLER_FAELLE) {
  test(`Aktivierung, Befreiungs-Abfrage fehlgeschlagen (${fall.name}): Logzeile nennt Tenant und Fehlertext`, async (t) => {
    const zustand = makeDefaultState();
    registerTenant(zustand, TENANT, {});
    setTenantSubscription(zustand, TENANT, { planSlug: "starter", subscriptionId: "sub_x" });
    const fehlerZeilen = [];
    t.mock.method(console, "error", (...teile) => fehlerZeilen.push(teile.join(" ")));
    const ergebnis = await activatePaidTenant({
      store: storeOn(zustand),
      accounts: { setStatus: async () => undefined },
      provision: async () => ({ ok: true, reason: "queued" }),
      billing: { retrieveSubscription: async () => fall.wirf() },
      tenant: TENANT,
    });
    assert.equal(ergebnis.activated, true);
    assert.deepEqual(fehlerZeilen, [
      `[activation] numberSetupFeeExempt-Check fehlgeschlagen (tenant=${TENANT}): ${fall.text}`,
    ]);
  });

  test(`Zahlend-ohne-Nummer-Lauf scheitert (${fall.name}): Logzeile nennt den Fehlertext, der Lauf wirft nicht`, async (t) => {
    const fehlerZeilen = [];
    t.mock.method(console, "error", (...teile) => fehlerZeilen.push(teile.join(" ")));
    await runPaidWithoutNumberSweep({
      store: { load: () => fall.wirf() },
      config: { billing: { paidWithoutNumberGraceMs: 3600000 } },
      audit: () => undefined,
    });
    assert.deepEqual(fehlerZeilen, [`[paid-no-number] ${fall.text}`]);
  });
}

function backfillStoreOn(zustand) {
  return {
    load: () => zustand,
    tenantActiveSubscriber: (t, min) => tenantActiveSubscriber(zustand, t, min),
    tenantSubscription: (t) => tenantSubscription(zustand, t),
    setTenantSubscription: (t, p) => setTenantSubscription(zustand, t, p),
    setProfile: (key, patch) => setProfile(zustand, key, patch),
  };
}

const BACKFILL_FAELLE = [
  { name: "Abo ohne Tarif, Lauf mit apply", seed: { subscriptionId: "sub_a" }, apply: true, aufrufe: ["sub_a"], slug: "starter" },
  { name: "Trockenlauf", seed: { subscriptionId: "sub_a" }, apply: false, aufrufe: [], slug: null },
  { name: "Tarif schon gesetzt", seed: { subscriptionId: "sub_a", planSlug: "business" }, apply: true, aufrufe: [], slug: "business" },
  { name: "keine Abo-Kennung", seed: { planSlug: undefined }, apply: true, aufrufe: [], slug: null },
];

for (const fall of BACKFILL_FAELLE) {
  test(`Profil-Nachtrag fragt den Tarif-Abgleich nur wenn noetig (${fall.name})`, async () => {
    const zustand = makeDefaultState();
    registerTenant(zustand, "t_a", {});
    setKycLevel(zustand, "t_a", KYC_LEVEL.CARD);
    setTenantSubscription(zustand, "t_a", fall.seed);
    const aufrufe = [];
    await backfillPlanProfiles({
      store: backfillStoreOn(zustand),
      apply: fall.apply,
      resolvePlanSlug: async (kennung) => {
        aufrufe.push(kennung);
        return "starter";
      },
    });
    assert.deepEqual(aufrufe, fall.aufrufe);
    assert.equal(tenantSubscription(zustand, "t_a").planSlug, fall.slug);
  });
}

test("Profil-Nachtrag ohne Tarif-Abgleich laesst den Tarif leer", async () => {
  const zustand = makeDefaultState();
  registerTenant(zustand, "t_a", {});
  setKycLevel(zustand, "t_a", KYC_LEVEL.CARD);
  setTenantSubscription(zustand, "t_a", { subscriptionId: "sub_a" });
  const bericht = await backfillPlanProfiles({ store: backfillStoreOn(zustand), apply: true });
  assert.deepEqual(bericht.reconciled, []);
  assert.equal(tenantSubscription(zustand, "t_a").planSlug, null);
});
