// A3 - Backfill plan-basierter Rechteprofile fuer Bestands-Subscriber (GAP A). Backend-
// agnostischer Kern ueber die geteilte state-ops-Schicht (deckt json + pglite-Logik; die
// pg-Persistenz liegt separat in profile-a3-backfill-pg.test.js). Muster wie
// profile-a2-activation.test.js: ECHTER state + duenner storeOn(s)-Seam + Fake-Accounts,
// offline, F.I.R.S.T. Plus ein CLI-No-Op-Smoke (json-Backend, §5.7).
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
import { sanitizeProfile, KYC_OUTBOUND_MIN, KYC_LEVEL, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";
import { backfillPlanProfiles, BACKFILL_SKIP } from "../src/billing/backfill-profiles.js";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../scripts/backfill-plan-profiles.js", import.meta.url));

// Duenner Store-Seam auf einem ECHTEN state-Objekt -> s.profiles ist assertbar. Genau die
// von backfillPlanProfiles genutzten Methoden, jede gegen die echte state-ops-Mutation.
function storeOn(s) {
  return {
    load: () => s,
    tenantActiveSubscriber: (t, min) => tenantActiveSubscriber(s, t, min),
    tenantSubscription: (t) => tenantSubscription(s, t),
    setTenantSubscription: (t, p) => setTenantSubscription(s, t, p),
    setProfile: (email, patch) => setProfile(s, email, patch),
  };
}

// map: { tenantId: {sub,email} | null } -> accountByTenant (A2-Bruecke tenantId -> email).
// Fehlt der Key, liefert er null (genau-1-sonst-null-Vertrag, deckt 0 UND >1 fail-closed).
function fakeAccounts(map) {
  return { accountByTenant: async (id) => map[id] ?? null };
}

// Baut einen aktiven, CARD-verifizierten Subscriber mit (optional) Plan-Slug.
function seedSubscriber(s, id, { planSlug, subscriptionId } = {}) {
  registerTenant(s, id, {});
  setKycLevel(s, id, KYC_LEVEL.CARD);
  if (planSlug || subscriptionId) setTenantSubscription(s, id, { planSlug, subscriptionId });
}

// --- Dry-Run: Diff korrekt, KEINE Mutation ---
test("Dry-Run listet die Aenderung, schreibt aber kein Profil", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "starter" });
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: { sub: "u1", email: "u1@x" } }),
    apply: false,
  });
  assert.deepEqual(r.changes, [{ id: "t_a", email: "u1@x", hadExisting: false }]);
  assert.equal(Object.keys(s.profiles).length, 0); // Dry-Run mutiert NICHT
});

// --- Apply schreibt den vollen Tier-Snapshot (inkl. maxCallsPerHour=null) ---
test("Apply provisioniert das Tier-Profil auf account.email (alle 6 Felder)", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "starter" });
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: { sub: "u1", email: "u1@x" } }),
    apply: true,
  });
  assert.deepEqual(s.profiles["u1@x"], sanitizeProfile(planProfileFor("starter")));
  assert.equal(s.profiles["u1@x"].maxCallsPerHour, null);
  assert.equal(r.changes.length, 1);
});

// --- Idempotenz: 2. Apply-Lauf = 0 changes ---
test("zweiter Apply-Lauf ist idempotent (0 changes, in unchanged)", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "business" });
  const accounts = fakeAccounts({ t_a: { sub: "u1", email: "u1@x" } });
  await backfillPlanProfiles({ store: storeOn(s), accounts, apply: true });
  const r2 = await backfillPlanProfiles({ store: storeOn(s), accounts, apply: true });
  assert.equal(r2.changes.length, 0);
  assert.deepEqual(r2.unchanged, [{ id: "t_a", email: "u1@x" }]);
});

// --- Owner/Bootstrap hart ausgenommen (auch wenn er ALLES erfuellt) ---
test("Bootstrap-Tenant wird per ID ausgenommen (skip bootstrap, kein Profil)", async () => {
  const s = makeDefaultState();
  // Bootstrap kuenstlich zum perfekten Subscriber machen -> beweist die Ausnahme ist per ID.
  setKycLevel(s, BOOTSTRAP_TENANT_ID, KYC_LEVEL.ID_VERIFIED);
  setTenantSubscription(s, BOOTSTRAP_TENANT_ID, { planSlug: "business" });
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ [BOOTSTRAP_TENANT_ID]: { sub: "o", email: "owner@x" } }),
    apply: true,
  });
  assert.ok(r.skipped.some((x) => x.id === BOOTSTRAP_TENANT_ID && x.reason === BACKFILL_SKIP.BOOTSTRAP));
  assert.equal("owner@x" in s.profiles, false);
});

