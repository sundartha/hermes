// Geteilter, schreibfreier Profil-Resolver (S2-1 Fix Runde 2): EINE Quelle fuer die
// Aufloesungs-Kette planProfileFor -> accountByTenant -> email UND die Skip-Taxonomie, die
// A2 (activation.js) und A3 (backfill-profiles.js) gemeinsam nutzen. Pinnt Vertrag +
// Schreibfreiheit + Single-Source, damit die frueher doppelte Logik nicht erneut driftet.
// Backend-agnostisch ueber state-ops, offline, F.I.R.S.T.
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  setTenantSubscription,
  tenantSubscription,
} from "../src/store/state-ops.js";
import { planProfileFor } from "../src/plans.js";
import { PROFILE_SKIP, resolveTierForTenant } from "../src/billing/plan-profile-resolver.js";
import { BACKFILL_SKIP } from "../src/billing/backfill-profiles.js";

// Store-Seam mit GENAU der vom Resolver gelesenen Methode (tenantSubscription). Bewusst KEIN
// setProfile: ein versehentlicher Schreibversuch wuerfe statt still zu mutieren (Schreibfrei-Beweis).
function storeOn(s) {
  return { tenantSubscription: (t) => tenantSubscription(s, t) };
}
function fakeAccounts(account) {
  return { accountByTenant: async () => account };
}

test("Erfolg: liefert Tier-Profil + Account, ohne zu schreiben", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const r = await resolveTierForTenant({
    store: storeOn(s),
    accounts: fakeAccounts({ sub: "u1", email: "u1@x" }),
    tenant: "t_a",
  });
  assert.equal(r.skip, undefined);
  assert.deepEqual(r.tier, planProfileFor("starter"));
  assert.equal(r.account.email, "u1@x");
  assert.equal(Object.keys(s.profiles).length, 0); // schreibfrei (P6/N7)
});

test("kein/unbekannter planSlug -> skip no_plan (nie planProfileFor(undefined))", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {}); // keine Subscription -> planSlug null
  const r = await resolveTierForTenant({
    store: storeOn(s),
    accounts: fakeAccounts({ sub: "u1", email: "u1@x" }),
    tenant: "t_a",
  });
  assert.equal(r.skip, PROFILE_SKIP.NO_PLAN);
  assert.equal(r.tier, undefined);
});

test("Account abwesend/mehrdeutig -> skip no_account", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const r = await resolveTierForTenant({
    store: storeOn(s),
    accounts: fakeAccounts(null), // 0 ODER >1 -> null (genau-1-sonst-null)
    tenant: "t_a",
  });
  assert.equal(r.skip, PROFILE_SKIP.NO_ACCOUNT);
});

test("leere account.email -> skip no_email", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const r = await resolveTierForTenant({
    store: storeOn(s),
    accounts: fakeAccounts({ sub: "u1", email: "" }),
    tenant: "t_a",
  });
  assert.equal(r.skip, PROFILE_SKIP.NO_EMAIL);
});

// Single-Source-Guard: A3 erbt die Skip-Strings aus PROFILE_SKIP (kein zweites Literal, G5).
test("BACKFILL_SKIP erbt die geteilten Reason-Strings (kein Drift)", () => {
  assert.equal(BACKFILL_SKIP.NO_PLAN, PROFILE_SKIP.NO_PLAN);
  assert.equal(BACKFILL_SKIP.NO_ACCOUNT, PROFILE_SKIP.NO_ACCOUNT);
  assert.equal(BACKFILL_SKIP.NO_EMAIL, PROFILE_SKIP.NO_EMAIL);
});
