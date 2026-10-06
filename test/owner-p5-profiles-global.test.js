import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { applySchema } from "../src/db/migrate.js";
import { makePgTestStore } from "./pg-helpers.js";

const TENANT_X = "tenant_x";

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
  await db.exec(
    `CREATE TABLE tenant (id TEXT PRIMARY KEY);
     CREATE TABLE profile (
       tenant_id TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
       email TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (tenant_id, email));
     ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
     ALTER TABLE profile FORCE  ROW LEVEL SECURITY;
     CREATE POLICY tenant_isolation ON profile
       USING (tenant_id = current_setting('app.current_tenant', true))
       WITH CHECK (tenant_id = current_setting('app.current_tenant', true));`,
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
