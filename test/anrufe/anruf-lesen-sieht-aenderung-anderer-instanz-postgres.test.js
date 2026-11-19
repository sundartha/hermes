import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import {
  antwortVon,
  mitDatenbankVorDemStart,
  mitInstanzHinterRelais,
  mitInstanzenAufPostgres,
  signierteZustellung,
  zeilenBis,
} from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const HTTP_FEHLER = 500;
const HTTP_NICHT_GEFUNDEN = 404;
const ANRUF = "call_h7c2a_kopie";
const EIGENER_ANRUF = "call_h7c2a_eigen";
const GRUND = "von Instanz A beendet";
const LANG_VERGANGEN = "2020-01-01T00:00:00.000Z";
const KURZE_HOECHSTDAUER_S = 60;
const BEENDEN_SQL = "UPDATE call SET status = 'completed', failure_reason = $2 WHERE id = $1";
const ABLAUF_SQL = "UPDATE call SET started_at = $2, answered_at = $2, max_duration_s = $3 WHERE id = $1";
const LOESCHEN_SQL = "DELETE FROM call WHERE id = $1";
const ZEILE_SQL = "SELECT status, failure_reason FROM call WHERE id = $1";

const lies = (instanz, id) => abrufMitFrist(`${instanz.localUrl}/api/calls/${id}`);

test("H7c2a-1: GET /api/calls/:id auf Instanz B zeigt den Stand, den Instanz A nach dem Laden von B geschrieben hat", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: [ANRUF] }, async ({ instanzen: [, b], sql }) => {
    await sql(BEENDEN_SQL, [ANRUF, GRUND]);
    const antwort = await lies(b, ANRUF);
    assert.equal(antwort.status, HTTP_OK);
    const anruf = await antwort.json();
    assert.equal(anruf.status, "completed");
    assert.equal(anruf.failureReason, GRUND);
  });
});

test("H7c2a-2: POST /api/calls/:id/cancel auf Instanz B behandelt einen von A beendeten Anruf als beendet", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: [ANRUF] }, async ({ instanzen: [, b], sql }) => {
    await sql(BEENDEN_SQL, [ANRUF, GRUND]);
    const antwort = await abrufMitFrist(`${b.localUrl}/api/calls/${ANRUF}/cancel`, { method: "POST" });
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(await antwort.json(), { status: "completed" });
    assert.deepEqual((await sql(ZEILE_SQL, [ANRUF])).rows[0], { status: "completed", failure_reason: GRUND });
    assert.equal((await (await lies(b, ANRUF)).json()).status, "completed");
  });
});

test("H7c2a-3: auf einer Instanz liefert GET /api/calls/:id einen eigenen Anruf mit allen Feldern wie bisher", async (t) => {
  await mitDatenbankVorDemStart(t, { anrufe: [EIGENER_ANRUF] }, async ({ sql, signer, starte }) => {
    await sql(ABLAUF_SQL, [EIGENER_ANRUF, LANG_VERGANGEN, KURZE_HOECHSTDAUER_S]);
    const b = await starte();
    const zustellung = signierteZustellung(signer, {
      callId: EIGENER_ANRUF,
      felder: { CallStatus: "ringing", CallSid: `CA_${EIGENER_ANRUF}` },
    });
    const status = await antwortVon(b, { ...zustellung, pfad: `/voice/status?callId=${EIGENER_ANRUF}` });
    assert.equal(status.status, HTTP_OK);
    await zeilenBis(
      async () => (await sql(ZEILE_SQL, [EIGENER_ANRUF])).rows[0].status,
      (wert) => wert !== "active",
    );
    const anruf = await (await lies(b, EIGENER_ANRUF)).json();
    assert.equal(anruf.id, EIGENER_ANRUF);
    assert.equal(anruf.status, "failed");
    assert.equal(anruf.goal, "Testziel");
  });
});

test("H7c2a-4: hängt die Datenbank, antwortet GET /api/calls/:id auf Instanz B mit 500 statt 404", async (t) => {
  await mitInstanzHinterRelais(t, { anrufe: [ANRUF] }, async ({ a: b, relais }) => {
    relais.anhalten();
    try {
      const antwort = await lies(b, ANRUF);
      assert.equal(antwort.status, HTTP_FEHLER);
      assert.match(b.stdout, /leseCall fehlgeschlagen/);
    } finally {
      relais.fortsetzen();
    }
  });
});

test("H7c2a-5: ist der Anruf in der Datenbank nicht mehr da, antwortet GET /api/calls/:id auf Instanz B mit 404", async (t) => {
  await mitInstanzenAufPostgres(t, { anrufe: [ANRUF] }, async ({ instanzen: [, b], sql }) => {
    await sql(LOESCHEN_SQL, [ANRUF]);
    const antwort = await lies(b, ANRUF);
    assert.equal(antwort.status, HTTP_NICHT_GEFUNDEN);
  });
});
