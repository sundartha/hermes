import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser, schemaErneutAnwenden } from "../pg-helpers.js";

const GROSSZUEGIGE_FRIST_MS = 60_000;
const MANDANTEN_ZAHL = 500;
const MIT_AUFTRAG = ["t_offen_0", "t_offen_250", "t_offen_499"];

function zaehlenderRunner(db, befehle) {
  return {
    withClient: (arbeit) =>
      arbeit({
        query: async (text, werte) => {
          befehle.push(text);
          return db.query(text, werte);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

const kontext = (db, mandant) => db.query("SELECT set_config('app.current_tenant', $1, false)", [mandant]);

async function mandantenAnlegen(db, anzahl) {
  for (let nr = 0; nr < anzahl; nr += 1) {
    const id = `t_offen_${nr}`;
    await kontext(db, id);
    await db.query("INSERT INTO tenant (id, status, idp_subject, country) VALUES ($1, 'active', $1, 'US')", [id]);
  }
}

async function auftragAnlegen(db, mandant, { status = "queued", instanz = null } = {}) {
  await kontext(db, mandant);
  await db.query("INSERT INTO number (id, tenant_id, provider, status) VALUES ($1, $2, 'telnyx', 'requested')", [`num_${mandant}`, mandant]);
  await db.query(
    `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, instanz)
     VALUES ($1, $2, $3, 'provision_number', $4, $5, $6)`,
    [`job_${mandant}`, mandant, `num_${mandant}`, status, `key_${mandant}`, instanz],
  );
}

async function aufbau(anzahl = MANDANTEN_ZAHL) {
  const db = await pgliteAlsRolleOhneSuperuser();
  const befehle = [];
  const store = makePgStore(zaehlenderRunner(db, befehle), { einstellungenFristMs: GROSSZUEGIGE_FRIST_MS });
  await store.init();
  await mandantenAnlegen(db, anzahl);
  return { db, befehle, sql: store.nummernSql() };
}

const transaktionen = (befehle) => befehle.filter((text) => text === "BEGIN").length;

test("Abgleich ohne offenen Auftrag setzt hoechstens eine Abfrage ab, auch bei 500 Mandanten", async () => {
  const { befehle, sql } = await aufbau();
  befehle.length = 0;
  assert.deepEqual(await sql.offene(), []);
  assert.ok(befehle.length <= 1, befehle.join("|"));
  assert.equal(transaktionen(befehle), 0);
});

test("drei offene Auftraege in 500 Mandanten kosten genau drei Transaktionen und werden mit Nummer und Instanz geliefert", async () => {
  const { db, befehle, sql } = await aufbau();
  for (const mandant of MIT_AUFTRAG) await auftragAnlegen(db, mandant, { instanz: "inst_b" });
  befehle.length = 0;
  const offene = await sql.offene();
  assert.equal(transaktionen(befehle), 3);
  assert.deepEqual(offene.map((eintrag) => eintrag.job.tenantId).sort(), [...MIT_AUFTRAG].sort());
  for (const eintrag of offene) {
    assert.equal(eintrag.job.status, "queued");
    assert.equal(eintrag.instanz, "inst_b");
    assert.equal(eintrag.nummer.id, `num_${eintrag.job.tenantId}`);
  }
});

test("ein offener Auftrag der Instanz B bleibt fuer Instanz A sichtbar", async () => {
  const { db, sql } = await aufbau(2);
  await auftragAnlegen(db, "t_offen_1", { instanz: "inst_b" });
  const offene = await sql.offene();
  assert.deepEqual(offene.map((eintrag) => [eintrag.job.id, eintrag.instanz]), [["job_t_offen_1", "inst_b"]]);
});

test("wechselt ein Auftrag von queued auf einen anderen Status, wird er nicht mehr geliefert und kostet keine Transaktion", async () => {
  const { db, befehle, sql } = await aufbau(3);
  await auftragAnlegen(db, "t_offen_1");
  assert.equal((await sql.offene()).length, 1);
  await kontext(db, "t_offen_1");
  await db.query("UPDATE provisioning_job SET status = 'done' WHERE id = 'job_t_offen_1'");
  befehle.length = 0;
  assert.deepEqual(await sql.offene(), []);
  assert.equal(transaktionen(befehle), 0);
  await db.query("UPDATE provisioning_job SET status = 'queued' WHERE id = 'job_t_offen_1'");
  assert.equal((await sql.offene()).length, 1);
  await db.query("DELETE FROM provisioning_job WHERE id = 'job_t_offen_1'");
  assert.deepEqual(await sql.offene(), []);
});

test("Das Verzeichnis der offenen Auftraege hat nur Auftrags- und Mandanten-Id und ist unter fremdem Kontext nicht der Auftragsinhalt", async () => {
  const { db } = await aufbau(2);
  await auftragAnlegen(db, "t_offen_1");
  await kontext(db, "t_offen_0");
  assert.deepEqual((await db.query("SELECT id FROM provisioning_job")).rows, []);
  const spalten = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'offener_auftrag_schluessel' ORDER BY column_name");
  assert.deepEqual(spalten.rows.map((zeile) => zeile.column_name), ["job_id", "tenant_id"]);
});

test("Auftraege, die schon vor der Migration offen waren, stehen danach im Verzeichnis", async () => {
  const { db, sql } = await aufbau(3);
  await auftragAnlegen(db, "t_offen_2");
  await db.exec("DELETE FROM offener_auftrag_schluessel");
  assert.deepEqual(await sql.offene(), []);
  await db.exec("DELETE FROM schema_migrations WHERE version = 35");
  await schemaErneutAnwenden(db);
  assert.deepEqual((await sql.offene()).map((eintrag) => eintrag.job.id), ["job_t_offen_2"]);
});
