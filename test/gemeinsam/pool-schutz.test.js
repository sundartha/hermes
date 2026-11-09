import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";

import express from "express";
import pg from "pg";

import {
  flushAnfang,
  hauptPoolOptionen,
  POOL_GRENZEN,
  poolFehlerZeile,
  portalPoolOptionen,
} from "../../src/utils/pg-pool.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { ROOT } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";
import { neuePglite } from "../pglite-helfer.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { fehlerausgabeVon } from "./fehlerausgabe.js";
import { webLoginBasisKonfiguration } from "./web-login-konfiguration.js";

const KURZE_FRIST_MS = 30;
const ZEITGRENZE_MS = 5000;
const KINDPROZESS_GRENZE_MS = 20_000;
const ABFRAGE_ABGEBROCHEN = "57014";
const ABBRUCH_SPAETESTENS_MS = 4000;
const UNERREICHBAR = "postgres://postgres@127.0.0.1:1/postgres";
const FLUSH_FRIST_ALS_TEXT = "2min";
const STANDARD_FRIST_ALS_TEXT = "30s";
const START_FRIST_ALS_TEXT = "5min";

class VerbindungOhneNetz extends EventEmitter {
  connect(fertig) {
    process.nextTick(fertig);
  }

  isConnected() {
    return true;
  }

  query() {
    return Promise.resolve({ rows: [] });
  }

  end(fertig) {
    if (fertig) process.nextTick(fertig);
  }
}

function eineRundeDerEreignisschleife() {
  return new Promise((fertig) => {
    setImmediate(fertig);
  });
}

function speicherMitKindprozess(adresse, skript) {
  const umgebung = kindUmgebung({ NODE_ENV: "test", STORE_BACKEND: "pg", DATABASE_URL: adresse });
  return execFileSync(process.execPath, ["--input-type=module", "-e", skript], {
    cwd: ROOT,
    env: umgebung,
    encoding: "utf8",
    timeout: KINDPROZESS_GRENZE_MS,
  });
}

const FRIST_PROTOKOLL = `
import pg from "pg";
const speicher = await import("./src/store.js");
const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
await probe.connect();
await probe.query("CREATE TABLE frist_protokoll (frist text)");
await probe.query("CREATE FUNCTION frist_merken() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO frist_protokoll VALUES (current_setting('statement_timeout')); RETURN NEW; END $$");
await probe.query("CREATE TRIGGER frist_merken AFTER INSERT OR UPDATE ON tenant FOR EACH ROW EXECUTE FUNCTION frist_merken()");
await speicher.save();
await speicher.drainFlushes();
const { rows } = await probe.query("SELECT frist FROM frist_protokoll");
process.stdout.write(JSON.stringify(rows.map((zeile) => zeile.frist)));
process.exit(0);
`;

const START_FRIST_PROTOKOLL = `
import pg from "pg";
await import("./src/store.js");
const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
await probe.connect();
await probe.query("CREATE TABLE frist_protokoll (frist text)");
await probe.query("CREATE FUNCTION frist_merken() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO frist_protokoll VALUES (current_setting('statement_timeout')); RETURN NEW; END $$");
await probe.query("CREATE TRIGGER frist_merken BEFORE INSERT OR UPDATE ON tenant FOR EACH ROW EXECUTE FUNCTION frist_merken()");
await import("./src/store.js?zweiter-start");
const { rows } = await probe.query("SELECT frist FROM frist_protokoll");
process.stdout.write(JSON.stringify(rows.map((zeile) => zeile.frist)));
process.exit(0);
`;

const VERBINDUNGSABBRUCH = `
import pg from "pg";
const ausgabe = console.error;
const gemeldet = new Promise((fertig) => {
  console.error = (...teile) => {
    ausgabe(...teile);
    fertig(String(teile[0]));
  };
});
await import("./src/store.js");
const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
await probe.connect();
await probe.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()");
process.stdout.write(await gemeldet);
process.exit(0);
`;

test("Pool-Schutz: ein erschöpfter Pool meldet nach der Verbindungsfrist einen Fehler statt zu hängen", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pool = new pg.Pool(hauptPoolOptionen(UNERREICHBAR, { Client: VerbindungOhneNetz, max: 1 }));
  const halter = await pool.connect();
  let ausgang = "offen";
  pool.connect().then(
    () => {
      ausgang = "bekommen";
    },
    (fehler) => {
      ausgang = fehler.message;
    },
  );
  try {
    t.mock.timers.tick(POOL_GRENZEN.connectionTimeoutMillis - 1);
    await eineRundeDerEreignisschleife();
    assert.equal(ausgang, "offen");
    t.mock.timers.tick(1);
    await eineRundeDerEreignisschleife();
    assert.match(ausgang, /timeout exceeded when trying to connect/);
  } finally {
    halter.release();
    await pool.end();
  }
});

