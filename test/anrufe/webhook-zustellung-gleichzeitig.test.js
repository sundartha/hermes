import assert from "node:assert/strict";
import { test } from "node:test";

import {
  antwortNachWartezeit,
  antwortVon,
  mitInstanzenAufPostgres,
  signierteZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ZEILEN_JE_ZUSTELLUNG = 2;
const WARTEFRIST_MS = 15_000;
const SPIELRAUM_MS = 1_000;
const BEANTWORTET_SQL =
  "SELECT count(*)::int AS anzahl FROM webhook_zustellung WHERE koerper IS NOT NULL";
const KENNUNGEN_SQL =
  "SELECT kennung FROM webhook_zustellung GROUP BY kennung ORDER BY min(angenommen_um)";
const UNBEANTWORTET_SQL = `UPDATE webhook_zustellung
  SET status = NULL, content_type = NULL, iv = NULL, koerper = NULL, tag = NULL WHERE kennung = $1`;
const KENNUNG_TAUSCHEN_SQL = "UPDATE webhook_zustellung SET kennung = $2 WHERE kennung = $1";

const zustellung = (callId, token, gesagt) => ({
  callId,
  token,
  felder: { CallSid: "CA_geteilt", SpeechResult: gesagt },
});

async function beantwortenLassen({ a, sql, signer }, zustellungen) {
  for (const eingang of zustellungen) {
    const antwort = await antwortVon(a, signierteZustellung(signer, eingang));
    assert.match(antwort.xml, /<Gather/);
  }
  await zeilenBis(
    async () => (await sql(BEANTWORTET_SQL)).rows[0].anzahl,
    (anzahl) => anzahl >= zustellungen.length * ZEILEN_JE_ZUSTELLUNG,
  );
}

test("K2: dieselbe Zustellung gleichzeitig an zwei Instanzen läuft einmal durchs Modell, beide liefern dasselbe XML", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anrufe: ["call_k2"] },
    async ({ instanzen: [a, b], signer, modell }) => {
      const eingang = zustellung("call_k2", "t0002", "Ich möchte einen Termin");
      const [vonA, vonB] = await Promise.all([
        antwortVon(a, signierteZustellung(signer, eingang)),
        antwortVon(b, signierteZustellung(signer, eingang)),
      ]);
      for (const antwort of [vonA, vonB]) {
        assert.equal(antwort.status, HTTP_OK);
        assert.match(antwort.contentType, /^text\/xml/);
        assert.match(antwort.xml, /<Gather/);
      }
      assert.equal(vonB.xml, vonA.xml);
      assert.equal(modell.count(), 1);
    },
  );
});

test("K6: eine vertauschte Kennung beim Warten liefert nicht das XML der Nachbarzeile, B verarbeitet nach der Wartefrist selbst", async (t) => {
  await mitInstanzenAufPostgres(
    t,
    { anrufe: ["call_k6a", "call_k6b"] },
    async ({ instanzen: [a, b], sql, signer, modell }) => {
      await beantwortenLassen({ a, sql, signer }, [
        zustellung("call_k6a", "t0021", "Ich möchte einen Termin"),
        zustellung("call_k6b", "t0022", "Ich möchte einen Termin morgen"),
      ]);
      const [kennung21, kennung22] = (await sql(KENNUNGEN_SQL)).rows.map((zeile) => zeile.kennung);
      await sql(UNBEANTWORTET_SQL, [kennung22]);
      await sql(KENNUNG_TAUSCHEN_SQL, [kennung21, kennung22]);
      const xmlZu21 = (await antwortVon(a, signierteZustellung(signer, zustellung("call_k6a", "t0021", "Hallo")))).xml;

      const vorher = modell.count();
      const beginn = Date.now();
      const antwort = await antwortNachWartezeit(
        b,
        signierteZustellung(signer, zustellung("call_k6b", "t0022", "Hallo")),
        WARTEFRIST_MS,
      );
      const dauer = Date.now() - beginn;

      assert.equal(antwort.status, HTTP_OK);
      assert.match(antwort.xml, /<Gather/);
      assert.notEqual(antwort.xml, xmlZu21);
      assert.equal(modell.count(), vorher + 1);
      assert.ok(dauer >= WARTEFRIST_MS - SPIELRAUM_MS, `B wartet auf die fremde Annahme (${dauer} ms)`);
      assert.ok(dauer <= WARTEFRIST_MS + SPIELRAUM_MS, `B antwortet innerhalb von 16 s (${dauer} ms)`);
    },
  );
});
