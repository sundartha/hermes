import assert from "node:assert/strict";
import { test } from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { kriteriumLauf } from "../gemeinsam/kriterium-lauf.mjs";
import { antwortVon, mitInstanzHinterRelais, signierteZustellung, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANTWORT_FRIST_MS = 3_000;
const AUFRAEUM_FRIST_MS = 3_000;
const POOL_PLUS_EINS = 7;
const ANKER_JE_ZUSTELLUNG = 2;
const OHNE_ERKENNUNG = "[webhook-idempotenz] wiederholte_zustellung weg=turn art=ohne_erkennung";
const GUARD_ZEILEN = ["[guard] unhandledRejection", "[guard] uncaughtException"];
const KRITERIUM_NAME = "B4-K4 und K4b";
const ANRUFE = Array.from({ length: POOL_PLUS_EINS }, (_, nr) => `call_netz${nr + 1}`);
const ERSTE_MARKE = 61;
const ZWEITE_MARKE = 71;
const ZEILEN_SQL = `SELECT count(*)::int AS zeilen, count(koerper)::int AS beantwortet FROM webhook_zustellung`;
const AUFGERAEUMT_SQL = `SELECT
  (SELECT count(*)::int FROM webhook_zustellung WHERE koerper IS NULL) AS offen,
  (SELECT count(*)::int FROM pg_stat_activity WHERE usename = $1 AND state = 'idle in transaction') AS haengend`;

const marke = (nr) => `t00${nr}`;
const spracheingabe = (callId, token, gesagt = "Hallo") => ({
  callId,
  token,
  felder: { CallSid: `CA_${callId}`, SpeechResult: gesagt },
});

const zeilenMit = (log, text) => log.split("\n").filter((zeile) => zeile.includes(text));

async function gleichzeitigAnAlle({ a, signer, ab }) {
  return Promise.all(
    ANRUFE.map(async (callId, nr) => {
      const beginn = Date.now();
      const antwort = await antwortVon(a, signierteZustellung(signer, spracheingabe(callId, marke(ab + nr)))).catch(
        (fehler) => assert.fail(`A antwortet nicht auf ${marke(ab + nr)} (${fehler.name})`),
      );
      return { ...antwort, dauerMs: Date.now() - beginn };
    }),
  );
}

function alleMitGather(antworten) {
  for (const antwort of antworten) {
    assert.equal(antwort.status, HTTP_OK);
    assert.match(antwort.xml, /<Gather/);
  }
}

function nichtsGesprochenesImLog(log) {
  for (const zeile of log.split("\n")) {
    assert.ok(!zeile.includes("Hallo"), `Gesprochenes im Log: ${zeile}`);
    for (let nr = 0; nr < POOL_PLUS_EINS; nr += 1) {
      assert.ok(!zeile.includes(marke(ERSTE_MARKE + nr)), `Marke im Log: ${zeile}`);
    }
  }
}

test("B4-K4 und K4b: hängendes Netz kostet jede Zustellung höchstens 3 s, auch beim Pool-Warten, und danach bleibt nichts liegen", async (t) => {
  await mitInstanzHinterRelais(t, { anrufe: ["call_netz0", ...ANRUFE] }, async ({ a, sql, signer, relais, rolle }) => {
    await antwortVon(a, signierteZustellung(signer, spracheingabe("call_netz0", "t0060", "Warmlauf")));
    await zeilenBis(async () => (await sql(ZEILEN_SQL)).rows[0], (stand) => stand.beantwortet === ANKER_JE_ZUSTELLUNG);
    await sql("DELETE FROM webhook_zustellung");

    relais.anhalten();
    const angehalten = await gleichzeitigAnAlle({ a, signer, ab: ERSTE_MARKE });
    alleMitGather(angehalten);
    for (const { dauerMs } of angehalten) assert.ok(dauerMs <= ANTWORT_FRIST_MS, `Antwort nach ${dauerMs} ms`);
    assert.equal(zeilenMit(a.stdout, `${OHNE_ERKENNUNG} grund=frist`).length, POOL_PLUS_EINS, a.stdout);
    nichtsGesprochenesImLog(a.stdout);

    relais.fortsetzen();
    await relais.abwarten();
    const fortgesetzt = Date.now();
    const aufgeraeumt = await zeilenBis(
      async () => (await sql(AUFGERAEUMT_SQL, [rolle])).rows[0],
      (stand) => stand.offen === 0 && stand.haengend === 0,
    );
    assert.deepEqual(aufgeraeumt, { offen: 0, haengend: 0 }, "keine liegengebliebene Annahme, keine offene Transaktion");
    assert.ok(Date.now() - fortgesetzt <= AUFRAEUM_FRIST_MS, "innerhalb von 3 s nach dem Fortsetzen");

    alleMitGather(await gleichzeitigAnAlle({ a, signer, ab: ZWEITE_MARKE }));
    assert.equal(zeilenMit(a.stdout, OHNE_ERKENNUNG).length, POOL_PLUS_EINS, "keine weitere Zeile ohne Erkennung");
    const abgelegt = POOL_PLUS_EINS * ANKER_JE_ZUSTELLUNG;
    const stand = await zeilenBis(async () => (await sql(ZEILEN_SQL)).rows[0], (zeilen) => zeilen.beantwortet === abgelegt);
    assert.deepEqual(stand, { zeilen: abgelegt, beantwortet: abgelegt });
    for (const guardZeile of GUARD_ZEILEN) assert.ok(!a.stdout.includes(guardZeile), `${guardZeile} im Log:\n${a.stdout}`);
  });
});

test("B4-K12: unter CI und ohne Postgres-Adresse schlägt der Netz-Abnahmetest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = kriteriumLauf("test/anrufe/webhook-zustellung-netz.test.js", `${KRITERIUM_NAME}:`, umgebung);
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
