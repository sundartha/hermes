import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema, seedDefaults } from "../src/db/migrate.js";
import { makePortalStore } from "../src/store/portal.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const APP_ROLE = "app_user";
const TENANT_A = "tenant_a",
  TENANT_B = "tenant_b";

async function setup() {
  const db = new PGlite();
  const exec = (sql) => db.exec(sql);
  const query = (t, p) => db.query(t, p);
  await applySchema({ query, exec });
  await query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
  await seedDefaults({ query, exec }, BOOTSTRAP_TENANT_ID);
  for (const t of [TENANT_A, TENANT_B]) {
    await query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [t]);
    await query(
      `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
       VALUES ($1, $2, 'tok', 'inbound', 'active', now()::text)`,
      [`call_${t}`, t],
    );
  }
  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call, transcript_segment, profile, settings,
       action_item, calendar_event, usage, notification, number TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );
  return db;
}

function roleRunner(db) {
  return {
    withClient: async (fn) => {
      await db.query(`SET ROLE ${APP_ROLE}`);
      try {
        return await fn({ query: (t, p) => db.query(t, p) });
      } finally {
        await db.query(`RESET ROLE`);
      }
    },
  };
}

test("portalStore: Tenant A sieht nur eigene Calls", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  const rows = await portal.listCalls(TENANT_A);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["call_tenant_a"],
  );
  assert.ok(!rows.some((r) => r.id === "call_tenant_b"), "fremder Call unsichtbar");
});

test("withTenant: kein tenantId -> Error (fail-closed)", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  await assert.rejects(portal.listCalls(null), /tenantId Pflicht/);
  await assert.rejects(portal.listCalls(""), /tenantId Pflicht/);
});

test("portalStore: Tenant B sieht NUR call_tenant_b, nicht call_tenant_a", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  const rows = await portal.listCalls(TENANT_B);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["call_tenant_b"],
  );
});

test("portalStore: frischer Tenant ist leer (kein Owner-Leak)", async () => {
  const db = await setup();
  await db.query(`INSERT INTO tenant (id) VALUES ('tenant_fresh') ON CONFLICT DO NOTHING`);
  const portal = makePortalStore(roleRunner(db));
  const rows = await portal.listCalls("tenant_fresh");
  assert.equal(rows.length, 0, "leerer Tenant sieht nichts vom Owner/anderen");
});

test("portalStore: Transkript-Read ist tenant-isoliert (Leak-Schutz)", async () => {
  const db = await setup();
  await db.query(
    `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at)
     VALUES ('call_tenant_a', $1, 'caller', 'GEHEIM_A', now()::text)`,
    [TENANT_A],
  );
  const portal = makePortalStore(roleRunner(db));
  const texts = await portal.withTenant(TENANT_B, async (c) =>
    (await c.query(`SELECT text FROM transcript_segment`)).rows.map((r) => r.text),
  );
  assert.ok(!texts.join(" ").includes("GEHEIM_A"), "Tenant B sieht A-Transkript nicht");
});

test("portalStore: Query-Fehler in withTenant -> ROLLBACK, naechster Request sauber isoliert", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  await assert.rejects(
    () =>
      portal.withTenant(TENANT_A, async (c) => {
        await c.query(`SELECT 1`);
        await c.query(`SELECT * FROM does_not_exist`);
      }),
    /does_not_exist|relation/i,
  );
  const rows = await portal.listCalls(TENANT_B);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["call_tenant_b"],
    "kein GUC-Leak von A nach B",
  );
});
