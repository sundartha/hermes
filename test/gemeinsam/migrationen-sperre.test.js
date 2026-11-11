import assert from "node:assert/strict";
import { test } from "node:test";

import { echtWarten } from "../echt-warten.js";
import { startServer } from "../helpers.js";
import { makePgStore } from "../pg-helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank } from "./echtes-postgres.js";
import { parallelStarten } from "./parallelstart.js";
import { pgStartUmgebung } from "./pg-start-umgebung.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const SPERRE_KLASSE = 72;
const SPERRE_OBJEKT = 1;
const SPERRE_SITZUNG = 2;
const MELDUNG_FRIST_MS = 5_000;
const FREIGABE_FRIST_MS = 30_000;
const TAKT_MS = 50;
const ERSTE_VERSION = 1;
const PORT_ZEILE = /localhost:(\d+)/;
const WARTEMELDUNG = "[migrate] Migrationssperre belegt, warte auf die andere Instanz";
const TOKEN = { HERMES_DEPLOY_TOKEN: "t2a-migrationssperre-deploy-token-mindestens-32" };

const SPERRE_ABFRAGE = `SELECT count(*)::int AS anzahl FROM pg_locks
  WHERE locktype = 'advisory' AND classid = $1 AND objid = $2 AND objsubid = $3 AND granted`;

async function sperreGehalten(verbindung) {
  const { rows } = await verbindung.query(SPERRE_ABFRAGE, [
    SPERRE_KLASSE,
    SPERRE_OBJEKT,
    SPERRE_SITZUNG,
  ]);
  return rows[0].anzahl > 0;
}

async function bis(bedingung, frist) {
  const deadline = Date.now() + frist;
  while (!(await bedingung())) {
    assert.ok(Date.now() < deadline, "Bedingung nicht innerhalb der Frist erreicht");
    await echtWarten(TAKT_MS);
  }
}

async function healthzStatus(instanz) {
  const treffer = PORT_ZEILE.exec(instanz.ausgabe());
  const antwort = await abrufMitFrist(`http://localhost:${treffer[1]}/healthz`);
  return antwort.status;
}

test(
  "S9: zwei gleichzeitige Starts antworten beide 200 auf leerer Datenbank, Version 1 steht genau einmal da",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const umgebung = pgStartUmgebung(db.adresse, TOKEN);
    const verbindung = await db.verbinden();

    const gestartet = await Promise.all([
      startServer({ env: umgebung }),
      startServer({ env: umgebung }),
    ]);
    t.after(() => Promise.all(gestartet.map((prozess) => prozess.stop())));

    for (const prozess of gestartet) {
      const antwort = await abrufMitFrist(`${prozess.localUrl}/healthz`);
      assert.equal(antwort.status, HTTP_OK);
    }
    const { rows } = await verbindung.query(
      "SELECT count(*)::int AS anzahl FROM schema_migrations WHERE version = $1",
      [ERSTE_VERSION],
    );
    assert.equal(rows[0].anzahl, 1);
  },
);

test(
  "S10 und S14: hält eine andere Sitzung die Migrationssperre, meldet der Start das binnen 5 s und antwortet nach Freigabe",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const halter = await db.verbinden();
    await halter.query("SELECT pg_advisory_lock($1, $2)", [SPERRE_KLASSE, SPERRE_OBJEKT]);

    const [instanz] = parallelStarten(t, db.adresse, [pgStartUmgebung(db.adresse, TOKEN)]);
    await bis(() => instanz.ausgabe().includes(WARTEMELDUNG), MELDUNG_FRIST_MS);
    assert.ok(instanz.ausgabe().includes(WARTEMELDUNG), instanz.ausgabe());
    assert.ok(!PORT_ZEILE.test(instanz.ausgabe()), "wartend darf der Start nicht antworten");

    await halter.query("SELECT pg_advisory_unlock($1, $2)", [SPERRE_KLASSE, SPERRE_OBJEKT]);
    assert.equal(await instanz.bereit, true, instanz.ausgabe());
    await bis(() => PORT_ZEILE.test(instanz.ausgabe()), FREIGABE_FRIST_MS);
    assert.equal(await healthzStatus(instanz), HTTP_OK);
  },
);

test(
  "S11: während des Laufs hält der Start die Migrationssperre auf Sitzungsebene, nach dem Start nicht mehr",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const umgebung = pgStartUmgebung(db.adresse, TOKEN);
    await (await startServer({ env: umgebung })).stop();
    const beobachter = await db.verbinden();
    const bremse = await db.verbinden();
    await bremse.query("BEGIN");
    await bremse.query("LOCK TABLE tenant IN ACCESS EXCLUSIVE MODE");

    const [instanz] = parallelStarten(t, db.adresse, [umgebung]);
    await bis(() => sperreGehalten(beobachter), FREIGABE_FRIST_MS);
    assert.equal(await sperreGehalten(beobachter), true);
    assert.ok(!PORT_ZEILE.test(instanz.ausgabe()), "der Lauf ist noch nicht fertig");

    await bremse.query("COMMIT");
    assert.equal(await instanz.bereit, true, instanz.ausgabe());
    await bis(() => PORT_ZEILE.test(instanz.ausgabe()), FREIGABE_FRIST_MS);
    assert.equal(await healthzStatus(instanz), HTTP_OK);
    await bis(async () => !(await sperreGehalten(beobachter)), MELDUNG_FRIST_MS);
    assert.equal(await sperreGehalten(beobachter), false);
  },
);

test(
  "S14 im Prozess: belegte Migrationssperre meldet genau die Wartezeile",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const halter = await db.verbinden();
    await halter.query("SELECT pg_advisory_lock($1, $2)", [SPERRE_KLASSE, SPERRE_OBJEKT]);
    const arbeiter = await db.verbinden();
    const runner = {
      withClient: (fn) =>
        fn({
          query: (sql, werte) => arbeiter.query(sql, werte),
          exec: (sql) => arbeiter.query(sql),
        }),
    };
    const store = makePgStore(runner);
    const log = t.mock.method(console, "log");

    const lauf = store.init();
    const gemeldet = () => log.mock.calls.some((aufruf) => aufruf.arguments[0] === WARTEMELDUNG);
    await bis(gemeldet, MELDUNG_FRIST_MS);
    assert.ok(gemeldet());

    await halter.query("SELECT pg_advisory_unlock($1, $2)", [SPERRE_KLASSE, SPERRE_OBJEKT]);
    await lauf;
    const beobachter = await db.verbinden();
    const { rows } = await beobachter.query(
      "SELECT count(*)::int AS anzahl FROM schema_migrations WHERE version = $1",
      [ERSTE_VERSION],
    );
    assert.equal(rows[0].anzahl, 1);
  },
);
