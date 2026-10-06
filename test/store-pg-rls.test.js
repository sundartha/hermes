import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { applySchema, seedDefaults } from "../src/db/migrate.js";
import { demoCalendar } from "../src/store/defaults.js";
import { makePgTestStore } from "./pg-helpers.js";

const OTHER_TENANT_ID = "other";
const APP_ROLE = "app_user";
const OWNER_ROLE = "owner_role";
const SIGNUP_TENANT_ID = "signup";
const LOST_CALL_ID = "call_signup_ended";
const ENSURE_ROLE = "ensure_role";

async function setup() {
  const { store, db } = await makePgTestStore();

  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [OTHER_TENANT_ID]);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ('call_other', $1, 'tok', 'inbound', 'active', now()::text)`,
    [OTHER_TENANT_ID],
  );
  await db.query(
    `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at)
     VALUES ('call_other', $1, 'caller', 'GEHEIM fremder Tenant', now()::text)`,
    [OTHER_TENANT_ID],
  );
  await db.query(`INSERT INTO profile (tenant_id, data) VALUES ('fremd@x', '{"unrestricted":true}')`);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ('call_owner', $1, 'tok', 'inbound', 'active', now()::text)`,
    [BOOTSTRAP_TENANT_ID],
  );
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider) VALUES ('+49owner', $1, '+49owner', 'telnyx')`,
    [BOOTSTRAP_TENANT_ID],
  );
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider) VALUES ('+49other', $1, '+49other', 'telnyx')`,
    [OTHER_TENANT_ID],
  );
  await db.query(
    `INSERT INTO call_cost_evidence (id, tenant_id, call_id, traeger, reife)
     VALUES ('cce_owner', $1, 'call_owner', 'ai_token', 'erwartet')`,
    [BOOTSTRAP_TENANT_ID],
  );
  await db.query(
    `INSERT INTO call_cost_evidence (id, tenant_id, call_id, traeger, reife)
     VALUES ('cce_other', $1, 'call_other', 'ai_token', 'erwartet')`,
    [OTHER_TENANT_ID],
  );

  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call, transcript_segment, profile,
       settings, action_item, calendar_event, usage, notification, number,
       call_cost_evidence TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );
  return db;
}

async function withRole(db, role, tenantId, fn) {
  if (role) await db.query(`SET ROLE ${role}`);
  if (tenantId !== undefined) {
    await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
  }
  try {
    return await fn();
  } finally {
    if (role) await db.query(`RESET ROLE`);
  }
}

function asAppRole(db, fn) {
  return withRole(db, APP_ROLE, BOOTSTRAP_TENANT_ID, fn);
}

test("RLS: Owner-GUC sieht nur Owner-Calls, keine fremden", async () => {
  const db = await setup();
  const ids = await asAppRole(db, async () =>
    (await db.query(`SELECT id FROM call ORDER BY id`)).rows.map((r) => r.id),
  );
  assert.deepEqual(ids, ["call_owner"]);
  assert.ok(!ids.includes("call_other"), "fremder Call ist unsichtbar");
});

test("RLS: Transkripte des fremden Tenants sind nicht lesbar (Leak-Schutz)", async () => {
  const db = await setup();
  const texts = await asAppRole(db, async () =>
    (await db.query(`SELECT text FROM transcript_segment`)).rows.map((r) => r.text),
  );
  assert.equal(texts.length, 0, "kein fremdes Transkript sichtbar");
  assert.ok(!texts.join(" ").includes("GEHEIM"));
});

test("P5: Profile sind global (kein Tenant-Filter)", async () => {
  const db = await setup();
  const keys = await asAppRole(db, async () =>
    (await db.query(`SELECT tenant_id FROM profile`)).rows.map((r) => r.tenant_id),
  );
  assert.ok(keys.includes("fremd@x"), "Profil ist global sichtbar (kein Tenant-Filter)");
});

test("RLS: number-Routing ist tenant-isoliert (Cross-Tenant-Read = leer)", async () => {
  const db = await setup();
  const e164s = await asAppRole(db, async () =>
    (await db.query(`SELECT e164 FROM number ORDER BY e164`)).rows.map((r) => r.e164),
  );
  assert.deepEqual(e164s, ["+49owner"], "nur die Owner-Nummer sichtbar");
  assert.ok(!e164s.includes("+49other"), "fremde Nummer ist unsichtbar");
});

test("RLS: Kosten-Buch-Zeilen eines fremden Tenants sind unter der Owner-GUC unsichtbar", async () => {
  const db = await setup();
  const alle = await asAppRole(db, async () =>
    (await db.query(`SELECT id FROM call_cost_evidence`)).rows,
  );
  assert.equal(alle.length, 1, "nur die eigene Zeile sichtbar (Positivkontrolle)");
  assert.equal(alle[0].id, "cce_owner");
  const fremde = await asAppRole(db, async () =>
    (await db.query(`SELECT id FROM call_cost_evidence WHERE tenant_id = $1`, [OTHER_TENANT_ID]))
      .rows,
  );
  assert.equal(fremde.length, 0, "die fremde tenant_id liefert unter der Owner-GUC nichts");
});

