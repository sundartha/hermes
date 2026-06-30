// Geteilter, schreibfreier Profil-Resolver. EINE Quelle fuer die Aufloesung planProfileFor
// UND die Skip-Taxonomie, die A2 (activation.js) und A3 (backfill-profiles.js) gemeinsam
// nutzen. Pinnt Vertrag + Schreibfreiheit + Single-Source. Phase S: das Profil keyt auf die
// tenantId, also kein Account-/email-Lookup mehr (synchron, nur planProfileFor).
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

test("Erfolg: liefert das Tier-Profil, ohne zu schreiben", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const r = resolveTierForTenant({ store: storeOn(s), tenant: "t_a" });
  assert.equal(r.skip, undefined);
  assert.deepEqual(r.tier, planProfileFor("starter"));
  assert.equal(Object.keys(s.profiles).length, 0); // schreibfrei (P6/N7)
});

test("kein/unbekannter planSlug -> skip no_plan (nie planProfileFor(undefined))", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {}); // keine Subscription -> planSlug null
  const r = resolveTierForTenant({ store: storeOn(s), tenant: "t_a" });
  assert.equal(r.skip, PROFILE_SKIP.NO_PLAN);
  assert.equal(r.tier, undefined);
});

// Single-Source-Guard: A3 erbt den Skip-String aus PROFILE_SKIP (kein zweites Literal, G5).
// Phase S: nur noch NO_PLAN (NO_ACCOUNT/NO_EMAIL entfallen - kein Account-Lookup mehr).
test("BACKFILL_SKIP erbt den geteilten no_plan-Reason (kein Drift)", () => {
  assert.equal(BACKFILL_SKIP.NO_PLAN, PROFILE_SKIP.NO_PLAN);
  assert.equal(PROFILE_SKIP.NO_ACCOUNT, undefined, "NO_ACCOUNT ist Phase S entfernt");
  assert.equal(PROFILE_SKIP.NO_EMAIL, undefined, "NO_EMAIL ist Phase S entfernt");
});
