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
import { BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { applySchema, seedDefaults } from "../src/db/migrate.js";
import { demoCalendar } from "../src/store/defaults.js";
import { makePgTestStore } from "./pg-helpers.js";

// Dieser Test kontrolliert die number-Zeilen selbst (manuelle Inserts) und prueft
// die RLS-Isolation deterministisch. Der frische pg-Store seedet keine Owner-Nummer
// mehr (Owner-Nummer kommt ueber seedBootstrapNumber), also keine .env-Kopplung.

const OTHER_TENANT_ID = "other";
const APP_ROLE = "app_user"; // liest Owner-Daten, ohne Superuser/BYPASSRLS
const OWNER_ROLE = "owner_role"; // Tabellen-Eigentuemer ohne BYPASSRLS (FORCE greift)
// PA-3 (S1-1): frischer Web-Login NACH Boot + eine bereits BEENDETE (nicht-aktive) Call-Zeile.
const SIGNUP_TENANT_ID = "signup";
const LOST_CALL_ID = "call_signup_ended";
const ENSURE_ROLE = "ensure_role"; // NOBYPASSRLS: nur so greift FORCE RLS im ensureTenant-Read

// Baut den Owner-Store auf (migriert das Schema), seedet einen zweiten Tenant mit
// eigenen Call-/Transkript-/Profil-Zeilen und legt die unprivilegierte Rolle an.
// pglite-Runner-Aufbau kommt aus dem geteilten Helper (G5): makePgTestStore() baut
// dieselbe withClient-Bindung wie pg-helpers.js in allen anderen pg-Tests.
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
  // profile ist global (kein RLS-Tenant-Filter) - tenant_id-PK allein (Phase S; vormals email).
  await db.query(`INSERT INTO profile (tenant_id, data) VALUES ('fremd@x', '{"unrestricted":true}')`);
  // Auch eine Owner-Call-Zeile, damit die Sichtbarkeit positiv geprueft werden kann.
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ('call_owner', $1, 'tok', 'inbound', 'active', now()::text)`,
    [BOOTSTRAP_TENANT_ID],
  );
  // Je eine number-Zeile pro Tenant (id=e164), um den number-Lookup tenant-isoliert
  // zu pruefen (P3c): die fremde Nummer darf unter der Owner-GUC nicht sichtbar sein.
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider) VALUES ('+49owner', $1, '+49owner', 'twilio')`,
    [BOOTSTRAP_TENANT_ID],
  );
  await db.query(
    `INSERT INTO number (id, tenant_id, e164, provider) VALUES ('+49other', $1, '+49other', 'twilio')`,
    [OTHER_TENANT_ID],
  );

  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call, transcript_segment, profile,
       settings, action_item, calendar_event, usage, notification, number TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );
  return db;
}

// Fuehrt fn() unter SET ROLE (+ optional gesetzter Tenant-GUC) aus und garantiert RESET ROLE
// per finally - auch wenn fn() wirft. Gemeinsames Skelett fuer JEDEN SET-ROLE-Test in diesem
// File (G5): asAppRole, ensureTenantAs und beide Seeding-Tests nutzen denselben Helper statt
// das Muster einzeln zu wiederholen. tenantId=undefined laesst die GUC unangetastet - fuer die
// Gegenprobe "Ohne GUC blockt...", die gezielt die Abwesenheit der GUC prueft.
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