test("RLS: Schreibzugriff auf fremde tenant_id wird blockiert (WITH CHECK = USING)", async () => {
  const db = await setup();
  await assert.rejects(
    () =>
      asAppRole(db, () =>
        db.query(
          `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
         VALUES ('call_evil', $1, 'tok', 'inbound', 'active', now()::text)`,
          [OTHER_TENANT_ID],
        ),
      ),
    /row-level security|policy/i,
  );
});

test("Gegenprobe: ohne RLS-Rolle (Superuser) waeren beide Tenants sichtbar", async () => {
  const db = await setup();
  const ids = (await db.query(`SELECT id FROM call ORDER BY id`)).rows.map((r) => r.id);
  assert.ok(ids.includes("call_owner") && ids.includes("call_other"));
});

test("Seeding der Owner-Defaults passiert die FORCE-RLS-WITH-CHECK (GUC vor Seed)", async () => {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  await db.exec(
    `CREATE ROLE ${OWNER_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, settings, usage, calendar_event TO ${OWNER_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${OWNER_ROLE};`,
  );

  await withRole(db, OWNER_ROLE, BOOTSTRAP_TENANT_ID, async () => {
    await seedDefaults(
      { query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) },
      BOOTSTRAP_TENANT_ID,
    );
    const cal = (await db.query(`SELECT id FROM calendar_event`)).rows;
    assert.equal(cal.length, demoCalendar().length, "Demo-Kalender geseedet trotz FORCE-RLS");
    const settings = (await db.query(`SELECT agent_name FROM settings`)).rows;
    assert.equal(settings[0].agent_name, "Hermes");
  });
});

test("Ohne GUC blockt die FORCE-RLS-WITH-CHECK das Owner-Seeding", async () => {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  await db.exec(
    `CREATE ROLE ${OWNER_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, settings, usage, calendar_event TO ${OWNER_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${OWNER_ROLE};`,
  );
  await withRole(db, OWNER_ROLE, undefined, () =>
    assert.rejects(
      () =>
        seedDefaults(
          { query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) },
          BOOTSTRAP_TENANT_ID,
        ),
      /row-level security|policy/i,
    ),
  );
});

async function setupSignup() {
  const { store, db } = await makePgTestStore();

  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [SIGNUP_TENANT_ID]);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, ended_at)
     VALUES ($1, $2, 'tok', 'inbound', 'ended', now()::text, now()::text)`,
    [LOST_CALL_ID, SIGNUP_TENANT_ID],
  );
  await db.exec(
    `CREATE ROLE ${ENSURE_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT ON tenant, settings, call, transcript_segment, action_item,
       calendar_event, usage, notification, number, provisioning_job, tenant_budget,
       usage_event, call_cost_evidence TO ${ENSURE_ROLE};`,
  );
  return { db, store };
}

function ensureTenantAs(db, store, role) {
  return withRole(db, role, BOOTSTRAP_TENANT_ID, () => store.ensureTenant(SIGNUP_TENANT_ID));
}

test("PA-3/S1-1 (rot-vor-Fix): ensureTenant hydriert nicht-aktive Call-Zeile unter FORCE RLS - kein Flush-Datenverlust", async () => {
  const { db, store } = await setupSignup();

  const ok = await ensureTenantAs(db, store, ENSURE_ROLE);
  assert.equal(ok, true, "ensureTenant meldet Erfolg (Tenant existiert in der DB)");

  assert.ok(
    store.getCall(LOST_CALL_ID),
    "ensureTenant muss die nicht-aktive Call-Zeile in den Spiegel hydrieren (setTenant vor hydrateTenantInto)",
  );

  store.save();
  await store.drainFlushes();
  const rows = (await db.query(`SELECT id FROM call WHERE id = $1`, [LOST_CALL_ID])).rows;
  assert.equal(rows.length, 1, "nicht-aktive Call-Zeile ueberlebt den Flush (kein stiller Datenverlust)");
});

test("PA-3/S1-1 Gegenprobe: als Superuser (BYPASSRLS) faellt der Bug NICHT auf - die NOBYPASSRLS-Rolle ist Pflicht", async () => {
  const { db, store } = await setupSignup();
  await ensureTenantAs(db, store, null);
  assert.ok(
    store.getCall(LOST_CALL_ID),
    "als Superuser ist die Zeile ohnehin sichtbar (RLS umgangen) - der Read-Pfad ist so nicht pruefbar",
  );
});
