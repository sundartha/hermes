import assert from "node:assert/strict";
import { test } from "node:test";

import { migrate } from "../../src/db/migrate.js";
import { startServerExpectExit } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank } from "./echtes-postgres.js";
import { mitGestartetemHermes, pgStartUmgebung } from "./pg-start-umgebung.js";

const HTTP_OK = 200;
const EXIT_NACH_ABBRUCH = 1;
const START_FRIST_MS = 90_000;
const TOKEN = { HERMES_DEPLOY_TOKEN: "s5-abgleich-deploy-token-mindestens-32-zeichen" };
const FALSCHE_PRUEFSUMME = "0".repeat(64);
const ERSTE_DATEI = "0001_ausgang.sql";
const ZWEITE_DATEI = "0002_versionstabelle.sql";
const VERWAISTER_NAME = "0009_spaeter";
const NUMMER_ZWEI = 2;
const NUMMER_NEUN = 9;

function gestartet(adresse) {
  return mitGestartetemHermes(adresse, TOKEN, async () => {});
}

function startVersuch(adresse) {
  return startServerExpectExit({
    env: pgStartUmgebung(adresse, TOKEN),
    timeoutMs: START_FRIST_MS,
  });
}

function abbruchBeiTabellenanlage(verbindung) {
  return verbindung.query(`
    CREATE FUNCTION s6_abbruch() RETURNS event_trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'S6 Testabbruch'; END $$;
    CREATE EVENT TRIGGER s6_abbruch ON ddl_command_start
      WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION s6_abbruch();`);
}

async function pgliteMitVerbundenerMigration() {
  const { db } = await makePgTestStore();
  return db;
}

function ausfuehrungVonDateiAbbrechen(db, dateiText) {
  return {
    query: (text, params) => db.query(text, params),
    exec: (sql) => (sql === dateiText ? Promise.reject(new Error("S6 Testabbruch")) : db.exec(sql)),
  };
}

test(
  "S5: weicht die Prüfsumme einer eingetragenen Migration ab, endet der Start mit Exit 1 und nennt 0001_ausgang.sql",
  { timeout: START_FRIST_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    await gestartet(db.adresse);
    const verbindung = await db.verbinden();
    await verbindung.query("UPDATE schema_migrations SET checksum = $1 WHERE version = 1", [
      FALSCHE_PRUEFSUMME,
    ]);

    const ergebnis = await startVersuch(db.adresse);

    assert.equal(ergebnis.code, EXIT_NACH_ABBRUCH);
    assert.ok(ergebnis.output.includes(ERSTE_DATEI), ergebnis.output);
  },
);

test(
  "S6: scheitert 0002, endet der Start mit Exit 1, nennt 0002_versionstabelle.sql und trägt Nummer 2 nicht ein",
  { timeout: START_FRIST_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    await gestartet(db.adresse);
    const verbindung = await db.verbinden();
    await verbindung.query("DELETE FROM schema_migrations WHERE version = $1", [NUMMER_ZWEI]);
    await abbruchBeiTabellenanlage(verbindung);

    const ergebnis = await startVersuch(db.adresse);

    assert.equal(ergebnis.code, EXIT_NACH_ABBRUCH);
    assert.ok(ergebnis.output.includes(ZWEITE_DATEI), ergebnis.output);
    const { rows } = await verbindung.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
      NUMMER_ZWEI,
    ]);
    assert.equal(rows.length, 0);
  },
);

test(
  "S7: ein Eintrag ohne Datei bricht den Start nicht ab, /healthz antwortet 200 und das Log nennt ihn",
  { timeout: START_FRIST_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    await gestartet(db.adresse);
    const verbindung = await db.verbinden();
    await verbindung.query("UPDATE schema_migrations SET name = $1 WHERE version = $2", [
      VERWAISTER_NAME,
      NUMMER_NEUN,
    ]);

    const [status, log] = await mitGestartetemHermes(db.adresse, TOKEN, async (prozess) => [
      (await abrufMitFrist(`${prozess.localUrl}/healthz`)).status,
      prozess.stdout,
    ]);

    assert.equal(status, HTTP_OK);
    assert.ok(log.includes(VERWAISTER_NAME), log);
  },
);

test("S5 (ohne echtes Postgres): abweichende Prüfsumme bricht migrate ab und nennt 0001_ausgang.sql", async () => {
  const db = await pgliteMitVerbundenerMigration();
  await db.query("UPDATE schema_migrations SET checksum = $1 WHERE version = 1", [
    FALSCHE_PRUEFSUMME,
  ]);
  await assert.rejects(migrate(db, BOOTSTRAP_TENANT_ID), /0001_ausgang\.sql/);
});

test("S5 (ohne echtes Postgres): passende Prüfsummen lassen migrate durchlaufen", async () => {
  const db = await pgliteMitVerbundenerMigration();
  await migrate(db, BOOTSTRAP_TENANT_ID);
  const { rows } = await db.query("SELECT count(*)::int AS anzahl FROM schema_migrations");
  assert.equal(rows[0].anzahl, 12);
});

test("S6 (ohne echtes Postgres): scheitert 0002, nennt migrate die Datei und lässt Nummer 2 ungeschrieben", async () => {
  const db = await pgliteMitVerbundenerMigration();
  await db.query("DELETE FROM schema_migrations WHERE version = $1", [NUMMER_ZWEI]);
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(
    new URL(`../../src/db/migrations/${ZWEITE_DATEI}`, import.meta.url),
    "utf8",
  );

  await assert.rejects(
    migrate(ausfuehrungVonDateiAbbrechen(db, text), BOOTSTRAP_TENANT_ID),
    /Migration fehlgeschlagen \(0002_versionstabelle\.sql\): S6 Testabbruch/,
  );

  const { rows } = await db.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
    NUMMER_ZWEI,
  ]);
  assert.equal(rows.length, 0);
});

test("S7 (ohne echtes Postgres): ein Eintrag ohne Datei wird im Log genannt und bricht migrate nicht ab", async (t) => {
  const db = await pgliteMitVerbundenerMigration();
  await db.query("UPDATE schema_migrations SET name = $1 WHERE version = $2", [
    VERWAISTER_NAME,
    NUMMER_NEUN,
  ]);
  const log = t.mock.method(console, "log", () => {});

  await migrate(db, BOOTSTRAP_TENANT_ID);

  const zeilen = log.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
  assert.ok(zeilen.some((zeile) => zeile.includes(VERWAISTER_NAME)));
});
