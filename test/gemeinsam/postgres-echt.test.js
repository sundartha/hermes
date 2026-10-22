import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { ROOT } from "../helpers.js";
import { echteDatenbank, hauptversionLautSquawk, POSTGRES_VARIABLE } from "./echtes-postgres.js";

const SPEICHERSTART = 'await import("./src/store.js"); process.exit(0);';
const MIGRATIONSKOPF = "SET LOCAL lock_timeout = '2s';\nSET LOCAL statement_timeout = '30s';\n";
const SPERRE_ABGELAUFEN = "55P03";
const ABFRAGE_ABGEBROCHEN = "57014";
const SPERRZEIT_MS = 2000;
const KURZE_ABFRAGEZEIT_MS = 200;
const ABBRUCH_SPAETESTENS_MS = 5000;
const FRUEHESTENS_ANTEIL = 0.9;
const ZEITGRENZE_MS = 15_000;
const VERSIONSTEILER = 10_000;
const NICHT_ERREICHBAR = "postgres://postgres@127.0.0.1:1/postgres";
const KONTEXT_OHNE_WIRKUNG = { diagnostic: () => undefined, skip: () => undefined, after: () => undefined };

function speicherStarten(adresse) {
  const umgebung = { PATH: process.env.PATH, NODE_ENV: "test", STORE_BACKEND: "pg", DATABASE_URL: adresse };
  execFileSync(process.execPath, ["--input-type=module", "-e", SPEICHERSTART], {
    cwd: ROOT,
    env: umgebung,
    encoding: "utf8",
    timeout: ZEITGRENZE_MS,
  });
}

async function dauerBisAbbruch(abfrage, code) {
  const beginn = performance.now();
  await assert.rejects(abfrage, { code });
  return performance.now() - beginn;
}

test("Echtes Postgres: Hauptversion wie in tools/basis/squawk.toml, der Speicher startet zweimal auf derselben Datenbank", { timeout: ZEITGRENZE_MS * 2 }, async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const verbindung = await db.verbinden();
  const { rows } = await verbindung.query("SHOW server_version_num");
  assert.equal(Math.floor(Number(rows[0].server_version_num) / VERSIONSTEILER), hauptversionLautSquawk());
  speicherStarten(db.adresse);
  speicherStarten(db.adresse);
  const tabellen = await verbindung.query("SELECT count(*)::int AS anzahl FROM pg_tables WHERE schemaname = 'public'");
  assert.ok(tabellen.rows[0].anzahl > 0);
});

test("Echtes Postgres: lock_timeout aus dem Migrationskopf bricht ab, solange eine zweite Verbindung die Tabelle sperrt", { timeout: ZEITGRENZE_MS }, async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const halter = await db.verbinden();
  const wartender = await db.verbinden();
  await halter.query("CREATE TABLE sperrprobe (id int)");
  await halter.query("BEGIN");
  await halter.query("LOCK TABLE sperrprobe IN ACCESS EXCLUSIVE MODE");
  await wartender.query("BEGIN");
  await wartender.query(MIGRATIONSKOPF);
  const dauer = await dauerBisAbbruch(wartender.query("ALTER TABLE sperrprobe ADD COLUMN neu int"), SPERRE_ABGELAUFEN);
  assert.ok(dauer >= SPERRZEIT_MS * FRUEHESTENS_ANTEIL, `abgebrochen nach ${Math.round(dauer)} ms`);
  await wartender.query("ROLLBACK");
  await halter.query("ROLLBACK");
});

test("Echtes Postgres: statement_timeout bricht eine laufende Abfrage wirklich ab", { timeout: ZEITGRENZE_MS }, async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const verbindung = await db.verbinden();
  await verbindung.query("BEGIN");
  await verbindung.query(`SET LOCAL statement_timeout = '${KURZE_ABFRAGEZEIT_MS}ms'`);
  const dauer = await dauerBisAbbruch(verbindung.query("SELECT pg_sleep(30)"), ABFRAGE_ABGEBROCHEN);
  assert.ok(dauer < ABBRUCH_SPAETESTENS_MS, `abgebrochen nach ${Math.round(dauer)} ms`);
  await verbindung.query("ROLLBACK");
});

test("Echtes Postgres: ist die Adresse in der Umgebung gesetzt, aber nicht erreichbar, scheitert der Test statt zu überspringen", async () => {
  const vorher = process.env[POSTGRES_VARIABLE];
  process.env[POSTGRES_VARIABLE] = NICHT_ERREICHBAR;
  try {
    await assert.rejects(echteDatenbank(KONTEXT_OHNE_WIRKUNG), { code: "ECONNREFUSED" });
  } finally {
    if (vorher === undefined) delete process.env[POSTGRES_VARIABLE];
    else process.env[POSTGRES_VARIABLE] = vorher;
  }
});
