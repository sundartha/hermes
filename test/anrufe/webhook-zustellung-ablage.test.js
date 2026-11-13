import assert from "node:assert/strict";
import { test } from "node:test";

import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { kriteriumLauf } from "../gemeinsam/kriterium-lauf.mjs";
import {
  antwortVon,
  mitInstanzenAufPostgres,
  signierteZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const WIEDERHOLUNG_FRIST_MS = 1_000;
const KURZER_SCHLUESSEL = "k".repeat(31);
const GESPROCHEN = "Ich möchte einen Termin";
const ABLAGE_TABELLE = "webhook_zustellung";
const WIEDERHOLT_ZEILE = "[webhook-idempotenz] wiederholte_zustellung weg=turn art=ohne_erkennung";
const KRITERIUM_1_NAME = "K1";
const SAY_TEXT = /<Say[^>]*>([^<]+)<\/Say>/;

const spracheingabe = (callId, token, gesagt) => ({
  callId,
  token,
  felder: gesagt === undefined ? { CallSid: `CA_${callId}` } : { CallSid: `CA_${callId}`, SpeechResult: gesagt },
});

async function tabelleVorhanden(sql) {
  const { rows } = await sql("SELECT to_regclass($1) AS tabelle", [ABLAGE_TABELLE]);
  assert.notEqual(rows[0].tabelle, null, `Tabelle ${ABLAGE_TABELLE} fehlt`);
}

async function ablageZeilen(sql) {
  await tabelleVorhanden(sql);
  return (await sql(`SELECT * FROM ${ABLAGE_TABELLE}`)).rows;
}

const mitAntwort = (zeilen) => zeilen.filter((zeile) => zeile.koerper !== null);

function enthaelt(wert, nadel) {
  return Buffer.isBuffer(wert)
    ? wert.includes(Buffer.from(nadel))
    : String(wert ?? "").includes(nadel);
}

test("K1/K7: Wiederholung mit anderem Körper an Instanz B liefert das XML von A byte-gleich, ohne Modellaufruf und ohne Klartext in der Tabelle", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anrufe: ["call_k1"] },
    async ({ instanzen: [a, b], sql, signer, modell }) => {
      const erste = signierteZustellung(signer, spracheingabe("call_k1", "t0001", GESPROCHEN));
      const vonA = await antwortVon(a, erste);
      assert.equal(vonA.status, HTTP_OK);
      assert.match(vonA.xml, /<Gather/);
      await zeilenBis(
        async () => mitAntwort(await ablageZeilen(sql)),
        (zeilen) => zeilen.length > 0,
      );
      assert.ok(mitAntwort(await ablageZeilen(sql)).length > 0, "die Zeile trägt laut SQL eine Antwort");

      const wiederholung = signierteZustellung(signer, spracheingabe("call_k1", "t0001"));
      const beginn = Date.now();
      const vonB = await antwortVon(b, wiederholung);
      assert.ok(Date.now() - beginn < WIEDERHOLUNG_FRIST_MS, "B antwortet innerhalb von 1 s");
      assert.equal(vonB.status, HTTP_OK);
      assert.match(vonB.contentType, /^text\/xml/);
      assert.equal(vonB.contentType, vonA.contentType);
      assert.equal(vonB.xml, vonA.xml, "Byte für Byte das XML von A");
      assert.equal(modell.count(), 1, "die Attrappe zählt genau einen Aufruf");

      const agentenSatz = SAY_TEXT.exec(vonA.xml)?.[1];
      assert.ok(agentenSatz, "das XML von A trägt einen gesprochenen Satz");
      const nadeln = [GESPROCHEN, agentenSatz, "<Response", "t0001", "call_k1", "+49151", "/voice/tts/"];
      for (const zeile of await ablageZeilen(sql)) {
        for (const [spalte, wert] of Object.entries(zeile)) {
          for (const nadel of nadeln) {
            assert.ok(!enthaelt(wert, nadel), `Spalte ${spalte} enthält Klartext "${nadel}"`);
          }
        }
      }
    },
  );
});

