import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { neuePglite } from "../pglite-helfer.js";
import { oeffneSpeicherAn } from "./speicher-oeffnen.js";

const BOOTSTRAP_MANDANT = "owner";
const FREMDER_MANDANT = "fremd-a";
const ZWEITER_FREMDER_MANDANT = "fremd-b";
const FLUSH_FRIST_MS = 120_000;
const BEGRUESSUNG_OHNE_HINWEIS = "Hallo, hier ist der Assistent.";
const EIGENER_ZUGANG = "owner-zugang-start-und-flush";
const MANDANT_SETZEN = /set_config\('app\.current_tenant'/;
const SCHREIBANWEISUNG = /^\s*(INSERT|UPDATE|DELETE)\b/i;

function aufzeichnen(db, protokoll) {
  return {
    query: async (text, params) => {
      protokoll.push({ text, params });
      return db.query(text, params);
    },
    exec: async (text) => {
      protokoll.push({ text, params: undefined });
      return db.exec(text);
    },
  };
}

async function mitAttrappenPool(db, aufgabe) {
  const echterPool = pg.Pool;
  process.env.STORE_BACKEND = "pg";
  process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
  process.env.OWNER_IDP_SUBJECT = EIGENER_ZUGANG;
  const pools = poolAufPglite(db);
  try {
    const speicher = await aufgabe();
    assert.equal(pools.length, 1);
    return speicher;
  } finally {
    pg.Pool = echterPool;
  }
}

async function fremdeMandantenAnlegen(db) {
  await db.query("UPDATE tenant SET kyc_level = NULL, idp_subject = NULL WHERE id = $1", [
    BOOTSTRAP_MANDANT,
  ]);
  for (const mandant of [FREMDER_MANDANT, ZWEITER_FREMDER_MANDANT]) {
    await db.query("INSERT INTO tenant (id, status) VALUES ($1, 'active')", [mandant]);
    await db.query(
      `INSERT INTO settings (tenant_id, agent_name, greeting, allow_calendar, allow_booking, allow_summaries, allow_personal_data, allow_bank_data, language)
       VALUES ($1, 'Hermes', $2, false, false, false, false, false, 'de')`,
      [mandant, BEGRUESSUNG_OHNE_HINWEIS],
    );
  }
}

async function startMitFremdenMandanten() {
  const db = await neuePglite();
  await mitAttrappenPool(db, () => import("../../src/store.js?schema-anlegen").then(oeffneSpeicherAn));
  await fremdeMandantenAnlegen(db);
  const protokoll = [];
  const speicher = await mitAttrappenPool(
    aufzeichnen(db, protokoll),
    () => import("../../src/store.js?aufgezeichneter-start").then(oeffneSpeicherAn),
  );
  const startAnweisungen = protokoll.length;
  return { speicher, protokoll, startAnweisungen };
}

let gestartet;
function startOhnePostgres() {
  gestartet ??= startMitFremdenMandanten();
  return gestartet;
}

const mandantenAnweisungen = (anweisungen) =>
  anweisungen
    .filter((eintrag) => MANDANT_SETZEN.test(eintrag.text))
    .map((eintrag) => eintrag.params[0]);

test("[NIE1] der Flush beginnt mit BEGIN, setzt vor der ersten Schreibanweisung die lokale Flush-Frist von zwei Minuten und schreibt danach", async () => {
  const { speicher, protokoll, startAnweisungen } = await startOhnePostgres();
  await speicher.save();
  await speicher.drainFlushes();
  const flush = protokoll.slice(startAnweisungen);
  const beginn = flush.findIndex((eintrag) => eintrag.text.trim() === "BEGIN");
  assert.notEqual(beginn, -1);
  const nachBeginn = flush.slice(beginn + 1);
  const ersteSchreibung = nachBeginn.findIndex((eintrag) => SCHREIBANWEISUNG.test(eintrag.text));
  assert.notEqual(ersteSchreibung, -1);
  const frist = nachBeginn
    .slice(0, ersteSchreibung)
    .find((eintrag) => /set_config\('statement_timeout', \$1, true\)/.test(eintrag.text));
  assert.deepEqual(frist?.params, [String(FLUSH_FRIST_MS)]);
});

test("[NIE2] beim ersten Start nennt die erste und die letzte Mandanten-Anweisung den Bootstrap-Mandanten, auch wenn beim Laden ein fremder Mandant zuletzt gesetzt wurde", async () => {
  const { protokoll, startAnweisungen } = await startOhnePostgres();
  const mandanten = mandantenAnweisungen(protokoll.slice(0, startAnweisungen));
  assert.equal(mandanten[0], BOOTSTRAP_MANDANT);
  assert.ok(mandanten.includes(FREMDER_MANDANT));
  assert.notEqual(mandanten.lastIndexOf(FREMDER_MANDANT), mandanten.length - 1);
  assert.equal(mandanten.at(-1), BOOTSTRAP_MANDANT);
});

test("[NIE3] beim Start trägt keine Schreibanweisung des Nachziehens von Zugang und KYC die Kennung eines fremden Mandanten", async () => {
  const { protokoll, startAnweisungen } = await startOhnePostgres();
  const mandantenSchreibungen = protokoll
    .slice(0, startAnweisungen)
    .filter(
      (eintrag) =>
        SCHREIBANWEISUNG.test(eintrag.text) &&
        /\btenant\b/i.test(eintrag.text) &&
        !/\bsettings\b/i.test(eintrag.text),
    );
  assert.ok(mandantenSchreibungen.some((eintrag) => eintrag.params?.[0] === BOOTSTRAP_MANDANT));
  assert.deepEqual(
    mandantenSchreibungen.filter((eintrag) =>
      [FREMDER_MANDANT, ZWEITER_FREMDER_MANDANT].includes(eintrag.params?.[0]),
    ),
    [],
  );
});

test("[NIE4] beim Start steht vor jedem Schreiben in settings der Mandant gesetzt, dessen Einstellungen geschrieben werden", async () => {
  const { protokoll, startAnweisungen } = await startOhnePostgres();
  let gesetzt = null;
  const geschrieben = [];
  for (const eintrag of protokoll.slice(0, startAnweisungen)) {
    if (MANDANT_SETZEN.test(eintrag.text)) gesetzt = eintrag.params[0];
    else if (SCHREIBANWEISUNG.test(eintrag.text) && /\bsettings\b/i.test(eintrag.text)) {
      assert.equal(gesetzt, eintrag.params[0]);
      geschrieben.push(eintrag.params[0]);
    }
  }
  assert.ok(geschrieben.includes(FREMDER_MANDANT));
  assert.ok(geschrieben.includes(ZWEITER_FREMDER_MANDANT));
});

test("[NIE1] beim Start steht nach der Startfrist der Bootstrap-Mandant vor dem Aufbau des Schemas", async () => {
  const { protokoll, startAnweisungen } = await startOhnePostgres();
  const start = protokoll.slice(0, startAnweisungen);
  const frist = start.findIndex((eintrag) => /set_config\('statement_timeout'/.test(eintrag.text));
  assert.notEqual(frist, -1);
  const nachFrist = start.slice(frist + 1);
  const ersterMandant = nachFrist.findIndex((eintrag) => MANDANT_SETZEN.test(eintrag.text));
  assert.notEqual(ersterMandant, -1);
  assert.equal(nachFrist[ersterMandant].params[0], BOOTSTRAP_MANDANT);
  const davor = nachFrist.slice(0, ersterMandant);
  assert.deepEqual(
    davor.filter((eintrag) => !/set_config|^\s*(BEGIN|SHOW)\b/i.test(eintrag.text)),
    [],
  );
});

test("[NIE5] beim Start steht vor dem Aufbau die Anhebung der Startfrist auf fünf Minuten und als letzte Anweisung die Rückgabe auf dreißig Sekunden", async () => {
  const STARTFRIST_MS = 300_000;
  const ABFRAGEFRIST_MS = 30_000;
  const SITZUNGSFRIST = /set_config\('statement_timeout', \$1, false\)/;
  const { protokoll, startAnweisungen } = await startOhnePostgres();
  const start = protokoll.slice(0, startAnweisungen);
  const anhebung = start.findIndex((eintrag) => SITZUNGSFRIST.test(eintrag.text));
  assert.notEqual(anhebung, -1);
  assert.deepEqual(start[anhebung].params, [String(STARTFRIST_MS)]);
  const ersterMandant = start.findIndex((eintrag) => MANDANT_SETZEN.test(eintrag.text));
  assert.ok(anhebung < ersterMandant);
  const letzte = start.at(-1);
  assert.match(letzte.text, SITZUNGSFRIST);
  assert.deepEqual(letzte.params, [String(ABFRAGEFRIST_MS)]);
});
