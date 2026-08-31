// OUTBOUND-E2 (F1): der bestehende catch im Anruf-Start-Pfad (src/routes/api-calls.js)
// umschliesst ALLE DREI Engine-Zweige (EL/Call-Control/TeXML) - dieser Test faehrt bewusst
// den TeXML-Telnyx-Zweig (kein ElevenLabs-Flag gesetzt), um zu belegen, dass die Luecke
// (kein Fehlergrund bei einer Start-Ablehnung) NIE EL-spezifisch war (bindende Vorgabe 8).
//
// Reiner Spawn (startServer), Muster test/cq-p8-briefing-http.test.js#startVoiceMock: der
// lokale Telnyx-TeXML-Mock antwortet HTTP 403 mit einem echten Telnyx-Fehler-Envelope
// (adapters/telnyx/errors.js liest {errors:[{code,title}]}), statt einen echten Anruf
// auszuloesen.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";
import { FAILURE_REASON_TEXTS } from "../src/i18n/failure-reason-texts.js";

const TO = "+4915112345678"; // erlaubtes Ziel, kein Premium/Notruf
const TELNYX_PROVIDER_STATUS = 403;
const HTTP_UPSTREAM_ERROR = 502;
const BESTANDSTEXT_MUSTER = /\(Status: failed\)$/;

// Lokaler Telnyx-TeXML-Mock, der die Ablehnung vom 27.08.2026 nachstellt: HTTP 403 mit
// einem echten Telnyx-Fehler-Envelope (Form belegt: src/telephony/adapters/telnyx/
// errors.js#telnyxErrorEnvelope liest {errors:[{code,title,detail}]}).
async function startFailingVoiceMock() {
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(TELNYX_PROVIDER_STATUS, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ code: "90003", title: "Forbidden" }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const TELNYX_OWNER = { e164: "+13125550100", provider: "telnyx" };
const telnyxEnv = (voiceMockUrl) => ({
  TELNYX_API_KEY: "KEYtest-secret",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_ACCOUNT_SID: "acct_test",
  TELNYX_API_BASE: voiceMockUrl,
});

function placeCall(srv) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren" }),
  });
}

// Basis-Token "not-placed" -> Phrase der aufgeloesten Sprache des Anrufs, mit demselben
// Rueckfall wie localeFor (unbekannte/fehlende Sprache -> en). Flach gehalten (kein
// verketteter Zugriff ueber vier Gliedern, G36).
function notPlacedPhraseFor(language) {
  const bundle = FAILURE_REASON_TEXTS[language] || FAILURE_REASON_TEXTS.en;
  return bundle.phrases["not-placed"];
}

test("Start-Ablehnung des Anbieters (403): der Anruf traegt den Grund, die Antwort keinen Rohtext, und die Benachrichtigung nennt den Grund", async () => {
  const voiceMock = await startFailingVoiceMock();
  const srv = await startServer({ env: telnyxEnv(voiceMock.url), ownerNumber: TELNYX_OWNER });
  try {
    const res = await placeCall(srv);
    const body = await res.json();

    assert.equal(res.status, HTTP_UPSTREAM_ERROR, "Provider-Ablehnung -> kategorisierte 502-Antwort");
    assert.match(body.error, /Provider hat den Anruf abgelehnt \(HTTP 403\)/);
    assert.ok(!body.error.includes("Forbidden"), "kein Telnyx-Rohtext (title) an den Client");
    assert.ok(!body.error.includes("90003"), "kein Telnyx-Rohtext (code) an den Client");

    const outboundCalls = srv.readStore().calls.filter((entry) => entry.direction === "outbound" && entry.to === TO);
    assert.equal(outboundCalls.length, 1, "der Anruf ist trotz Ablehnung persistiert");
    const callId = outboundCalls[0].id;

    const callRes = await fetch(`${srv.localUrl}/api/calls/${callId}`);
    const call = await callRes.json();
    assert.equal(call.status, "failed");
    assert.equal(
      call.failureReason,
      "not-placed:start-403",
      "die Start-Ablehnung MUSS einen Grund tragen - auch auf dem TeXML-Weg",
    );

    // Ergebnis-Beleg (KEIN Reihenfolge-Beweis - s. Review-Blocker Runde 4 + der
    // ordnungssensitive Test unten): terminateAndBillCall haengt bill() fire-and-forget
    // an (call-termination.js), darum haengt die Position dieser Assertion an der
    // zufaelligen Ereignisschleifen-Reihenfolge des Kindprozesses, nicht an der
    // tatsaechlichen Code-Reihenfolge im catch. Das schwaechere, aber ECHTE Ergebnis
    // bleibt trotzdem pruefenswert: die persistierte Notification nennt den Grund.
    const stateRes = await fetch(`${srv.localUrl}/api/state`);
    const state = await stateRes.json();
    const notification = state.notifications.find((item) => item.callId === callId);
    assert.ok(notification, "es muss eine Benachrichtigung zu diesem Anruf geben");
    const phrase = notPlacedPhraseFor(call.language);
    assert.ok(notification.body.includes(phrase), `Notification traegt nicht die Grund-Phrase: ${notification.body}`);
    assert.ok(
      !BESTANDSTEXT_MUSTER.test(notification.body),
      `Notification darf nicht auf den grundlosen Bestandstext zurueckfallen: ${notification.body}`,
    );
  } finally {
    await srv.stop();
    await voiceMock.close();
  }
});

// ---------------- Reihenfolge-Regressionsfang: AUSGEWANDERT (OUTBOUND-E3a) ----------------
//
// Der ordnungssensitive Test, der frueher hier stand, baute die Produktionsreihenfolge im
// TEST selbst nach (recordFailureReason VOR terminateAndBillCall, von Hand getippt) - ein
// Test, der die echte Reihenfolge im Produktionscode nicht pruefte, sondern nur seine
// EIGENE Kopie davon. Clean-Code-Befund E2-B / Safety-Befund C1: bei vertauschter
// Reihenfolge im echten Code (src/routes/api-calls.js) blieb dieser Test GRUEN.
//
// OUTBOUND-E3a macht die Reihenfolge zur STRUKTUR statt zum Kommentar: der Grund wird
// INNERHALB des persistEnd-Thunks geschrieben (endFailedCallWithReason,
// src/routes/api-calls.js), und persistEnd laeuft in terminateAndBillCall garantiert VOR
// bill() (src/telephony/call-termination.js). Der Regressionsfang dafuer steht jetzt in
// test/fehlergrund-reihenfolge-riegel.test.js - er prueft den ECHTEN Produktions-Thunk
// (Laufzeit) UND die Verdrahtung im ausgelieferten Quelltext (Sabotage-Fang), statt eine
// Kopie der Reihenfolge im Test zu wiederholen.
