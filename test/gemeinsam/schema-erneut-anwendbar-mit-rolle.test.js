import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const ROLLE = "kennzahlen_leser";
const TRIGGER = "number_platform_binding_guard";
const HTTP_OK = 200;
const RECHTE = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
});

async function mandantentabellen(client) {
  const { rows } = await client.query(`SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
  return rows.map((zeile) => zeile.name);
}

async function triggerVorhanden(client) {
  const { rows } = await client.query("SELECT count(*)::int AS anzahl FROM pg_trigger WHERE tgname = $1", [TRIGGER]);
  return rows[0].anzahl;
}

test("Testhilfe-Rolle: Hermes startet mit vorhandener Rolle, das Schema ist erneut anwendbar, die Rolle hat danach keine Rechte auf Mandantentabellen", async () => {
  const hermes = laufendesHermes();
  assert.equal((await hermes.anfrage("/healthz")).status, HTTP_OK, "der Start mit vorhandener Rolle ist grün");

  const client = hermes.neuerClient();
  await client.connect();
  const vorhanden = await client.query("SELECT rolname FROM pg_roles WHERE rolname = $1", [ROLLE]);
  assert.deepEqual(vorhanden.rows, [{ rolname: ROLLE }], "der Lauf-Client erreicht dieselbe Testdatenbank und sieht die Rolle");

  const rechte = await client.query(`SELECT has_database_privilege('kv2_app', current_database(), 'CREATE') AS datenbank_anlegen,
      (SELECT m.admin_option FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid AND r.rolname = $1
         JOIN pg_roles g ON g.oid = m.member AND g.rolname = 'kv2_app') AS rollen_admin`, [ROLLE]);
  assert.deepEqual(rechte.rows, [{ datenbank_anlegen: true, rollen_admin: true }], "die App-Rolle darf in der Datenbank anlegen und verwaltet die Rolle");

  await hermes.db.exec(`DROP TRIGGER ${TRIGGER} ON number`);
  assert.equal(await triggerVorhanden(client), 0, "Vorbedingung: der vom Schema angelegte Trigger fehlt");
  await hermes.db.exec("DELETE FROM schema_migrations");
  await hermes.schemaErneutAnwenden();
  assert.equal(await triggerVorhanden(client), 1, "das erneut angewendete Schema legt den Trigger wieder an");

  const tabellen = await mandantentabellen(client);
  assert.ok(tabellen.length > 0, "es gibt Mandantentabellen, die geprüft werden");
  const offen = [];
  for (const tabelle of tabellen) {
    for (const recht of RECHTE) {
      const { rows } = await client.query("SELECT has_table_privilege($1, $2, $3) AS hat", [ROLLE, `public.${tabelle}`, recht]);
      if (rows[0].hat) offen.push(`${tabelle}:${recht}`);
    }
  }
  assert.deepEqual(offen, [], "die Rolle hat kein Recht auf eine Mandantentabelle");
  await client.end();
});
