import assert from "node:assert/strict";
import { test } from "node:test";

import { startServerExpectExit } from "../helpers.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { mitGestartetemHermes, pgStartUmgebung } from "./pg-start-umgebung.js";

const ZEITGRENZE_MS = 90_000;
const EXIT_BEI_FEHLER = 1;
const DEPLOY_TOKEN = { HERMES_DEPLOY_TOKEN: "s2-migrationen-neustart-deploy-token-mindestens-32" };
const INDEX_NAME = "account_email_idx";
const ERSTE_MIGRATION = 1;

const starten = (adresse) => mitGestartetemHermes(adresse, DEPLOY_TOKEN, async () => {});

async function einmalGestartet(t) {
  const db = await echteDatenbank(t);
  if (!db) return null;
  await starten(db.adresse);
  return { db, verbindung: await db.verbinden() };
}

async function anzahl(verbindung, abfrage, parameter = []) {
  const { rows } = await verbindung.query(abfrage, parameter);
  return rows.length;
}

const indexVorhanden = async (verbindung) =>
  (await anzahl(verbindung, "SELECT 1 FROM pg_indexes WHERE indexname = $1", [INDEX_NAME])) === 1;

test(
  "S2: nach einem Start und von Hand entferntem account_email_idx legt der zweite Start ihn nicht neu an",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const gestartet = await einmalGestartet(t);
    if (!gestartet) return;
    const { db, verbindung } = gestartet;
    assert.equal(await indexVorhanden(verbindung), true);
    await verbindung.query(`DROP INDEX ${INDEX_NAME}`);

    await starten(db.adresse);

    assert.equal(
      await indexVorhanden(verbindung),
      false,
      `${INDEX_NAME} darf nach dem zweiten Start nicht wieder da sein`,
    );
  },
);

test(
  "[NIE1] Nachzug läuft beim zweiten Start weiter: Groß-E-Mail eines Kontos wird klein",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const gestartet = await einmalGestartet(t);
    if (!gestartet) return;
    const { db, verbindung } = gestartet;
    await verbindung.query(
      "INSERT INTO account (sub, email, tenant_id) VALUES ('konto-grossschreibung', 'Gross@Beispiel.Test', 'owner')",
    );

    await starten(db.adresse);

    const { rows } = await verbindung.query(
      "SELECT email FROM account WHERE sub = 'konto-grossschreibung'",
    );
    assert.equal(rows[0].email, "gross@beispiel.test");
  },
);

test(
  "S2: scheitert eine nicht eingetragene Migration, bricht der Start mit Exit 1 und dem Postgres-Fehler ab und trägt sie nicht ein",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const gestartet = await einmalGestartet(t);
    if (!gestartet) return;
    const { db, verbindung } = gestartet;
    await verbindung.query("DELETE FROM schema_migrations WHERE version = $1", [ERSTE_MIGRATION]);
    await verbindung.query("ALTER TABLE cookie_consent_log DROP COLUMN at");

    const ergebnis = await startServerExpectExit({
      env: pgStartUmgebung(db.adresse, DEPLOY_TOKEN),
      timeoutMs: ZEITGRENZE_MS,
    });

    assert.equal(ergebnis.code, EXIT_BEI_FEHLER);
    assert.match(ergebnis.output, /column "at" does not exist/);
    assert.equal(
      await anzahl(verbindung, "SELECT 1 FROM schema_migrations WHERE version = $1", [
        ERSTE_MIGRATION,
      ]),
      0,
    );
  },
);

const startMitAbbruch = (db) =>
  startServerExpectExit({
    env: pgStartUmgebung(db.adresse, DEPLOY_TOKEN),
    timeoutMs: ZEITGRENZE_MS,
  });

test(
  "S2: scheitert die Eintragung einer Migration, wird ihre Änderung zurückgerollt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const gestartet = await einmalGestartet(t);
    if (!gestartet) return;
    const { db, verbindung } = gestartet;
    await verbindung.query(
      `CREATE FUNCTION eintragung_verweigern() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'eintragung verweigert'; END $$`,
    );
    await verbindung.query(
      `CREATE TRIGGER eintragung_verweigern BEFORE INSERT ON schema_migrations
       FOR EACH ROW EXECUTE FUNCTION eintragung_verweigern()`,
    );
    await verbindung.query("DELETE FROM schema_migrations WHERE version = $1", [ERSTE_MIGRATION]);
    await verbindung.query(`DROP INDEX ${INDEX_NAME}`);

    const ergebnis = await startMitAbbruch(db);

    assert.equal(ergebnis.code, EXIT_BEI_FEHLER);
    assert.equal(await indexVorhanden(verbindung), false);
    assert.equal(
      await anzahl(verbindung, "SELECT 1 FROM schema_migrations WHERE version = $1", [
        ERSTE_MIGRATION,
      ]),
      0,
    );
  },
);
