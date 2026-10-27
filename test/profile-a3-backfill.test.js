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

async function pgBestand(mandanten) {
  const { makePgTestStore } = await import("./pg-helpers.js");
  const { store, db } = await makePgTestStore();
  for (const { id, kyc = KYC_LEVEL.CARD, planSlug, subscriptionId } of mandanten) {
    await db.query(`INSERT INTO tenant (id, status) VALUES ($1, 'active')`, [id]);
    await store.ensureTenant(id);
    if (kyc) store.setKycLevel(id, kyc);
    if (planSlug || subscriptionId) store.setTenantSubscription(id, { planSlug, subscriptionId });
  }
  await store.save();
  return store;
}

test("Resolver ohne Antwort setzt keinen planSlug und meldet kein reconciled (skip no_plan)", async () => {
  const store = await pgBestand([{ id: "t_a", subscriptionId: "sub_x" }]);
  const r = await backfillPlanProfiles({ store, apply: true, resolvePlanSlug: async () => null });
  assert.deepEqual(r.reconciled, [], "ein Resolver ohne Slug darf nichts nachholen");
  assert.deepEqual(r.skipped, [
    { id: BOOTSTRAP_TENANT_ID, reason: BACKFILL_SKIP.BOOTSTRAP },
    { id: "t_a", reason: BACKFILL_SKIP.NO_PLAN },
  ]);
  assert.equal(store.tenantSubscription("t_a").planSlug ?? null, null);
  assert.equal(store.load().profiles["t_a"], undefined);
});

test("gemischter Bestand: Bericht folgt der Mandantenreihenfolge (Bootstrap plus sechs Mandanten)", async () => {
  const store = await pgBestand([
    { id: "t_ns", kyc: null, planSlug: "starter" },
    { id: "t_np" },
    { id: "t_new" },
    { id: "t_same", planSlug: "business" },
    { id: "t_old" },
    { id: "t_rec", subscriptionId: "sub_rec" },
  ]);
  await backfillPlanProfiles({ store, apply: true });
  store.setTenantSubscription("t_new", { planSlug: "starter" });
  store.setTenantSubscription("t_old", { planSlug: "business" });
  store.setProfile("t_old", { unrestricted: true, maxCallsPerHour: 99 });
  await store.save();

  const r = await backfillPlanProfiles({ store, apply: true, resolvePlanSlug: async () => "business" });
  assert.deepEqual(r, {
    apply: true,
    scanned: 7,
    changes: [
      { id: "t_new", hadExisting: false },
      { id: "t_old", hadExisting: true },
      { id: "t_rec", hadExisting: false },
    ],
    unchanged: [{ id: "t_same" }],
    skipped: [
      { id: BOOTSTRAP_TENANT_ID, reason: BACKFILL_SKIP.BOOTSTRAP },
      { id: "t_ns", reason: BACKFILL_SKIP.NOT_SUBSCRIBER },
      { id: "t_np", reason: BACKFILL_SKIP.NO_PLAN },
    ],
    reconciled: [{ id: "t_rec" }],
  });
});

test("Reconcile fragt den Resolver nacheinander je Mandant und schreibt dazwischen das Profil", async () => {
  const store = await pgBestand([
    { id: "t_a", subscriptionId: "sub_a" },
    { id: "t_b", subscriptionId: "sub_b" },
  ]);
  const ablauf = [];
  const gemeldet = new Set();
  const neueProfile = () => {
    for (const id of ["t_a", "t_b"]) {
      if (store.load().profiles[id] && !gemeldet.has(id)) {
        gemeldet.add(id);
        ablauf.push(`setProfile ${id}`);
      }
    }
  };
  let laufend = 0;
  let hoechstens = 0;
  const resolvePlanSlug = async (subscriptionId) => {
    neueProfile();
    ablauf.push(`resolve ${subscriptionId}`);
    laufend++;
    hoechstens = Math.max(hoechstens, laufend);
    await new Promise((weiter) => setImmediate(weiter));
    laufend--;
    return "starter";
  };
  await backfillPlanProfiles({ store, apply: true, resolvePlanSlug });
  neueProfile();
  assert.equal(hoechstens, 1, "Resolver-Aufrufe dürfen nicht gleichzeitig laufen");
  assert.deepEqual(ablauf, ["resolve sub_a", "setProfile t_a", "resolve sub_b", "setProfile t_b"]);
});