test("Pool-Schutz: Haupt- und Portal-Pool tragen Verbindungsfrist, Abfragefrist und Höchstzahl aus den Pool-Grenzen", () => {
  const haupt = hauptPoolOptionen(UNERREICHBAR);
  const portal = portalPoolOptionen(UNERREICHBAR);
  assert.equal(haupt.max, POOL_GRENZEN.maxHaupt);
  assert.equal(portal.max, POOL_GRENZEN.maxPortal);
  for (const optionen of [haupt, portal]) {
    assert.equal(optionen.connectionString, UNERREICHBAR);
    assert.equal(optionen.connectionTimeoutMillis, POOL_GRENZEN.connectionTimeoutMillis);
    assert.equal(optionen.statement_timeout, POOL_GRENZEN.statementTimeoutMs);
  }
});

test("Pool-Schutz: die Fehlerzeile eines Pools nennt den Poolnamen und die Ursache", () => {
  assert.equal(
    poolFehlerZeile("haupt", new Error("Verbindung gekappt")),
    "[pool:haupt] Verbindung im Leerlauf verloren: Verbindung gekappt",
  );
  assert.equal(
    poolFehlerZeile("portal", new Error("Server beendet")),
    "[pool:portal] Verbindung im Leerlauf verloren: Server beendet",
  );
});

test("Pool-Schutz: Verbindungsbudget, (Instanzen + 1 beim Deploy) mal alle Pools einschließlich Warteschlange bleibt höchstens 80", () => {
  const jeInstanz = POOL_GRENZEN.maxHaupt + POOL_GRENZEN.maxPortal + POOL_GRENZEN.maxWarteschlange;
  const beimDeploy = POOL_GRENZEN.instanzen + POOL_GRENZEN.zusatzInstanzenBeimDeploy;
  assert.equal(POOL_GRENZEN.datenbankBudget, 80);
  assert.ok(beimDeploy * jeInstanz <= POOL_GRENZEN.datenbankBudget, `${beimDeploy} x ${jeInstanz}`);
});

test("Pool-Schutz: der Flush beginnt mit BEGIN und hebt statement_timeout danach nur lokal auf die Flush-Frist an", () => {
  const [beginn, frist] = flushAnfang();
  assert.equal(beginn.text, "BEGIN");
  assert.deepEqual(beginn.params, []);
  assert.match(frist.text, /^SELECT set_config\('statement_timeout', \$1, true\)$/);
  assert.deepEqual(frist.params, [String(POOL_GRENZEN.flushStatementTimeoutMs)]);
  assert.ok(POOL_GRENZEN.flushStatementTimeoutMs > POOL_GRENZEN.statementTimeoutMs);
});

test("Pool-Schutz: die Startfrist hebt die Abfragefrist der Sitzung an und gibt sie danach zurück", async () => {
  const { startFrist } = await import("../../src/utils/pg-pool.js");
  const { anheben, zuruecksetzen } = startFrist();
  for (const anweisung of [anheben, zuruecksetzen]) {
    assert.match(anweisung.text, /^SELECT set_config\('statement_timeout', \$1, false\)$/);
  }
  assert.deepEqual(anheben.params, [String(POOL_GRENZEN.startStatementTimeoutMs)]);
  assert.deepEqual(zuruecksetzen.params, [String(POOL_GRENZEN.statementTimeoutMs)]);
  assert.ok(POOL_GRENZEN.startStatementTimeoutMs > POOL_GRENZEN.statementTimeoutMs);
});

test("Echtes Postgres: Migration und Laden beim Start laufen mit der Startfrist von fünf Minuten statt der Abfragefrist", { timeout: KINDPROZESS_GRENZE_MS * 2 }, async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const fristen = JSON.parse(speicherMitKindprozess(db.adresse, START_FRIST_PROTOKOLL));
  assert.ok(fristen.length > 0);
  assert.deepEqual([...new Set(fristen)], [START_FRIST_ALS_TEXT]);
});

test("Echtes Postgres: jedes Schreiben im Flush des Speichers läuft mit der Flush-Frist von zwei Minuten", { timeout: KINDPROZESS_GRENZE_MS * 2 }, async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const fristen = JSON.parse(speicherMitKindprozess(db.adresse, FRIST_PROTOKOLL));
  assert.ok(fristen.length > 0);
  assert.deepEqual([...new Set(fristen)], [FLUSH_FRIST_ALS_TEXT]);
});

