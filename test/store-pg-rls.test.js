// P3b: Row Level Security als zweite Verteidigungslinie. Prueft, dass unter der
// GUC app.current_tenant=owner KEINE Zeilen eines fremden Tenants sichtbar sind -
// unabhaengig vom app-seitigen tenant_id-Filter (Transkript-Leak-Schutz).
//
// WICHTIG: pglite laeuft als Superuser (postgres); Superuser umgehen RLS auch bei
// FORCE. Die App verbindet in Produktion als NICHT-privilegierter DB-Nutzer.
// Deshalb wird hier per SET ROLE auf eine Rolle ohne Superuser/BYPASSRLS
// gewechselt - genau so greift die Policy wie im Betrieb.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, OWNER_TENANT_ID } from "../src/store/pg.js";
import { applySchema, seedDefaults } from "../src/db/migrate.js";
import { demoCalendar } from "../src/store/defaults.js";

const OTHER_TENANT_ID = "other";
const APP_ROLE = "app_user"; // liest Owner-Daten, ohne Superuser/BYPASSRLS
const OWNER_ROLE = "owner_role"; // Tabellen-Eigentuemer ohne BYPASSRLS (FORCE greift)

// Baut den Owner-Store auf (migriert das Schema), seedet einen zweiten Tenant mit
// eigenen Call-/Transkript-/Profil-Zeilen und legt die unprivilegierte Rolle an.
async function setup() {
  const db = new PGlite();
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const store = makePgStore(runner);
  await store.init(); // migriert + seedet Owner

  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [OTHER_TENANT_ID]);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ('call_other', $1, 'tok', 'inbound', 'active', now()::text)`,
    [OTHER_TENANT_ID]
  );
  await db.query(
    `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at)
     VALUES ('call_other', $1, 'caller', 'GEHEIM fremder Tenant', now()::text)`,
    [OTHER_TENANT_ID]
  );
  await db.query(
    `INSERT INTO profile (tenant_id, email, data) VALUES ($1, 'fremd@x', '{"unrestricted":true}')`,
    [OTHER_TENANT_ID]
  );
  // Auch eine Owner-Call-Zeile, damit die Sichtbarkeit positiv geprueft werden kann.
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ('call_owner', $1, 'tok', 'inbound', 'active', now()::text)`,
    [OWNER_TENANT_ID]
  );
  // Je eine number-Zeile pro Tenant (id=e164), um den number-Lookup tenant-isoliert
  // zu pruefen (P3c): die fremde Nummer darf unter der Owner-GUC nicht sichtbar sein.
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider) VALUES ('+49owner', $1, '+49owner', 'twilio')`,
    [OWNER_TENANT_ID]
  );
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider) VALUES ('+49other', $1, '+49other', 'twilio')`,
    [OTHER_TENANT_ID]
  );

  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call, transcript_segment, profile,
       settings, action_item, calendar_event, usage, notification, number TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`
  );
  return db;
}

// Fuehrt eine Aktion als unprivilegierte Rolle mit gesetzter Owner-GUC aus.
async function asAppRole(db, fn) {
  await db.query(`SET ROLE ${APP_ROLE}`);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [OWNER_TENANT_ID]);
  try {
    return await fn();
  } finally {
    await db.query(`RESET ROLE`);
  }
}

test("RLS: Owner-GUC sieht nur Owner-Calls, keine fremden", async () => {
  const db = await setup();
  const ids = await asAppRole(db, async () => (await db.query(`SELECT id FROM call ORDER BY id`)).rows.map((r) => r.id));
  assert.deepEqual(ids, ["call_owner"]);
  assert.ok(!ids.includes("call_other"), "fremder Call ist unsichtbar");
});

test("RLS: Transkripte des fremden Tenants sind nicht lesbar (Leak-Schutz)", async () => {
  const db = await setup();
  const texts = await asAppRole(db, async () =>
    (await db.query(`SELECT text FROM transcript_segment`)).rows.map((r) => r.text)
  );
  assert.equal(texts.length, 0, "kein fremdes Transkript sichtbar");
  assert.ok(!texts.join(" ").includes("GEHEIM"));
});

test("RLS: Profile sind tenant-isoliert", async () => {
  const db = await setup();
  const emails = await asAppRole(db, async () => (await db.query(`SELECT email FROM profile`)).rows.map((r) => r.email));
  assert.ok(!emails.includes("fremd@x"), "fremdes Profil ist unsichtbar");
});

test("RLS: number-Routing ist tenant-isoliert (Cross-Tenant-Read = leer)", async () => {
  const db = await setup();
  const e164s = await asAppRole(db, async () => (await db.query(`SELECT e164 FROM number ORDER BY e164`)).rows.map((r) => r.e164));
  assert.deepEqual(e164s, ["+49owner"], "nur die Owner-Nummer sichtbar");
  assert.ok(!e164s.includes("+49other"), "fremde Nummer ist unsichtbar");
});

test("RLS: Schreibzugriff auf fremde tenant_id wird blockiert (WITH CHECK = USING)", async () => {
  const db = await setup();
  await assert.rejects(
    () => asAppRole(db, () =>
      db.query(
        `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
         VALUES ('call_evil', $1, 'tok', 'inbound', 'active', now()::text)`,
        [OTHER_TENANT_ID]
      )
    ),
    /row-level security|policy/i
  );
});

test("Gegenprobe: ohne RLS-Rolle (Superuser) waeren beide Tenants sichtbar", async () => {
  const db = await setup();
  // Als Superuser (kein SET ROLE) - belegt, dass der Test die Rolle WIRKLICH braucht.
  const ids = (await db.query(`SELECT id FROM call ORDER BY id`)).rows.map((r) => r.id);
  assert.ok(ids.includes("call_owner") && ids.includes("call_other"));
});

// Sichert den Produktionspfad ab, den pglite-als-Superuser sonst verdeckt: unter
// FORCE ROW LEVEL SECURITY muss das Seeding der Owner-Defaults auch fuer eine
// nicht-privilegierte Rolle funktionieren. init() setzt die GUC daher VOR dem
// Seeding - ohne das wuerde die WITH-CHECK der Policy die Owner-Inserts blocken.
// Schema wird als Superuser angelegt, die Rolle bekommt nur DML-Rechte (wie eine
// Migration als Admin + App-Rolle im Betrieb).
test("Seeding der Owner-Defaults passiert die FORCE-RLS-WITH-CHECK (GUC vor Seed)", async () => {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  await db.exec(
    `CREATE ROLE ${OWNER_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, settings, usage, calendar_event TO ${OWNER_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${OWNER_ROLE};`
  );

  await db.query(`SET ROLE ${OWNER_ROLE}`);
  try {
    await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [OWNER_TENANT_ID]);
    // seedDefaults mit gesetzter GUC -> Inserts passieren die WITH-CHECK.
    await seedDefaults({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }, OWNER_TENANT_ID);
    const cal = (await db.query(`SELECT id FROM calendar_event`)).rows;
    assert.equal(cal.length, demoCalendar().length, "Demo-Kalender geseedet trotz FORCE-RLS");
    const settings = (await db.query(`SELECT agent_name FROM settings`)).rows;
    assert.equal(settings[0].agent_name, "Vodafone Agent");
  } finally {
    await db.query(`RESET ROLE`);
  }
});

// Gegenprobe zur Ordnungs-Invariante: OHNE gesetzte GUC blockt die WITH-CHECK das
// Owner-Seeding unter derselben Rolle (belegt, warum init die GUC zuerst setzt).
test("Ohne GUC blockt die FORCE-RLS-WITH-CHECK das Owner-Seeding", async () => {
  const db = new PGlite();
  await applySchema({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) });
  await db.exec(
    `CREATE ROLE ${OWNER_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, settings, usage, calendar_event TO ${OWNER_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${OWNER_ROLE};`
  );
  await db.query(`SET ROLE ${OWNER_ROLE}`);
  try {
    await assert.rejects(
      () => seedDefaults({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }, OWNER_TENANT_ID),
      /row-level security|policy/i
    );
  } finally {
    await db.query(`RESET ROLE`);
  }
});