// --- Aktiver Subscriber ohne planSlug -> no_plan, kein planProfileFor(undefined) ---
test("aktiver Subscriber ohne planSlug -> skip no_plan, kein Profil", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a"); // CARD, aber keine Subscription -> planSlug null
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: { sub: "u1", email: "u1@x" } }),
    apply: true,
  });
  assert.ok(r.skipped.some((x) => x.id === "t_a" && x.reason === BACKFILL_SKIP.NO_PLAN));
  assert.equal(Object.keys(s.profiles).length, 0);
});

// --- Abwesender/mehrdeutiger Account -> no_account (accountByTenant-Vertrag) ---
test("accountByTenant -> null -> skip no_account, kein Eintrag", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "starter" });
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: null }), // 0 ODER >1 = mehrdeutig -> null
    apply: true,
  });
  assert.ok(r.skipped.some((x) => x.id === "t_a" && x.reason === BACKFILL_SKIP.NO_ACCOUNT));
  assert.equal(Object.keys(s.profiles).length, 0);
});

// --- Leere account.email -> no_email ---
test("leere account.email -> skip no_email, kein Eintrag", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "starter" });
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: { sub: "u1", email: "" } }),
    apply: true,
  });
  assert.ok(r.skipped.some((x) => x.id === "t_a" && x.reason === BACKFILL_SKIP.NO_EMAIL));
  assert.equal(Object.keys(s.profiles).length, 0);
});

// --- Toll-Fraud-Downgrade: Merge==Replace raeumt Alt-unrestricted=true ab ---
test("vorbestehendes unrestricted=true + allowedNumbers -> nach Apply false/[]", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { planSlug: "business" });
  s.profiles["u1@x"] = { unrestricted: true, allowedNumbers: ["+491701234567"], maxCallsPerHour: 99 };
  await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: { sub: "u1", email: "u1@x" } }),
    apply: true,
  });
  assert.equal(s.profiles["u1@x"].unrestricted, false);
  assert.deepEqual(s.profiles["u1@x"].allowedNumbers, []);
  assert.equal(s.profiles["u1@x"].maxCallsPerHour, null);
});

// --- Nicht-Subscriber (kein KYC) -> not_subscriber, kein Profil ---
test("aktiver Tenant ohne KYC -> skip not_subscriber, kein Profil", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {}); // active, aber kein kycLevel -> kein Subscriber
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: { sub: "u1", email: "u1@x" } }),
    apply: true,
  });
  assert.ok(r.skipped.some((x) => x.id === "t_a" && x.reason === BACKFILL_SKIP.NOT_SUBSCRIBER));
  assert.equal(Object.keys(s.profiles).length, 0);
});

// --- Reconcile-Seam (Fake): heilt slug-loses Abo, setzt Slug + Profil ---
test("Reconcile-Resolver heilt slug-loses Abo (setzt Slug, schreibt Profil)", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { subscriptionId: "sub_x" }); // CARD + Abo, aber KEIN planSlug
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: { sub: "u1", email: "u1@x" } }),
    apply: true,
    resolvePlanSlug: async () => "business",
  });
  assert.deepEqual(r.reconciled, [{ id: "t_a" }]);
  assert.equal(tenantSubscription(s, "t_a").planSlug, "business"); // Slug persistiert im Spiegel
  assert.deepEqual(s.profiles["u1@x"], sanitizeProfile(planProfileFor("business")));
});

// --- Ohne Reconcile-Resolver bleibt das slug-lose Abo no_plan-Skip ---
test("slug-loses Abo ohne Reconcile -> skip no_plan", async () => {
  const s = makeDefaultState();
  seedSubscriber(s, "t_a", { subscriptionId: "sub_x" });
  const r = await backfillPlanProfiles({
    store: storeOn(s),
    accounts: fakeAccounts({ t_a: { sub: "u1", email: "u1@x" } }),
    apply: true,
  });
  assert.ok(r.skipped.some((x) => x.id === "t_a" && x.reason === BACKFILL_SKIP.NO_PLAN));
  assert.equal(Object.keys(s.profiles).length, 0);
});

// --- §5.7: json-Backend = sauberer No-Op (kein Wurf, store.json unberuehrt) ---
test("CLI ist im json-Backend ein No-Op (exit 0, store.json nicht erzeugt)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "a3-backfill-"));
  try {
    const { stdout } = await execFileAsync("node", [CLI], {
      env: { ...process.env, STORE_BACKEND: "json", DATA_DIR: dir },
    });
    assert.match(stdout, /json-Backend: No-Op/);
    assert.equal(existsSync(join(dir, "store.json")), false); // No-Op schreibt nie
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
