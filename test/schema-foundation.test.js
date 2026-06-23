import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";

async function freshDb() {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  return db;
}

test("account/session/audit_log existieren", async () => {
  const db = await freshDb();
  for (const t of ["account", "session", "audit_log"]) {
    const r = await db.query(`SELECT to_regclass($1) AS x`, [t]);
    assert.ok(r.rows[0].x, `${t} fehlt`);
  }
});

test("CASCADE: tenant-Loeschung entfernt account/session, NICHT audit_log", async () => {
  const db = await freshDb();
  await db.query(`INSERT INTO tenant (id) VALUES ('t1')`);
  await db.query(`INSERT INTO account (sub, email, tenant_id) VALUES ('s1','a@x','t1')`);
  await db.query(
    `INSERT INTO session (id, sub, tenant_id, expires_at) VALUES ('sess1','s1','t1', now()+interval '1h')`,
  );
  await db.query(`INSERT INTO audit_log (tenant_id, action) VALUES ('t1','tenant_create')`);
  await db.query(`DELETE FROM tenant WHERE id='t1'`);
  assert.equal((await db.query(`SELECT 1 FROM account`)).rows.length, 0, "account cascaded");
  assert.equal((await db.query(`SELECT 1 FROM session`)).rows.length, 0, "session cascaded");
  assert.equal(
    (await db.query(`SELECT 1 FROM audit_log`)).rows.length,
    1,
    "audit_log ueberdauert (compliance)",
  );
});
