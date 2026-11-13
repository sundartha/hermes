import assert from "node:assert/strict";
import { test } from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { kriteriumLauf } from "../gemeinsam/kriterium-lauf.mjs";
import { wartendeAufAblage } from "./wartende-auf-ablage.js";
import { antwortVon, mitInstanzenAufPostgres, signierteZustellung, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANTWORT_FRIST_MS = 3_000;
const ABBRUCH_FRIST_MS = 2_000;
const ABLAGE_TABELLE = "webhook_zustellung";
const OHNE_ERKENNUNG_ZEILE = "[webhook-idempotenz] wiederholte_zustellung weg=turn art=ohne_erkennung";
const KRITERIUM_NAME = "B4-K3";

const spracheingabe = (callId, token, gesagt = "Hallo") => ({
  callId,
  token,
  felder: { CallSid: `CA_${callId}`, SpeechResult: gesagt },
});

function keinGesprochenesImLog(log, marke) {
  for (const zeile of log.split("\n")) {
    assert.ok(!zeile.includes(marke), `Marke im Log: ${zeile}`);
    assert.ok(!zeile.includes("Hallo"), `Gesprochenes im Log: ${zeile}`);
  }
}

test("B4-K3: gesperrte Tabelle kostet höchstens 3 s, der Grund ist frist, und der Server bricht den Zugriff selbst ab", async (t) => {
  await mitInstanzenAufPostgres(t, { anzahl: 1, anrufe: ["call_b4", "call_b4w"] }, async ({ instanzen: [a], sql, signer }) => {
    await antwortVon(a, signierteZustellung(signer, spracheingabe("call_b4w", "t0050", "Warmlauf")));
    await sql("BEGIN");
    try {
      await sql(`LOCK TABLE ${ABLAGE_TABELLE} IN ACCESS EXCLUSIVE MODE`);
      const beginn = Date.now();
      const antwort = await antwortVon(a, signierteZustellung(signer, spracheingabe("call_b4", "t0051"))).catch(
        (fehler) => assert.fail(`A antwortet nicht (${fehler.name}) bei gesperrter Tabelle`),
      );
      assert.ok(Date.now() - beginn < ANTWORT_FRIST_MS, "A antwortet innerhalb von 3 s");
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Gather/);
      assert.ok(a.stdout.includes(`${OHNE_ERKENNUNG_ZEILE} grund=frist`), `Logzeile fehlt:\n${a.stdout}`);
      keinGesprochenesImLog(a.stdout, "t0051");

      const nachAntwort = Date.now();
      const wartende = await zeilenBis(
        () => wartendeAufAblage(sql),
        (zeilen) => zeilen.length === 0,
      );
      assert.deepEqual(wartende, [], "keine Sitzung wartet mehr auf die gesperrte Tabelle");
      assert.ok(Date.now() - nachAntwort <= ABBRUCH_FRIST_MS, "spätestens 2 s nach der Antwort");
    } finally {
      await sql("ROLLBACK");
    }
  });
});

test("B4-K5: fehlt die Tabelle, steht grund=fehler im Log, und A antwortet mit Gather", async (t) => {
  await mitInstanzenAufPostgres(t, { anzahl: 1, anrufe: ["call_b4f"] }, async ({ instanzen: [a], sql, signer }) => {
    await sql(`DROP TABLE ${ABLAGE_TABELLE}`);
    const antwort = await antwortVon(a, signierteZustellung(signer, spracheingabe("call_b4f", "t0052")));
    assert.equal(antwort.status, HTTP_OK);
    assert.match(antwort.xml, /<Gather/);
    assert.ok(a.stdout.includes(`${OHNE_ERKENNUNG_ZEILE} grund=fehler`), `Logzeile fehlt:\n${a.stdout}`);
    assert.ok(!a.stdout.includes("grund=frist"), "ein Fehler ist keine Frist");
    keinGesprochenesImLog(a.stdout, "t0052");
  });
});

test("B4-K12: unter CI und ohne Postgres-Adresse schlägt der Zeitgrenzen-Abnahmetest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = kriteriumLauf("test/anrufe/webhook-zustellung-zeitgrenze.test.js", `${KRITERIUM_NAME}:`, umgebung);
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
