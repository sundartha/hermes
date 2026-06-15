// portalStore: per-Request tenant-isolierte Reads. pglite laeuft als Superuser
// (umgeht RLS) -> wie store-pg-rls.test.js per SET ROLE auf eine unprivilegierte
// Rolle wechseln, damit die Policy wie im Betrieb greift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema, seedDefaults } from "../src/db/migrate.js";
import { makePortalStore } from "../src/store/portal.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";
import { config } from "../src/config.js";

config.twilioNumber = ""; config.telnyxNumber = ""; // env-unabhaengig (wie store-pg-rls)

const APP_ROLE = "app_user";
const TENANT_A = "tenant_a", TENANT_B = "tenant_b";

async function setup() {
  const db = new PGlite();
  const exec = (sql) => db.exec(sql);
  const query = (t, p) => db.query(t, p);
  await applySchema({ query, exec });
  // GUC vor Seed (FORCE-RLS WITH-CHECK), wie init() es macht.
  await query(`SELECT set_config('app.current_tenant', $1, false)`, [OWNER_TENANT_ID]);
  await seedDefaults({ query, exec }, OWNER_TENANT_ID);
  for (const t of [TENANT_A, TENANT_B]) {
    await query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [t]);
    await query(
      `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
       VALUES ($1, $2, 'tok', 'inbound', 'active', now()::text)`,
      [`call_${t}`, t]
    );
  }
  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call, transcript_segment, profile, settings,
       action_item, calendar_event, usage, notification, number TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`
  );
  return db;
}

// runner, der pro withTenant SET ROLE setzt (simuliert die unprivilegierte
// Produktionsrolle auf der einen pglite-Verbindung). BEWUSST nur SET ROLE/RESET
// ROLE hier: BEGIN/COMMIT kommen aus portal.js (withTenant), NICHT aus dem
// roleRunner -> kein BEGIN hier einbauen, das wuerde ein nested-BEGIN erzeugen.
function roleRunner(db) {
  return {
    withClient: async (fn) => {
      await db.query(`SET ROLE ${APP_ROLE}`);
      try { return await fn({ query: (t, p) => db.query(t, p) }); }
      finally { await db.query(`RESET ROLE`); }
    },
  };
}

test("portalStore: Tenant A sieht nur eigene Calls", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  const rows = await portal.listCalls(TENANT_A);
  assert.deepEqual(rows.map((r) => r.id), ["call_tenant_a"]);
  assert.ok(!rows.some((r) => r.id === "call_tenant_b"), "fremder Call unsichtbar");
});

test("withTenant: kein tenantId -> Error (fail-closed)", async () => {
  const db = await setup();
  const portal = makePortalStore(roleRunner(db));
  await assert.rejects(portal.listCalls(null), /tenantId Pflicht/);
  await assert.rejects(portal.listCalls(""), /tenantId Pflicht/);
});
