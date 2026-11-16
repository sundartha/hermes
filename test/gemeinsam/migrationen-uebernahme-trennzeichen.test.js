import { test } from "node:test";
import assert from "node:assert/strict";

import { startServer, startServerExpectExit } from "../helpers.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { pgStartUmgebung } from "./pg-start-umgebung.js";

const START_FRIST_MS = 90_000;
const EXIT_NACH_ABBRUCH = 1;
const TOKEN = { HERMES_DEPLOY_TOKEN: "s1db-trennzeichen-deploy-token-mindestens-32" };
const ERSTE_ZWEITE = "0001_ausgang.sql, 0002_versionstabelle.sql";

test(
  "scheitert die Übernahme, trennt die Meldung die Migrationsdateien mit Komma und Leerzeichen",
  { timeout: START_FRIST_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const verbindung = await db.verbinden();
    await verbindung.query("CREATE TYPE schema_migrations AS ENUM ('kein_tabellenname')");

    const ergebnis = await startServerExpectExit({
      env: pgStartUmgebung(db.adresse, TOKEN),
      timeoutMs: START_FRIST_MS,
    });

    assert.equal(ergebnis.code, EXIT_NACH_ABBRUCH);
    assert.ok(
      ergebnis.output.includes(ERSTE_ZWEITE),
      `Meldung muss "${ERSTE_ZWEITE}" enthalten:\n${ergebnis.output}`,
    );
  },
);

test(
  "nach der Übernahme hat schema_migrations version BIGINT Primärschlüssel, name und checksum TEXT NOT NULL",
  { timeout: START_FRIST_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    await (await startServer({ env: pgStartUmgebung(db.adresse, TOKEN) })).stop();
    const verbindung = await db.verbinden();

    const { rows } = await verbindung.query(
      `SELECT c.column_name, c.data_type, c.is_nullable,
              EXISTS (
                SELECT 1 FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                WHERE i.indrelid = 'schema_migrations'::regclass
                  AND i.indisprimary AND a.attname = c.column_name
              ) AS primaer
       FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'schema_migrations'
       ORDER BY c.column_name`,
    );

    assert.deepEqual(rows, [
      { column_name: "checksum", data_type: "text", is_nullable: "NO", primaer: false },
      { column_name: "name", data_type: "text", is_nullable: "NO", primaer: false },
      { column_name: "version", data_type: "bigint", is_nullable: "NO", primaer: true },
    ]);
  },
);
