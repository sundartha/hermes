// E2E-03 (i18n-Launch-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md): eine
// Sprachumstellung WAEHREND eines laufenden Anrufs bleibt fuer diesen Anruf wirkungslos -
// call.language wird genau einmal bei der Call-Anlage aufgeloest, alle Turn-Pfade lesen
// call.language statt neu aufzuloesen. Positive Invariante ohne Pin: ein spaeteres
// "Sprache pro Turn neu aufloesen" wuerde mitten im Gespraech die Stimme wechseln.
//
// AUTH-P4: die frühere Umstell-Naht (POST /api/settings) ist geloescht. Der verbleibende
// Settings-Schreibpfad (/api/self-service/settings) braucht Web-Login + pglite, und
// pglite gehoert nie in eine Datei mit Server-Spawn (Lehre p6a-Stall) - kein Ersatz-
// Schreibvorgang in dieser Datei. Stattdessen traegt der SEED die Umstellung bereits:
// call.language="de" (der laufende Anruf) UND settings[BOOTSTRAP].language="en" (der
// Tenant-Override) von Anfang an nebeneinander. Derselbe No-Speech-Turn belegt die
// Invariante dadurch STAERKER als der fruehere Live-Flip: wuerde irgendein Turn-Pfad
// die Sprache neu aufloesen statt call.language zu lesen, kaeme "en" heraus - es kommt
// "de". Der zweite Test (naechster Anruf traegt die neue Sprache) braucht mit diesem
// Seed gar keinen Schreibvorgang mehr.
//
// Der Turn-Beweis laeuft ueber den No-Speech-Zweig (leerer SpeechResult): er rendert
// einen vollstaendigen Folge-Gather OHNE LLM-Aufruf -> offline, deterministisch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, OWNER_TEST_NUMBER } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const CALL_ID = "call_e2e03";
const DE_VOICE = /voice="Polly\.Vicki-Neural"/;
const DE_STT = /language="de-DE"/;
const EN_STT = /language="en-GB"/;

// Aktiver DE-Inbound-Call auf der DE-Owner-Nummer (call.language="de"), der Anrufer hat
// bereits gesprochen (sonst greift der No-Speech-Zweig nicht, s. callerHasSpoken in
// claude.js) - UND ein bereits auf "en" umgestellter Tenant-Settings-Override, der fuer
// diesen laufenden Anruf wirkungslos bleiben muss.
function midCallSeed() {
  return seedState({
    settings: { language: "en" },
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
    numbers: [
      {
        id: "num_owner_de",
        e164: OWNER_TEST_NUMBER.e164,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "twilio",
        status: "active",
        country: "DE",
        language: "de",
      },
    ],
    calls: [
      seedCall({
        id: CALL_ID,
        direction: "inbound",
        language: "de",
        status: "active",
        transcript: [{ role: "caller", text: "Guten Tag" }],
      }),
    ],
  });
}

const emptyTurn = (srv) =>
  fetch(`${srv.localUrl}/voice/turn?callId=${CALL_ID}`, {
    method: "POST",
    body: new URLSearchParams({ SpeechResult: "" }),
  });

test("E2E-03 - Sprachumstellung waehrend des Anrufs laesst den laufenden Turn auf de", async () => {
  const srv = await startServer({ seed: midCallSeed() });
  try {
    const turn1 = await emptyTurn(srv);
    assert.equal(turn1.status, 200);
    const xml1 = await turn1.text();
    assert.match(xml1, DE_STT);
    assert.match(xml1, DE_VOICE);
    assert.doesNotMatch(xml1, EN_STT);

    const turn2 = await emptyTurn(srv);
    assert.equal(turn2.status, 200);
    const xml2 = await turn2.text();
    assert.match(xml2, DE_STT, "der laufende Anruf bleibt auf de, trotz settings.language=en");
    assert.match(xml2, DE_VOICE);
    assert.doesNotMatch(xml2, EN_STT);
  } finally {
    await srv.stop();
  }
});

test("E2E-03 - erst der NAECHSTE Anruf traegt die neue Sprache (en)", async () => {
  const srv = await startServer({ seed: midCallSeed() });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({
        CallSid: "CAe2e03next",
        From: "+4915112345678",
        To: OWNER_TEST_NUMBER.e164,
      }),
    });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, EN_STT, "der NEUE Anruf traegt die neue Sprache");

    const newCall = srv
      .readStore()
      .calls.find((c) => c.direction === "inbound" && c.id !== CALL_ID);
    assert.ok(newCall, "neuer Call-Record muss existieren");
    assert.equal(newCall.language, "en");
  } finally {
    await srv.stop();
  }
});