test("K9: fehlt die Tabelle, antwortet die Instanz selbst, schreibt die Rückfall-Zeile und loggt weder Marke noch Gesprochenes", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anzahl: 1, anrufe: ["call_k9"] },
    async ({ instanzen: [a], sql, signer, modell }) => {
      await tabelleVorhanden(sql);
      await sql(`DROP TABLE ${ABLAGE_TABELLE}`);
      const antwort = await antwortVon(a, signierteZustellung(signer, spracheingabe("call_k9", "t0009", "Hallo")));
      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Gather/);
      assert.equal(modell.count(), 1);
      assert.ok(a.stdout.includes(WIEDERHOLT_ZEILE), `Logzeile fehlt:\n${a.stdout}`);
      for (const zeile of a.stdout.split("\n")) {
        assert.ok(!zeile.includes("t0009"), `Marke im Log: ${zeile}`);
        assert.ok(!zeile.includes("Hallo"), `Gesprochenes im Log: ${zeile}`);
      }
    },
  );
});

test("B1: ungültig signierte Zustellung bekommt 403 und nimmt nichts an, dieselbe gültig signierte danach 200 mit Gather", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anrufe: ["call_b1"] },
    async ({ instanzen: [a, b], sql, signer, modell }) => {
      const gueltig = signierteZustellung(signer, spracheingabe("call_b1", "t0005", "Hallo"));
      const ungueltig = {
        ...gueltig,
        optionen: {
          ...gueltig.optionen,
          headers: { ...gueltig.optionen.headers, "telnyx-signature-ed25519": "AAAA" },
        },
      };
      assert.equal((await antwortVon(a, ungueltig)).status, HTTP_FORBIDDEN);
      assert.equal(modell.count(), 0);
      assert.deepEqual(await ablageZeilen(sql), [], "die abgelehnte Zustellung hat nichts angenommen");
      const danach = await antwortVon(b, gueltig);
      assert.equal(danach.status, HTTP_OK);
      assert.match(danach.xml, /<Gather/);
      assert.equal(modell.count(), 1);
    },
  );
});

for (const [name, schluessel] of [
  ["ohne Schlüssel", ""],
  ["mit 31 Zeichen", KURZER_SCHLUESSEL],
]) {
  test(`B5: Postgres-Speicher ${name} erkennt die Wiederholung im Prozess und lässt die Tabelle leer`, async (t) => {
    await mitInstanzenAufPostgres(
      t,
      { anzahl: 1, anrufe: ["call_b5"], env: { WEBHOOK_ZUSTELLUNG_SECRET: schluessel } },
      async ({ instanzen: [a], sql, signer, modell }) => {
        const zustellung = signierteZustellung(signer, spracheingabe("call_b5", "t0007", "Hallo"));
        const erste = await antwortVon(a, zustellung);
        const zweite = await antwortVon(a, zustellung);
        assert.equal(erste.status, HTTP_OK);
        assert.equal(zweite.status, HTTP_OK);
        assert.equal(zweite.xml, erste.xml);
        assert.equal(modell.count(), 1);
        assert.deepEqual(await ablageZeilen(sql), []);
      },
    );
  });
}

test("B6: dieselbe Zustellung gleichzeitig an dieselbe Instanz mit Schlüssel ergibt eine Modellrunde und zwei gleiche Antworten", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anzahl: 1, anrufe: ["call_b6"] },
    async ({ instanzen: [a], signer, modell }) => {
      const zustellung = signierteZustellung(signer, spracheingabe("call_b6", "t0008", "Hallo"));
      const [erste, zweite] = await Promise.all([antwortVon(a, zustellung), antwortVon(a, zustellung)]);
      assert.equal(erste.status, HTTP_OK);
      assert.equal(zweite.status, HTTP_OK);
      assert.equal(zweite.xml, erste.xml);
      assert.equal(modell.count(), 1);
    },
  );
});

test("K12: unter CI und ohne Postgres-Adresse schlägt der Abnahmetest fehl, statt zu überspringen", () => {
  const umgebung = { ...process.env, CI: "true" };
  delete umgebung[POSTGRES_VARIABLE];
  delete umgebung.NODE_TEST_CONTEXT;
  const lauf = kriteriumLauf("test/anrufe/webhook-zustellung-ablage.test.js", `${KRITERIUM_1_NAME}/`, umgebung);
  assert.notEqual(lauf.status, 0, `der Lauf darf nicht grün sein:\n${lauf.stdout}`);
  assert.match(lauf.stdout + lauf.stderr, /fehlt unter CI/);
});
