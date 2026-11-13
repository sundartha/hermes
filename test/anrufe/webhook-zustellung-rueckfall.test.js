import assert from "node:assert/strict";
import { test } from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { kriteriumLauf } from "../gemeinsam/kriterium-lauf.mjs";
import {
  antwortVon,
  mitInstanzenAufPostgres,
  signierteRueckfallZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const WIEDERHOLUNG_FRIST_MS = 1_000;
const ABLAGE_TABELLE = "webhook_zustellung";
const KRITERIUM_NAME = "S4-K1";
const RUECKFALL_QUELLE = "dial_ende";

const rueckfall = (signer, { callId, callSid, quelle = RUECKFALL_QUELLE, zusatz = {} }) =>
  signierteRueckfallZustellung(signer, { callId, quelle, felder: { CallSid: callSid, ...zusatz } });

async function zeilenMitAntwort(sql) {
  const { rows } = await sql(`SELECT 1 FROM ${ABLAGE_TABELLE} WHERE koerper IS NOT NULL`);
  return rows;
}

test("S4-K1: derselbe Rückfall gleichzeitig an Instanz A und B ergibt zweimal dasselbe XML", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: ["call_s4"] }, async ({ instanzen: [a, b], signer }) => {
    const zustellung = rueckfall(signer, { callId: "call_s4", callSid: "CArueck01", quelle: "frist" });
    const [vonA, vonB] = await Promise.all([antwortVon(a, zustellung), antwortVon(b, zustellung)]);
    for (const antwort of [vonA, vonB]) {
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.contentType, /^text\/xml/);
      assert.match(antwort.xml, /<Gather/);
    }
    assert.equal(vonB.xml, vonA.xml, "Byte für Byte dasselbe XML");
  });
});

test("S4-K2: Rückfall mit anderem Körper an B liefert nach A das XML von A, ohne Neuberechnung", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: ["call_s4b"] }, async ({ instanzen: [a, b], sql, signer }) => {
    const vonA = await antwortVon(a, rueckfall(signer, { callId: "call_s4b", callSid: "CArueck02" }));
    assert.equal(vonA.status, HTTP_OK);
    assert.match(vonA.xml, /<Gather/);
    await zeilenBis(() => zeilenMitAntwort(sql), (zeilen) => zeilen.length > 0);
    assert.ok((await zeilenMitAntwort(sql)).length > 0, "die Zeile trägt laut SQL eine Antwort");

    const wiederholung = rueckfall(signer, { callId: "call_s4b", callSid: "CArueck02", zusatz: { Wiederholt: "1" } });
    const beginn = Date.now();
    const vonB = await antwortVon(b, wiederholung);
    assert.ok(Date.now() - beginn < WIEDERHOLUNG_FRIST_MS, "B antwortet innerhalb von 1 s");
    assert.equal(vonB.status, HTTP_OK);
    assert.equal(vonB.xml, vonA.xml, "Byte für Byte das XML von A");
  });
});

test("S4-K2b: Rückfall mit gültiger Signatur, aber fremdem CallSid bekommt nicht das XML von A, mit demselben CallSid schon", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anzahl: 3, anrufe: ["call_s4b"] },
    async ({ instanzen: [a, b, c], sql, signer }) => {
      const vonA = await antwortVon(a, rueckfall(signer, { callId: "call_s4b", callSid: "CArueck02" }));
      await zeilenBis(() => zeilenMitAntwort(sql), (zeilen) => zeilen.length > 0);

      const gleicherCallSid = rueckfall(signer, { callId: "call_s4b", callSid: "CArueck02", zusatz: { Wiederholt: "1" } });
      const positivkontrolle = await antwortVon(c, gleicherCallSid);
      assert.equal(positivkontrolle.xml, vonA.xml, "Positivkontrolle: gleicher CallSid liefert das XML von A");

      const vonB = await antwortVon(b, rueckfall(signer, { callId: "call_s4b", callSid: "CArueck99" }));
      assert.equal(vonB.status, HTTP_OK);
      assert.match(vonB.xml, /<Gather/);
      assert.notEqual(vonB.xml, vonA.xml, "fremder CallSid bekommt nicht das XML von A");
    },
  );
});

test("S4-K12: unter CI und ohne Postgres-Adresse schlägt der Rückfall-Abnahmetest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = kriteriumLauf("test/anrufe/webhook-zustellung-rueckfall.test.js", `${KRITERIUM_NAME}:`, umgebung);
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