test("Pool-Schutz: ein Fehler einer Leerlauf-Verbindung wird mit Poolname protokolliert und wirft nicht", { timeout: KINDPROZESS_GRENZE_MS * 2 }, async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const meldung = speicherMitKindprozess(db.adresse, VERBINDUNGSABBRUCH);
  assert.match(meldung, /^\[pool:haupt\] Verbindung im Leerlauf verloren: /);
});

test("Echtes Postgres: eine Verbindung aus dem Pool trägt die Abfragefrist, und eine zu lange Abfrage wird abgebrochen", { timeout: ZEITGRENZE_MS * 2 }, async (t) => {
  const db = await echteDatenbank(t);
  if (!db) return;
  const standard = new pg.Pool(hauptPoolOptionen(db.adresse));
  const kurz = new pg.Pool(hauptPoolOptionen(db.adresse, { statement_timeout: KURZE_FRIST_MS }));
  for (const pool of [standard, kurz]) pool.on("error", () => undefined);
  try {
    const gesetzt = await standard.query("SHOW statement_timeout");
    assert.equal(gesetzt.rows[0].statement_timeout, STANDARD_FRIST_ALS_TEXT);
    const beginn = performance.now();
    await assert.rejects(kurz.query("SELECT pg_sleep(30)"), { code: ABFRAGE_ABGEBROCHEN });
    assert.ok(performance.now() - beginn < ABBRUCH_SPAETESTENS_MS);
  } finally {
    await Promise.all([standard.end(), kurz.end()]);
  }
});

const VERLUST_URSACHE = "terminating connection";
const WARTENDE_ANFRAGEN = 3;
const OFFENE_VERBINDUNGEN = 7;

class PortalPoolAttrappe extends EventEmitter {
  static angelegt = [];

  constructor(optionen) {
    super();
    this.optionen = optionen;
    PortalPoolAttrappe.angelegt.push(this);
  }

  async connect() {
    return {
      query: async () => ({ rows: [{ is_su: "off", rolbypassrls: false }] }),
      release: () => {},
    };
  }

  async end() {}
}

async function mitErsetztemPool(ersetzen, aufgabe) {
  const echterPool = pg.Pool;
  const angelegt = ersetzen();
  try {
    await aufgabe();
  } finally {
    pg.Pool = echterPool;
  }
  return angelegt;
}

async function hauptPoolUeberSpeicher() {
  const db = await neuePglite();
  let speicher;
  const angelegt = await mitErsetztemPool(
    () => poolAufPglite(db),
    async () => {
      process.env.STORE_BACKEND = "pg";
      process.env.DATABASE_URL = UNERREICHBAR;
      speicher = await import("../../src/store.js");
    },
  );
  return { speicher, angelegt };
}

async function portalPoolUeberWebLogin() {
  const { speicher } = await speicherOhnePostgres();
  const { wireWebLogin } = await import("../../src/wiring/web-login.js");
  return mitErsetztemPool(
    () => {
      pg.Pool = PortalPoolAttrappe;
      return PortalPoolAttrappe.angelegt;
    },
    () =>
      wireWebLogin({
        app: express(),
        config: webLoginBasisKonfiguration("https://api.workos.test"),
        store: speicher,
        audit: () => {},
        provision: async () => ({}),
        stripeWebhookPath: "/webhooks/stripe",
        appPath: "/app",
      }),
  );
}

let speicherAufPglite;
function speicherOhnePostgres() {
  speicherAufPglite ??= hauptPoolUeberSpeicher();
  return speicherAufPglite;
}

let portalPools;
function portalPoolsOhnePostgres() {
  portalPools ??= portalPoolUeberWebLogin();
  return portalPools;
}

function verlustZeilen(pool, fehler) {
  return fehlerausgabeVon(() => pool.emit("error", fehler));
}

test("Pool-Schutz ohne Postgres: ein Verlust im Leerlauf nennt bei Haupt- und Portal-Pool den Poolnamen", async () => {
  const [hauptPool] = (await speicherOhnePostgres()).angelegt;
  const [portalPool] = await portalPoolsOhnePostgres();
  const [hauptZeile] = verlustZeilen(hauptPool, new Error(VERLUST_URSACHE));
  const [portalZeile] = verlustZeilen(portalPool, new Error(VERLUST_URSACHE));
  assert.match(hauptZeile ?? "", /^\[pool:haupt\] Verbindung im Leerlauf verloren: /);
  assert.match(portalZeile ?? "", /^\[pool:portal\] Verbindung im Leerlauf verloren: /);
});

