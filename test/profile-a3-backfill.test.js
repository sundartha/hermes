import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeDefaultState,
  registerTenant,
  setTenantSubscription,
  setKycLevel,
  tenantActiveSubscriber,
  tenantSubscription,
  setProfile,
} from "../src/store/state-ops.js";
import { sanitizeProfile, KYC_LEVEL, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";
import { backfillPlanProfiles, BACKFILL_SKIP } from "../src/billing/backfill-profiles.js";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../scripts/backfill-plan-profiles.js", import.meta.url));

function storeOn(s) {
  return {
    load: () => s,
    tenantActiveSubscriber: (t, min) => tenantActiveSubscriber(s, t, min),
    tenantSubscription: (t) => tenantSubscription(s, t),
    setTenantSubscription: (t, p) => setTenantSubscription(s, t, p),
    setProfile: (key, patch) => setProfile(s, key, patch),
  };
}

function seedSubscriber(s, id, { planSlug, subscriptionId } = {}) {
  registerTenant(s, id, {});
  setKycLevel(s, id, KYC_LEVEL.CARD);
  if (planSlug || subscriptionId) setTenantSubscription(s, id, { planSlug, subscriptionId });
}

test("Dry-Run listet die Aenderung, schreibt aber kein Profil", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "starter" });
  const r = await backfillPlanProfiles({ store: storeOn(s), apply: false });
  assert.deepEqual(r.changes, [{ id: "t_a", hadExisting: false }]);
  assert.equal(Object.keys(s.profiles).length, 0);
});

test("Apply provisioniert das Tier-Profil auf die tenantId (alle 7 Felder)", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "starter" });
  const r = await backfillPlanProfiles({ store: storeOn(s), apply: true });
  assert.deepEqual(s.profiles["t_a"], sanitizeProfile(planProfileFor("starter")));
  assert.equal(s.profiles["t_a"].maxCallsPerHour, null);
  assert.equal(r.changes.length, 1);
});

test("zweiter Apply-Lauf ist idempotent (0 changes, in unchanged)", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "business" });
  await backfillPlanProfiles({ store: storeOn(s), apply: true });
  const r2 = await backfillPlanProfiles({ store: storeOn(s), apply: true });
  assert.equal(r2.changes.length, 0);
  assert.deepEqual(r2.unchanged, [{ id: "t_a" }]);
});

test("Bootstrap-Tenant wird per ID ausgenommen (skip bootstrap, kein Profil)", async () => {
  const s = makeDefaultState();
  setKycLevel(s, BOOTSTRAP_TENANT_ID, KYC_LEVEL.ID_VERIFIED);
  setTenantSubscription(s, BOOTSTRAP_TENANT_ID, { planSlug: "business" });
  const r = await backfillPlanProfiles({ store: storeOn(s), apply: true });
  assert.ok(r.skipped.some((x) => x.id === BOOTSTRAP_TENANT_ID && x.reason === BACKFILL_SKIP.BOOTSTRAP));
  assert.equal(Object.keys(s.profiles).length, 0);
});

test("aktiver Subscriber ohne planSlug -> skip no_plan, kein Profil", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a");
  const r = await backfillPlanProfiles({ store: storeOn(s), apply: true });
  assert.ok(r.skipped.some((x) => x.id === "t_a" && x.reason === BACKFILL_SKIP.NO_PLAN));
  assert.equal(Object.keys(s.profiles).length, 0);
});

test("vorbestehendes unrestricted=true + allowedNumbers -> nach Apply false/[]", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "business" });
  s.profiles["t_a"] = { unrestricted: true, allowedNumbers: ["+491701234567"], maxCallsPerHour: 99 };
  await backfillPlanProfiles({ store: storeOn(s), apply: true });
  assert.equal(s.profiles["t_a"].unrestricted, false);
  assert.deepEqual(s.profiles["t_a"].allowedNumbers, []);
  assert.equal(s.profiles["t_a"].maxCallsPerHour, null);
});

test("aktiver Tenant ohne KYC -> skip not_subscriber, kein Profil", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const r = await backfillPlanProfiles({ store: storeOn(s), apply: true });
  assert.ok(r.skipped.some((x) => x.id === "t_a" && x.reason === BACKFILL_SKIP.NOT_SUBSCRIBER));
  assert.equal(Object.keys(s.profiles).length, 0);
});

test("Reconcile-Resolver heilt slug-loses Abo (setzt Slug, schreibt Profil)", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { subscriptionId: "sub_x" });
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    apply: true,
    resolvePlanSlug: async () => "business",
  });
  assert.deepEqual(r.reconciled, [{ id: "t_a" }]);
  assert.equal(tenantSubscription(s, "t_a").planSlug, "business");
  assert.deepEqual(s.profiles["t_a"], sanitizeProfile(planProfileFor("business")));
});

test("slug-loses Abo ohne Reconcile -> skip no_plan", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { subscriptionId: "sub_x" });
  const r = await backfillPlanProfiles({ store: storeOn(s), apply: true });
  assert.ok(r.skipped.some((x) => x.id === "t_a" && x.reason === BACKFILL_SKIP.NO_PLAN));
  assert.equal(Object.keys(s.profiles).length, 0);
});

test("CLI ist im json-Backend ein No-Op (exit 0, store.json nicht erzeugt)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "a3-backfill-"));
  try {
    const { stdout } = await execFileAsync("node", [CLI], {
      env: { ...process.env, STORE_BACKEND: "json", DATA_DIR: dir },
    });
    assert.match(stdout, /json-Backend: No-Op/);
    assert.equal(existsSync(join(dir, "store.json")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
