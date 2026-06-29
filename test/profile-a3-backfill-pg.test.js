// A3 - Backfill gegen das ECHTE pg-Schema (pglite, offline, F.I.R.S.T.). Faengt SQL-/
// Persistenz-Fehler, die der state-ops-Kern-Test (profile-a3-backfill.test.js) nicht sieht:
// EINE pglite-Instanz traegt den Store-Spiegel (makePgStore) UND die Accounts (makeAccounts)
// -> backfillPlanProfiles laeuft end-to-end ueber accountByTenant + setProfile + Flush/
// Hydrate. Rein pglite, NIE mit Server-Spawn gemischt (P6a-Stall-Lehre).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore } from "../src/store/pg.js";
import { makeAccounts } from "../src/web-auth.js";
import { backfillPlanProfiles, BACKFILL_SKIP } from "../src/billing/backfill-profiles.js";
import { KYC_LEVEL } from "../src/store/defaults.js";

// Query-Runner-Adapter ueber EINER pglite-Instanz - das Schnittstellen-Objekt, das
// makePgStore und makeAccounts erwarten (withClient -> { query, exec }).
function makeRunner(db) {
  return {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
}

// Oeffnet einen pg-Store auf dem Runner; store.init() migriert das volle Schema
// (inkl. account/session) und hydriert den Bootstrap-Owner.
async function openStore(runner) {
  const store = makePgStore(runner);
  await store.init();
  return store;
}

// Baut einen Store + Accounts auf EINER pglite-Instanz (geteilte DB ueber denselben Runner).
async function makeStoreAndAccounts() {
  const db = new PGlite();
  const runner = makeRunner(db);
  const store = await openStore(runner);
  return { db, store, accounts: makeAccounts(runner) };
}

// Frischer Store auf EINER bestehenden pglite-Instanz (re-hydriert aus der DB) - so wird
// Persistenz statt nur In-Memory geprueft (Muster owner-p5-profiles-global reopen).
async function reopen(db) {
  return openStore(makeRunner(db));
}

// Legt einen aktiven, CARD-verifizierten Subscriber an (Account + Tenant + KYC + Abo) und
// zieht ihn in den Store-Spiegel (ensureTenant). Spiegelt den Pre-A2-Bestand: aktiviert,
// aber (noch) ohne Rechteprofil.
async function seedActiveSubscriber(store, accounts, { sub, email, planSlug, subscriptionId }) {
  const { tenantId } = await accounts.upsertOnFirstLogin({ sub, email });
  await accounts.setStatus(tenantId, "active");
  await store.ensureTenant(tenantId);
  store.setKycLevel(tenantId, KYC_LEVEL.CARD);
  if (planSlug || subscriptionId) store.setTenantSubscription(tenantId, { planSlug, subscriptionId });
  await store.save();
  return tenantId;
}

test("Dry-Run listet den Bestands-Subscriber, schreibt aber kein Profil", async () => {
  const { store, accounts } = await makeStoreAndAccounts();
  await seedActiveSubscriber(store, accounts, { sub: "u1", email: "u1@x", planSlug: "starter", subscriptionId: "sub_1" });
  const r = await backfillPlanProfiles({ store, accounts, apply: false });
  assert.deepEqual(r.changes, [{ id: "t_u1", email: "u1@x", hadExisting: false }]);
  assert.equal("u1@x" in store.load().profiles, false); // Dry-Run mutiert NICHT
});

test("Apply provisioniert + persistiert das Tier-Profil (hydrate->flush->hydrate)", async () => {
  const { db, store, accounts } = await makeStoreAndAccounts();
  await seedActiveSubscriber(store, accounts, { sub: "u1", email: "u1@x", planSlug: "starter", subscriptionId: "sub_1" });

  const r = await backfillPlanProfiles({ store, accounts, apply: true });
  await store.save(); // pg-Flush abwarten (Muster CLI)
  assert.equal(r.changes.length, 1);
  assert.equal(store.resolveProfile("u1@x").maxCallsPerHour, null);

  // Persistenz-Beleg: frischer Store re-hydriert den Key aus der DB.
  const reopened = await reopen(db);
  assert.equal(reopened.resolveProfile("u1@x").unrestricted, false, "Profil round-trippt persistent");

  // Idempotenz ueber die DB-Form: 2. Apply auf dem re-hydrierten Store = 0 changes.
  const r2 = await backfillPlanProfiles({ store: reopened, accounts, apply: true });
  assert.equal(r2.changes.length, 0);
  assert.equal(r2.unchanged.length, 1);
});

test("mehrdeutiger Account (2 auf einem Tenant) -> skip no_account, kein Profil", async () => {
  const { db, store, accounts } = await makeStoreAndAccounts();
  await seedActiveSubscriber(store, accounts, { sub: "u1", email: "u1@x", planSlug: "starter", subscriptionId: "sub_1" });
  // Zweiten Account auf denselben Tenant haengen (FK, NICHT unique) -> mehrdeutig.
  await accounts.upsertOnFirstLogin({ sub: "u2", email: "u2@x" });
  await db.query(`UPDATE account SET tenant_id = 't_u1' WHERE sub = 'u2'`);

  const r = await backfillPlanProfiles({ store, accounts, apply: true });
  await store.save();
  assert.ok(r.skipped.some((x) => x.id === "t_u1" && x.reason === BACKFILL_SKIP.NO_ACCOUNT));
  assert.equal("u1@x" in store.load().profiles, false);
});

test("Bootstrap-Owner (im Spiegel, kein Plan) wird nie gebackfillt", async () => {
  const { store, accounts } = await makeStoreAndAccounts();
  const owner = store.load().tenants.find((t) => t.id !== "t_u1");
  const r = await backfillPlanProfiles({ store, accounts, apply: true });
  assert.ok(r.skipped.some((x) => x.id === owner.id && x.reason === BACKFILL_SKIP.BOOTSTRAP));
  assert.equal(Object.keys(store.load().profiles).length, 0);
});
