import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, startServerExpectExit } from "../helpers.js";
import { makePgStore } from "../pg-helpers.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { pgStartUmgebung } from "./pg-start-umgebung.js";

const ZEITGRENZE_MS = 120_000;
const ABBRUCH_FRIST_MS = 30_000;
const EXIT_NACH_ABBRUCH = 1;
const PLATTFORM_BEREICH = "owner";
const FREMDER_BEREICH = "k-fremd";
const ERSTE_DATEI = "0001_ausgang.sql";
const LETZTE_VERSIONEN = [11, 12];
const TOKEN = { HERMES_DEPLOY_TOKEN: "t2b-bereich-frist-deploy-token-mindestens-32" };

const BEREICH_LESEN = "SELECT current_setting('app.current_tenant', true) AS bereich";
const BEREICH_SETZEN = "SELECT set_config('app.current_tenant', $1, false)";

function bereichsWechsler(verbindung) {
  const gelesen = [];
  const runner = {
    withClient: (fn) =>
      fn({
        query: (sql, werte) => verbindung.query(sql, werte),
        exec: async (sql) => {
          gelesen.push((await verbindung.query(BEREICH_LESEN)).rows[0].bereich);
          await verbindung.query(sql);
          await verbindung.query(BEREICH_SETZEN, [FREMDER_BEREICH]);
        },
      }),
  };
  return { runner, gelesen };
}

test(
  "SG-27 jede Migration beginnt im Plattformbereich, auch wenn die Vorgängerdatei den Bereich auf einen Kunden gestellt hat",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const arbeiter = await db.verbinden();
    const erster = bereichsWechsler(arbeiter);
    await makePgStore(erster.runner).init();
    assert.ok(erster.gelesen.length >= 2, "die Übernahme führt mehrere Dateien aus");
    assert.deepEqual(new Set(erster.gelesen), new Set([PLATTFORM_BEREICH]));

    await arbeiter.query("DELETE FROM schema_migrations WHERE version = ANY($1)", [
      LETZTE_VERSIONEN,
    ]);
    const zweiter = bereichsWechsler(arbeiter);
    await makePgStore(zweiter.runner).init();
    assert.deepEqual(zweiter.gelesen, [PLATTFORM_BEREICH, PLATTFORM_BEREICH]);
  },
);

test(
  "S12: hält eine andere Sitzung eine offene Änderung an number, endet der Start ohne Versionstabelle mit Exit 1 und nennt 0001_ausgang.sql",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const umgebung = pgStartUmgebung(db.adresse, TOKEN);
    await (await startServer({ env: umgebung })).stop();
    const halter = await db.verbinden();
    await halter.query("DROP TABLE schema_migrations");
    await halter.query("BEGIN");
    await halter.query("UPDATE number SET status = status");

    const beginn = Date.now();
    const ergebnis = await startServerExpectExit({ env: umgebung, timeoutMs: ABBRUCH_FRIST_MS });
    assert.ok(Date.now() - beginn < ABBRUCH_FRIST_MS);
    assert.equal(ergebnis.code, EXIT_NACH_ABBRUCH);
    assert.ok(ergebnis.output.includes(ERSTE_DATEI), ergebnis.output);

    await halter.query("COMMIT");
    const { rows } = await halter.query(
      "SELECT count(*)::int AS anzahl FROM pg_class WHERE relname = 'schema_migrations'",
    );
    assert.equal(rows[0].anzahl, 0);
  },
);

test(
  "S12: die Frist der Übernahme gilt nur in deren Transaktion und bleibt nicht an der Sitzung hängen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const arbeiter = await db.verbinden();
    const { runner } = bereichsWechsler(arbeiter);
    await makePgStore(runner).init();
    const { rows } = await arbeiter.query("SHOW lock_timeout");
    assert.equal(rows[0].lock_timeout, "0");
  },
);
