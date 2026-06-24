// Owner-Removal P5: Profiles sind global (keine Tenant-Bindung mehr). Belegt gegen
// pglite (Postgres-in-WASM, offline, F.I.R.S.T.):
//   1. Profile ueberleben Flush/Hydrate (R6, Kern-Datenverlust-Beleg).
//   2. Ein Store ohne Bezug zum Bootstrap-Tenant round-trippt seine Profile (Entkopplung).
//   3. profile traegt die Policy profile_global (nicht tenant_isolation) - Schema-Umstellung.
//   4. Eine bestehende owner-keyed profile-Tabelle bleibt nach dem Schema-Migrate
//      erreichbar (R6, Datenverlust-Beleg fuer Bestands-Stores).
// Rein pglite, NIE mit Server-Spawn gemischt (P6a-Stall-Lehre).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { applySchema } from "../src/db/migrate.js";
import { makePgTestStore } from "./pg-helpers.js";

const TENANT_X = "tenant_x";

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (re-hydriert den
// Spiegel aus der DB) - so wird Persistenz statt nur In-Memory geprueft.
async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("P5: Profile ueberleben Flush/Hydrate ohne Owner-Tenant", async () => {
  const { store, db } = await makePgTestStore();
  store.setProfile("x@t", { maxCallsPerHour: 7 });
  await store.save();

  const r = await reopen(db);
  assert.equal(r.resolveProfile("x@t").maxCallsPerHour, 7, "Profil round-trippt persistent");
});

test("P5: Profile eines NICHT-Bootstrap-Tenant-Stores round-trippen", async () => {
  const { store, db } = await makePgTestStore();
  // Tenant ohne Bezug zum Bootstrap-Tenant; das Profil haengt an KEINEM Tenant (global).
  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [TENANT_X]);
  store.setProfile("y@t", { unrestricted: true });
  await store.save();

  const r = await reopen(db);
  assert.equal(r.resolveProfile("y@t").unrestricted, true, "global, vom Owner-Tenant entkoppelt");
});

test("P5: profile traegt die Policy profile_global (nicht tenant_isolation)", async () => {
  const { db } = await makePgTestStore();
  const names = (
    await db.query(`SELECT policyname FROM pg_policies WHERE tablename = 'profile'`)
  ).rows.map((r) => r.policyname);
  assert.deepEqual(names, ["profile_global"], "genau die globale Policy, kein tenant_isolation");
});

test("P5: Migration owner-keyed profile bleibt nach Schema-Migrate erreichbar", async () => {
  const db = new PGlite();
  const conn = { query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) };
  // Alte (owner-tenant-scoped) profile-Tabelle simulieren + eine owner-keyed Zeile.
  await db.exec(
    `CREATE TABLE tenant (id TEXT PRIMARY KEY);
     CREATE TABLE profile (
       tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
       email TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (tenant_id, email));`,
  );
  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [BOOTSTRAP_TENANT_ID]);
  await db.query(`INSERT INTO profile (tenant_id, email, data) VALUES ($1, 'alt@x', '{"unrestricted":true}')`, [
    BOOTSTRAP_TENANT_ID,
  ]);

  await applySchema(conn);

  const rows = (await db.query(`SELECT email, data FROM profile`)).rows;
  assert.equal(rows.length, 1, "Bestands-Profil bleibt nach Migrate erhalten (kein Datenverlust)");
  assert.equal(rows[0].email, "alt@x");
});
