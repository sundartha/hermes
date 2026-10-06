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

function storeOn(s) {
  return { tenantSubscription: (t) => tenantSubscription(s, t) };
}

test("Erfolg: liefert das Tier-Profil, ohne zu schreiben", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const r = resolveTierForTenant({ store: storeOn(s), tenant: "t_a" });
  assert.equal(r.skip, undefined);
  assert.deepEqual(r.tier, planProfileFor("starter"));
  assert.equal(Object.keys(s.profiles).length, 0);
});

test("kein/unbekannter planSlug -> skip no_plan (nie planProfileFor(undefined))", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  const r = resolveTierForTenant({ store: storeOn(s), tenant: "t_a" });
  assert.equal(r.skip, PROFILE_SKIP.NO_PLAN);
  assert.equal(r.tier, undefined);
});

test("BACKFILL_SKIP erbt den geteilten no_plan-Reason (kein Drift)", () => {
  assert.equal(BACKFILL_SKIP.NO_PLAN, PROFILE_SKIP.NO_PLAN);
  assert.equal(PROFILE_SKIP.NO_ACCOUNT, undefined, "NO_ACCOUNT ist Phase S entfernt");
  assert.equal(PROFILE_SKIP.NO_EMAIL, undefined, "NO_EMAIL ist Phase S entfernt");
});
