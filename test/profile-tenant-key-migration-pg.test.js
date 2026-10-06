import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema, rekeyProfilesToTenant } from "../src/db/migrate.js";

function connOf(db) {
  return { query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) };
}

test("(e) rekeyProfilesToTenant hebt email-Keys auf tenantId, erhaelt Orphans, idempotent", async () => {
  const db = new PGlite();
  const conn = connOf(db);
  await applySchema(conn);
  await db.query(`INSERT INTO tenant (id, status) VALUES ('t_x', 'active')`);
  await db.query(`INSERT INTO account (sub, email, tenant_id) VALUES ('sub-x', 'x@mail', 't_x')`);
  await db.query(`INSERT INTO profile (tenant_id, data) VALUES ('x@mail', '{"unrestricted":true}')`);
  await db.query(`INSERT INTO profile (tenant_id, data) VALUES ('orphan@mail', '{"maxCallsPerHour":3}')`);

  await rekeyProfilesToTenant(conn);

  const keys = (await db.query(`SELECT tenant_id FROM profile ORDER BY tenant_id`)).rows.map(
    (r) => r.tenant_id,
  );
  assert.deepEqual(keys, ["orphan@mail", "t_x"], "x@mail -> t_x rekeyt; Orphan bleibt");
  const tx = (await db.query(`SELECT data FROM profile WHERE tenant_id = 't_x'`)).rows[0].data;
  assert.equal(tx.unrestricted, true, "Daten unter der tenantId erhalten");

  const before = (await db.query(`SELECT tenant_id, data FROM profile ORDER BY tenant_id`)).rows;
  await rekeyProfilesToTenant(conn);
  const after = (await db.query(`SELECT tenant_id, data FROM profile ORDER BY tenant_id`)).rows;
  assert.deepEqual(after, before, "2. Lauf byte-identisch (idempotent)");
});

test("(e) Forward-compat Schema-Rename: email-PK Bestands-Tabelle -> tenant_id-PK", async () => {
  const db = new PGlite();
  const conn = connOf(db);
  await db.exec(
    `CREATE TABLE profile (email TEXT PRIMARY KEY, data JSONB NOT NULL);
     INSERT INTO profile (email, data) VALUES ('alt@x', '{"unrestricted":true}');`,
  );
  await applySchema(conn);
  const cols = (
    await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='profile' ORDER BY column_name`,
    )
  ).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["data", "tenant_id"], "email-Spalte ist jetzt tenant_id");
  const row = (await db.query(`SELECT tenant_id, data FROM profile`)).rows[0];
  assert.equal(row.tenant_id, "alt@x", "Bestands-Schluessel bleibt erhalten (Daten-Rekey separat)");
  assert.equal(row.data.unrestricted, true);
});