// Fuehrt eine Aktion als unprivilegierte Rolle mit gesetzter Owner-GUC aus.
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
  // profile haengt nicht an app.current_tenant (Policy profile_global). Unter der Owner-GUC
  // ist JEDES Profil sichtbar - Gegenteil der frueheren tenant-Isolation. Beweist die
  // Entkopplung vom Tenant. Schluessel-Spalte ist seit Phase S tenant_id (vormals email).
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
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${OWNER_ROLE};`,
  );

  await withRole(db, OWNER_ROLE, BOOTSTRAP_TENANT_ID, async () => {
    // seedDefaults mit gesetzter GUC -> Inserts passieren die WITH-CHECK.
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

// Gegenprobe zur Ordnungs-Invariante: OHNE gesetzte GUC blockt die WITH-CHECK das
// Owner-Seeding unter derselben Rolle (belegt, warum init die GUC zuerst setzt).
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

// PA-3 (S1-1): baut den Produktionszustand nach Boot nach - Owner geseedet (Superuser),
// dann ein frischer Tenant + eine bereits BEENDETE (nicht-aktive) Call-Zeile direkt in die
// DB (Superuser umgeht die WITH-CHECK der FORCE-RLS). Eine unprivilegierte NOBYPASSRLS-Rolle
// mit reinem SELECT (der Flush laeuft im Test als Superuser; im Fokus steht der Read-Pfad in
// ensureTenant, der die RLS-GUC setzen muss).
async function setupSignup() {
  const { store, db } = await makePgTestStore();

  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [SIGNUP_TENANT_ID]);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, ended_at)
     VALUES ($1, $2, 'tok', 'inbound', 'ended', now()::text, now()::text)`,
    [LOST_CALL_ID, SIGNUP_TENANT_ID],
  );
  // Reines SELECT auf ALLE Tabellen, die ensureTenant liest (tenant + hydrateTenantInto):
  // fehlte ein Recht, wuerfe der Read (permission denied) statt leer zu filtern -> der Bug
  // manifestierte sich ueber einen anderen Pfad (unscharf). SELECT-only, damit der Read
  // sauber RLS-gefiltert (leer), nicht permission-blockiert wird.
  await db.exec(
    `CREATE ROLE ${ENSURE_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT ON tenant, settings, call, transcript_segment, action_item,
       calendar_event, usage, notification, number, provisioning_job, tenant_budget,
       usage_event TO ${ENSURE_ROLE};`,
  );
  return { db, store };
}

// Ruft store.ensureTenant unter (optional) gesetzter Rolle auf. Die GUC wird VORHER
// explizit auf den Owner gepinnt - simuliert eine Pool-Verbindung, die zuletzt fuer einen
// ANDEREN Tenant benutzt wurde (genau der Zustand, in dem der fehlende setTenant zuschlaegt).
function ensureTenantAs(db, store, role) {
  return withRole(db, role, BOOTSTRAP_TENANT_ID, () => store.ensureTenant(SIGNUP_TENANT_ID));
}

test("PA-3/S1-1 (rot-vor-Fix): ensureTenant hydriert nicht-aktive Call-Zeile unter FORCE RLS - kein Flush-Datenverlust", async () => {
  const { db, store } = await setupSignup();

  const ok = await ensureTenantAs(db, store, ENSURE_ROLE);
  assert.equal(ok, true, "ensureTenant meldet Erfolg (Tenant existiert in der DB)");

  // (a) Spiegel-Beweis: ohne setTenant-vor-hydrate filtert FORCE RLS die Zeile unter der
  // stale Owner-GUC leer -> der Spiegel kennt den Call nicht.
  assert.ok(
    store.getCall(LOST_CALL_ID),
    "ensureTenant muss die nicht-aktive Call-Zeile in den Spiegel hydrieren (setTenant vor hydrateTenantInto)",
  );

  // (b) Datenverlust-Beweis: der Flush (jetzt als Superuser, RESET ROLE erfolgt) loescht
  // die reale Zeile, wenn der Spiegel-keep-Set leer ist. Direkter SELECT beweist Ueberleben.
  store.save();
  await store.drainFlushes();
  const rows = (await db.query(`SELECT id FROM call WHERE id = $1`, [LOST_CALL_ID])).rows;
  assert.equal(rows.length, 1, "nicht-aktive Call-Zeile ueberlebt den Flush (kein stiller Datenverlust)");
});

test("PA-3/S1-1 Gegenprobe: als Superuser (BYPASSRLS) faellt der Bug NICHT auf - die NOBYPASSRLS-Rolle ist Pflicht", async () => {
  const { db, store } = await setupSignup();
  // OHNE SET ROLE: Superuser umgeht FORCE RLS -> hydrateTenantInto sieht die Zeile AUCH
  // ohne setTenant. Der Test waere mit UND ohne Fix gruen -> wertlos. Belegt (wie die
  // Bestands-Gegenprobe oben im File "RLS-Rolle Superuser"), warum der eigentliche Test
  // die NOBYPASSRLS-Rolle braucht.
  await ensureTenantAs(db, store, null);
  assert.ok(
    store.getCall(LOST_CALL_ID),
    "als Superuser ist die Zeile ohnehin sichtbar (RLS umgangen) - der Read-Pfad ist so nicht pruefbar",
  );
});
