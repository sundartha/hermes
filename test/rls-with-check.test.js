// F4: Explizites WITH CHECK auf allen tenant_isolation-Policies. Beweist, dass die
// DB schreibende Zugriffe mit fremder/fehlender tenant_id-GUC ablehnt (zweite
// Verteidigungslinie gegen einen vergessenen tenant_id-Filter in kuenftigen
// Schreibpfaden). Muster wie store-pg-rls.test.js: pglite als Superuser, Schema als
// Superuser angewendet, DML als unprivilegierte Rolle (NOBYPASSRLS) mit GUC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";

const APP_ROLE = "app_user"; // schreibt unter RLS, ohne Superuser/BYPASSRLS
const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";
const RLS_ERROR = /row-level security|policy/i;

// Frische pglite-Instanz, Schema angewendet (Superuser), beide Tenants angelegt und
// die unprivilegierte Rolle mit DML-Rechten erzeugt. Schreibt KEINE call-Zeilen -
// das machen die einzelnen Tests, damit jeder Test seinen Ausgangszustand kontrolliert.
async function setup() {
  const db = new PGlite();
  const conn = { query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) };
  await applySchema(conn);

  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [TENANT_A]);
  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [TENANT_B]);

  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN NOBYPASSRLS;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call, settings, transcript_segment,
       action_item, calendar_event, usage, profile, notification, number,
       number_assignment TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );
  return { db, conn };
}

// Fuehrt fn als unprivilegierte Rolle aus; setzt die GUC nur, wenn ein Tenant
// uebergeben wird (tenantId=null -> leerer Kontext, fail-closed-Pruefung).
async function asAppRole(db, tenantId, fn) {
  await db.query(`SET ROLE ${APP_ROLE}`);
  if (tenantId !== null) {
    await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
  }
  try {
    return await fn();
  } finally {
    await db.query(`RESET ROLE`);
  }
}

function insertCall(db, id, tenantId) {
  return db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
     VALUES ($1, $2, 'tok', 'inbound', 'active', now()::text)`,
    [id, tenantId],
  );
}

// Anzahl Tabellen mit tenant_isolation-Policy (schema.sql). AC1 verlangt fuer JEDE
// dieser Policies ein EXPLIZITES WITH CHECK - belegbar ueber pg_policies.with_check.
// 13 = die urspruenglichen 10 + die 3 P6-Tabellen (provisioning_job, tenant_budget,
// usage_event) MINUS profile: profile ist seit Owner-Removal P5 global (eigene Policy
// profile_global, nicht mehr tenant_isolation) + call_cost_evidence, KV2-3.
const TENANT_ISOLATION_POLICY_COUNT = 13;

// T0 (AC1): Jede tenant_isolation-Policy hat ein explizites WITH CHECK im Katalog.
// Ohne explizite Klausel ist pg_policies.with_check NULL (FOR ALL wendet USING nur
// IMPLIZIT an) - genau die stille Konvention, die F4 sichtbar macht. Dieser Test ist
// vor dem Fix ROT (with_check IS NULL) und gruen, sobald die Klausel explizit ist.
test("AC1: alle tenant_isolation-Policies tragen ein explizites WITH CHECK", async () => {
  const { db } = await setup();
  const rows = (
    await db.query(
      `SELECT tablename, with_check FROM pg_policies WHERE policyname = 'tenant_isolation'`,
    )
  ).rows;
  assert.equal(rows.length, TENANT_ISOLATION_POLICY_COUNT, "alle Policies vorhanden");
  const missing = rows.filter((r) => r.with_check === null).map((r) => r.tablename);
  assert.deepEqual(missing, [], `Policies ohne explizites WITH CHECK: ${missing.join(", ")}`);
});

// T1 (AC5): INSERT mit korrekter tenant_id passiert die WITH-CHECK.
test("WITH CHECK: INSERT mit korrekter tenant_id passiert RLS", async () => {
  const { db } = await setup();
  await asAppRole(db, TENANT_A, () => insertCall(db, "c_ok", TENANT_A));
  const count = (await db.query(`SELECT count(*)::int AS n FROM call WHERE id = 'c_ok'`)).rows[0].n;
  assert.equal(count, 1, "legitime Zeile wurde geschrieben");
});

// T2 (AC3): INSERT mit fremder tenant_id wird von der WITH-CHECK abgelehnt.
test("WITH CHECK: INSERT mit fremder tenant_id wird von RLS blockiert", async () => {
  const { db } = await setup();
  await assert.rejects(
    () => asAppRole(db, TENANT_A, () => insertCall(db, "c_evil", TENANT_B)),
    RLS_ERROR,
  );
});

// T3: INSERT ohne gesetzte GUC (leerer Kontext) wird abgelehnt (fail-closed).
test("WITH CHECK: INSERT ohne GUC wird von RLS blockiert (fail-closed)", async () => {
  const { db } = await setup();
  await assert.rejects(
    () => asAppRole(db, null, () => insertCall(db, "c_noguc", TENANT_A)),
    RLS_ERROR,
  );
});

// T4 (AC4): UPDATE, das tenant_id auf einen fremden Tenant setzt, wird abgelehnt.
// Der eigentliche Sicherheitsnachweis fuer explizites WITH CHECK (geht ohne es verloren,
// sobald eine Policy in FOR SELECT + FOR INSERT/UPDATE aufgespalten wird).
test("WITH CHECK: UPDATE das tenant_id auf fremden Tenant setzt, wird blockiert", async () => {
  const { db } = await setup();
  await insertCall(db, "c_update", TENANT_A); // als Superuser anlegen
  await assert.rejects(
    () =>
      asAppRole(db, TENANT_A, () =>
        db.query(`UPDATE call SET tenant_id = $1 WHERE id = 'c_update'`, [TENANT_B]),
      ),
    RLS_ERROR,
  );
});

// T5: UPDATE der eigenen Zeile ohne tenant_id-Aenderung bleibt erlaubt (Gegenprobe).
test("WITH CHECK: UPDATE eigener Zeile ohne tenant_id-Aenderung passiert RLS", async () => {
  const { db } = await setup();
  await insertCall(db, "c_update2", TENANT_A); // als Superuser anlegen
  await asAppRole(db, TENANT_A, () =>
    db.query(`UPDATE call SET status = 'completed' WHERE id = 'c_update2'`),
  );
  const status = (await db.query(`SELECT status FROM call WHERE id = 'c_update2'`)).rows[0].status;
  assert.equal(status, "completed", "legitimes Update wurde uebernommen");
});

// T6 (AC2): Schema bleibt idempotent - applySchema zweimal wirft keinen Fehler.
test("Schema-Idempotenz: applySchema zweimal aufrufen wirft keinen Fehler", async () => {
  const db = new PGlite();
  const conn = { query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) };
  await applySchema(conn);
  await applySchema(conn);
  assert.ok(true, "zweiter applySchema-Aufruf ohne Fehler");
});