test("[NIE1] poolZustand() des pg-Speichers meldet wartend und offen des Haupt-Pools, und der Speicher bietet kein close", async () => {
  const { speicher, angelegt } = await speicherOhnePostgres();
  const [hauptPool] = angelegt;
  hauptPool.waitingCount = WARTENDE_ANFRAGEN;
  hauptPool.totalCount = OFFENE_VERBINDUNGEN;
  try {
    assert.deepEqual(speicher.poolZustand(), { wartend: WARTENDE_ANFRAGEN, offen: OFFENE_VERBINDUNGEN });
  } finally {
    hauptPool.waitingCount = 0;
    hauptPool.totalCount = 0;
  }
  assert.equal(angelegt.length, 1);
  assert.equal("close" in speicher, false);
});

test("[NIE2] ein Verlust im Leerlauf von Haupt- und Portal-Pool wird als genau eine Zeile mit Poolname und Ursache protokolliert und wirft nicht", async () => {
  const [hauptPool] = (await speicherOhnePostgres()).angelegt;
  const [portalPool] = await portalPoolsOhnePostgres();
  for (const [name, pool] of [
    ["haupt", hauptPool],
    ["portal", portalPool],
  ]) {
    let zeilen;
    assert.doesNotThrow(() => {
      zeilen = verlustZeilen(pool, new Error(`${name} beendet`));
    });
    assert.deepEqual(zeilen, [`[pool:${name}] Verbindung im Leerlauf verloren: ${name} beendet`]);
  }
});

test("[NIE3] ohne Postgres werden Haupt-Pool über den Speicher und Portal-Pool über wireWebLogin mit den Pool-Grenzen gebaut und melden einen Fehler als genau eine Zeile poolFehlerZeile", async () => {
  const { angelegt } = await speicherOhnePostgres();
  const portal = await portalPoolsOhnePostgres();
  assert.equal(angelegt.length, 1);
  assert.equal(portal.length, 1);
  const [hauptPool] = angelegt;
  const [portalPool] = portal;
  assert.deepEqual(hauptPool.optionen, hauptPoolOptionen(UNERREICHBAR));
  assert.deepEqual(portalPool.optionen, portalPoolOptionen(UNERREICHBAR));
  const fehler = new Error(VERLUST_URSACHE);
  assert.deepEqual(verlustZeilen(hauptPool, fehler), [poolFehlerZeile("haupt", fehler)]);
  assert.deepEqual(verlustZeilen(portalPool, fehler), [poolFehlerZeile("portal", fehler)]);
});

const FRIST_MERKEN = [
  "CREATE TABLE frist_protokoll (frist text)",
  "CREATE FUNCTION frist_merken() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO frist_protokoll VALUES (current_setting('statement_timeout')); RETURN NEW; END $$",
  "CREATE TRIGGER frist_merken BEFORE INSERT OR UPDATE ON tenant FOR EACH ROW EXECUTE FUNCTION frist_merken()",
];

async function speicherStartenAuf(db, starten) {
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = UNERREICHBAR;
  await mitErsetztemPool(() => poolAufPglite(db), starten);
}

async function fristenBeimStartOhnePostgres() {
  const db = await neuePglite();
  await speicherStartenAuf(db, () => import("../../src/store.js?startfrist-schema"));
  for (const anweisung of FRIST_MERKEN) await db.query(anweisung);
  await db.query("SET statement_timeout = 0");
  await speicherStartenAuf(db, () => import("../../src/store.js?startfrist-protokoll"));
  const gemerkt = await db.query("SELECT frist FROM frist_protokoll");
  const sitzung = await db.query("SHOW statement_timeout");
  return {
    waehrendStart: gemerkt.rows.map((zeile) => zeile.frist),
    nachStart: sitzung.rows[0].statement_timeout,
  };
}

let startFristen;
function startFristenOhnePostgres() {
  startFristen ??= fristenBeimStartOhnePostgres();
  return startFristen;
}

test("[NIE1] beim Start des Speichers gilt zuerst die angehobene Startfrist von fünf Minuten und danach wieder die Abfragefrist von dreißig Sekunden", async () => {
  const { waehrendStart, nachStart } = await startFristenOhnePostgres();
  assert.ok(waehrendStart.length > 0);
  assert.deepEqual([...new Set(waehrendStart)], [START_FRIST_ALS_TEXT]);
  assert.equal(nachStart, STANDARD_FRIST_ALS_TEXT);
});

test("[NIE2] der Start des pg-Speichers führt Migration und Laden mit der Startfrist aus und hinterlässt die Sitzung mit der Abfragefrist, auch wenn sie vorher abgeschaltet war", async () => {
  const { waehrendStart, nachStart } = await startFristenOhnePostgres();
  assert.ok(waehrendStart.length > 0);
  assert.equal(waehrendStart.includes(STANDARD_FRIST_ALS_TEXT), false);
  assert.equal(waehrendStart.includes("0"), false);
  assert.equal(nachStart, STANDARD_FRIST_ALS_TEXT);
});
