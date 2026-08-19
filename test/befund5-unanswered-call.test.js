// Befund 5: ein AUSGEHENDER Anruf, bei dem NIEMAND abgehoben hat (Klingeln ohne Annahme,
// besetzt, abgebrochen/storniert), landet trotzdem als "completed" in der DB - ohne
// Fehlergrund. Belegt: 8 von 70 Anrufen eines Mandanten stehen so in der Datenbank.
//
// Wurzel: src/telnyx-call-control-ingest.js onHangup() setzt den Status beim Auflegen
// BEDINGUNGSLOS auf "completed" (persistEnd-Callback ruft store.endCallRecord(call.id,
// "completed") ohne jede Pruefung von call.answeredAt oder des vom Provider mitgelieferten
// Auflegegrunds) und ruft NIE store.recordFailureReason(). Der technische Auflegegrund
// (hangup_cause/hangup_source/sip_hangup_cause) kommt von Telnyx mit, geht aber schon in
// src/telephony/adapters/telnyx/call-control-events.js parseCallControlEvent() verloren -
// die Funktion liefert nur {eventType, callControlId}, diese drei Felder nie.
//
// Die funktionierende Vorlage im eigenen Haus ist der TeXML-Pfad src/routes/voice.js
// (/voice/status, ~Zeile 537-556): dort entscheidet der normalisierte callStatus
// ("completed" vs. "busy"/"no-answer"/"canceled"/"failed") sowohl ueber den gespeicherten
// Status ALS AUCH - via store.recordFailureReason(call.id, callFailureReason({status,
// diagnostics})) - ueber den Fehlergrund. callFailureReason (src/telephony/failure-reason.js)
// liefert fuer diese drei Status bereits woertlich "no-answer"/"busy"/"canceled" zurueck.
//
// DIESE DATEI BEHEBT NICHTS - Faelle 1-3 sind bewusst ROT (belegter Defekt), Fall 4 ist die
// Gegenprobe (muss schon heute bestehen, sonst wuerde ein Fix, der pauschal alles auf
// "failed" umstellt, unentdeckt bleiben).
//
// F.I.R.S.T., kein Netz/Server-Spawn: makeCallControlIngest direkt mit Fake-Store/-
// VoiceControl gefahren - dieselbe Ebene und derselbe Fake-Aufbau wie
// test/telnyx-event-ingest-machine.test.js (dortiges fakeStore/fakeVoiceControl/fakeRes),
// recordFailureReason-Set-once-Semantik nach dem Vorbild von
// test/budget-failure-reason.test.js (spyStore) bzw. dem echten Setter
// src/store/state-ops.js:634-642.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallControlIngest } from "../src/telnyx-call-control-ingest.js";
import { noopWatchdog } from "./helpers.js";

const NOOP_WATCHDOG = noopWatchdog();
// Regel 4 (Boilerplate-Konstante statt Magic Number): der HTTP-Erfolgsstatus, den
// handleCallControlEvent sofort per res.sendStatus(200) setzt (Muster im Bestand).
const HTTP_OK = 200;

// Fake-Store: haelt GENAU einen Call, spiegelt endCallRecord/recordFailureReason auf das
// Fixture-Objekt (dieselbe Referenz wird mutiert, getCall liefert danach den mutierten
// Stand - Muster telnyx-event-ingest-machine.test.js/fakeStore). "call" ist bewusst eine
// LOKALE const (nicht der Funktionsparameter selbst) - no-param-reassign(props:true)
// verbietet das Mutieren von Parameter-Properties; eine Kopie der Referenz in eine
// const umgeht das, ohne das Verhalten zu aendern (dieselbe Objekt-Referenz wird mutiert).
function fakeStore(initialCall) {
  const call = initialCall;
  const endCallRecordCalls = [];
  const recordFailureReasonCalls = [];
  return {
    endCallRecordCalls,
    recordFailureReasonCalls,
    getCall(id) {
      return call && call.id === id ? call : null;
    },
    endCallRecord(id, status) {
      endCallRecordCalls.push({ id, status });
      if (call && call.id === id) call.status = status;
    },
    // Set-once wie der echte Setter (state-ops.js recordFailureReason): ein spaeterer
    // Aufruf ueberschreibt einen bereits gesetzten Grund nicht.
    recordFailureReason(id, reason) {
      recordFailureReasonCalls.push({ id, reason });
      if (call && call.id === id && reason && !call.failureReason) call.failureReason = reason;
    },
  };
}

// Spy-freier Voice-Control-Stub: onHangup ruft ihn nie direkt auf (hangUp:null im Ingest),
// er muss nur existieren, damit die Factory keinen TypeError wirft.
function fakeVoiceControl() {
  return () => ({
    async speak() {},
    async startAssistant() {},
    async endCallViaCallControl() {},
  });
}

function fakeRes() {
  return {
    statusSent: null,
    sendStatus(code) {
      this.statusSent = code;
      return this;
    },
  };
}

// Rohes call.hangup-Event MIT den drei Auflege-Diagnosefeldern, die Telnyx tatsaechlich
// mitschickt (s. HANGUP_CAUSE_FIELDS in telnyx-call-control-ingest.js) - genau die Felder,
// die der Ingest heute NUR loggt, aber nie fuer die Status-/Fehlergrund-Entscheidung liest.
function hangupBody(callControlId, { hangupCause, hangupSource, sipHangupCause } = {}) {
  const payload = { call_control_id: callControlId };
  if (hangupCause) payload.hangup_cause = hangupCause;
  if (hangupSource) payload.hangup_source = hangupSource;
  if (sipHangupCause) payload.sip_hangup_cause = sipHangupCause;
  return { data: { event_type: "call.hangup", payload } };
}

function makeHandler(store) {
  return makeCallControlIngest({
    store,
    voiceControl: fakeVoiceControl(),
    finishCall: async () => {},
    openingText: () => "",
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
    watchdog: NOOP_WATCHDOG,
  });
}

// Fall 1 (keine Antwort): answeredAt fehlt, Telnyx meldet hangup_cause=timeout -
// LIVE belegt in tasks/befund-toolwahl-4-forensik.md Zeile 91f als genau dieses Signal
// ("hangup_cause=timeout ... sip_hangup_cause=487 = kein Antworten ... beim Ziel").
test("unbeantworteter Anruf wird nicht als completed gespeichert (keine Antwort)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", answeredAt: null };
  const store = fakeStore(call);
  const res = fakeRes();

  await makeHandler(store)(
    { query: { callId: "call_1" }, body: hangupBody("cc_1", { hangupCause: "timeout", sipHangupCause: "487" }) },
    res,
  );

  assert.equal(res.statusSent, HTTP_OK);
  assert.notEqual(store.getCall("call_1").status, "completed", "unbeantworteter Anruf darf NICHT als completed stehen");
  assert.equal(store.getCall("call_1").status, "failed", `erwartet status=failed, tatsaechlich ${store.getCall("call_1").status}`);
  assert.equal(store.getCall("call_1").failureReason, "no-answer", "Fehlergrund muss lesbar gesetzt sein (no-answer)");
});

// Fall 2 (besetzt): answeredAt fehlt, Telnyx meldet hangup_cause=user_busy (SIP 486 =
// Busy Here, der Standard-SIP-Code fuer ein besetztes Ziel).
test("unbeantworteter Anruf wird nicht als completed gespeichert (besetzt)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", answeredAt: null };
  const store = fakeStore(call);
  const res = fakeRes();

  await makeHandler(store)(
    { query: { callId: "call_1" }, body: hangupBody("cc_1", { hangupCause: "user_busy", sipHangupCause: "486" }) },
    res,
  );

  assert.equal(res.statusSent, HTTP_OK);
  assert.notEqual(store.getCall("call_1").status, "completed", "besetzter Anruf darf NICHT als completed stehen");
  assert.equal(store.getCall("call_1").status, "failed", `erwartet status=failed, tatsaechlich ${store.getCall("call_1").status}`);
  assert.equal(store.getCall("call_1").failureReason, "busy", "Fehlergrund muss lesbar gesetzt sein (busy)");
});

// Fall 3 (abgebrochen/storniert): answeredAt fehlt, Telnyx meldet hangup_cause=
// originator_cancel + hangup_source=caller (der Anruf wurde VOR der Annahme vom
// Urheber - unserem System, z.B. per /api/calls/:id/cancel - beendet).
test("unbeantworteter Anruf wird nicht als completed gespeichert (abgebrochen/storniert)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", answeredAt: null };
  const store = fakeStore(call);
  const res = fakeRes();

  await makeHandler(store)(
    { query: { callId: "call_1" }, body: hangupBody("cc_1", { hangupCause: "originator_cancel", hangupSource: "caller" }) },
    res,
  );

  assert.equal(res.statusSent, HTTP_OK);
  assert.notEqual(store.getCall("call_1").status, "completed", "abgebrochener Anruf darf NICHT als completed stehen");
  assert.equal(store.getCall("call_1").status, "failed", `erwartet status=failed, tatsaechlich ${store.getCall("call_1").status}`);
  assert.equal(store.getCall("call_1").failureReason, "canceled", "Fehlergrund muss lesbar gesetzt sein (canceled)");
});

// Fall 4 (Gegenprobe): der Anruf WURDE angenommen (answeredAt gesetzt), Telnyx meldet einen
// normalen Gespraechsabschluss (hangup_cause=normal_clearing hangup_source=callee
// sip_hangup_cause=200 - LIVE belegtes Muster, s. tasks/gq-chain-state.md Zeile 1288).
// Muss HEUTE SCHON bestehen: ohne diesen Fall wuerde ein Fix, der pauschal jeden Hangup auf
// "failed" umstellt, unentdeckt durchgehen.
test("Gegenprobe: tatsaechlich angenommener Anruf bleibt completed ohne Fehlergrund", async () => {
  const call = {
    id: "call_1",
    status: "active",
    provider: "telnyx",
    language: "de",
    answeredAt: new Date().toISOString(),
  };
  const store = fakeStore(call);
  const res = fakeRes();

  await makeHandler(store)(
    {
      query: { callId: "call_1" },
      body: hangupBody("cc_1", { hangupCause: "normal_clearing", hangupSource: "callee", sipHangupCause: "200" }),
    },
    res,
  );

  assert.equal(res.statusSent, HTTP_OK);
  assert.equal(store.getCall("call_1").status, "completed", "angenommener Anruf muss completed bleiben");
  assert.ok(!store.getCall("call_1").failureReason, "angenommener Anruf darf KEINEN Fehlergrund bekommen");
});

// Fall 5 (tragende Invariante, unbekannte Ursache): answeredAt fehlt, Telnyx meldet einen
// Auflegegrund, den KEIN Umsetzer kennt (erkennbar fremder Wert). Die Invariante "kein
// answered_at -> niemals completed" darf nicht an der Vollstaendigkeit einer Ursachen-
// Zuordnungstabelle haengen - eine Reklassifikation, die nur die drei belegten Ursachen
// (timeout/user_busy/originator_cancel) abdeckt, faellt bei jeder vierten Ursache auf das
// alte "completed"-Verhalten zurueck. failureReason wird bewusst NUR auf "lesbar gesetzt"
// (nicht-leerer String) geprueft, nicht auf einen exakten Token - der Umsetzer fuer eine
// unbekannte Ursache ist per Definition nicht in der Selbstbeschreibungs-Liste
// (SELF_DESCRIBING_FAILURES) aus src/telephony/failure-reason.js enthalten.
test("unbeantworteter Anruf wird nicht als completed gespeichert (unbekannter Auflegegrund)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", answeredAt: null };
  const store = fakeStore(call);
  const res = fakeRes();

  await makeHandler(store)(
    { query: { callId: "call_1" }, body: hangupBody("cc_1", { hangupCause: "some_unmapped_cause" }) },
    res,
  );

  assert.equal(res.statusSent, HTTP_OK);
  const stored = store.getCall("call_1");
  assert.notEqual(stored.status, "completed", `unbekannter Auflegegrund darf NICHT als completed stehen, tatsaechlich ${stored.status}`);
  assert.equal(typeof stored.failureReason, "string", `Fehlergrund muss ein lesbarer String sein, tatsaechlich ${typeof stored.failureReason}`);
  assert.ok(stored.failureReason.length > 0, "Fehlergrund darf nicht leer sein");
});

// Fall 6 (tragende Invariante, GAR KEIN Auflegegrund): answeredAt fehlt, Telnyx liefert
// call.hangup OHNE jedes der drei Diagnosefelder (hangup_cause/hangup_source/
// sip_hangup_cause fehlen komplett - der defensive Fall, der IMMER moeglich ist, wenn der
// Provider aus welchem Grund auch immer weniger liefert als dokumentiert). Auch hier darf
// das Fehlen der Ursachen-Information die Invariante nicht aushebeln.
test("unbeantworteter Anruf wird nicht als completed gespeichert (Provider meldet gar keinen Auflegegrund)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", answeredAt: null };
  const store = fakeStore(call);
  const res = fakeRes();

  await makeHandler(store)({ query: { callId: "call_1" }, body: hangupBody("cc_1") }, res);

  assert.equal(res.statusSent, HTTP_OK);
  const stored = store.getCall("call_1");
  assert.notEqual(stored.status, "completed", `fehlender Auflegegrund darf NICHT als completed stehen, tatsaechlich ${stored.status}`);
  assert.equal(typeof stored.failureReason, "string", `Fehlergrund muss ein lesbarer String sein, tatsaechlich ${typeof stored.failureReason}`);
  assert.ok(stored.failureReason.length > 0, "Fehlergrund darf nicht leer sein");
});

// Fall 7 (Befund A, Nachfassrunde - Clean-Code-Review G26): der Anruf-Datensatz traegt den
// Schluessel `answeredAt` GAR NICHT (nicht einmal als null - das Feld fehlt komplett), Telnyx
// meldet hangup_cause=timeout. Die tragende Invariante ("kein answered_at -> niemals
// completed") darf nicht zwischen "answeredAt===null" und "answeredAt fehlt als Property"
// unterscheiden - sonst kann der Befund-5-Defekt unbemerkt zurueckkehren, sobald irgendein
// Aufrufer (Rehydrate, ein kuenftiger zweiter Provider-Adapter, ...) das Feld auslaesst statt
// es explizit auf null zu setzen. Erwartung ist bewusst IDENTISCH zu Fall 1 (gleicher
// hangup_cause=timeout): fehlendes Feld und explizites null muessen sich gleich verhalten.
test("unbeantworteter Anruf wird nicht als completed gespeichert (answeredAt-Feld fehlt komplett, nicht nur leer)", async () => {
  // BEWUSST ohne answeredAt-Property (kein "answeredAt: null") - genau das ist der
  // Unterschied, den dieser Testfall festnagelt.
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const res = fakeRes();

  await makeHandler(store)(
    { query: { callId: "call_1" }, body: hangupBody("cc_1", { hangupCause: "timeout", sipHangupCause: "487" }) },
    res,
  );

  assert.equal(res.statusSent, HTTP_OK);
  const stored = store.getCall("call_1");
  assert.notEqual(stored.status, "completed", `fehlendes answeredAt-Feld darf NICHT als completed stehen, tatsaechlich ${stored.status}`);
  assert.equal(stored.status, "failed", `erwartet status=failed, tatsaechlich ${stored.status}`);
  assert.equal(stored.failureReason, "no-answer", "Fehlergrund muss lesbar gesetzt sein (no-answer), wie bei answeredAt: null");
});

// Fall 8 (Befund B, Nachfassrunde - Gegner-Review, Race zwischen call.answered und
// call.hangup): answeredAt fehlt (null - der Zeitstempel-Webhook kam nie oder zu spaet),
// ABER Telnyx meldet hangup_cause=normal_clearing - LIVE belegtes Muster fuer eine Leitung,
// die stand (s. Fall 4/tasks/gq-chain-state.md Zeile 1288). Ein widerspruechlicher Beleg
// (kein Zeitstempel, aber ein normaler Gespraechsabschluss) darf NICHT zulasten des
// Mandanten aufgeloest werden: die wahrscheinlichere Erklaerung ist ein verlorener/
// verspaeteter call.answered-Webhook, nicht ein nie zustande gekommener Anruf. Sonst wird
// ein ECHT GEFUEHRTES Gespraech dauerhaft als gescheitert gebucht (falsche Benachrichtigung,
// 0 abgerechnete Minuten). Erwartung spiegelt die Gegenprobe (Fall 4): completed bleibt
// completed, kein Fehlergrund.
test("Gegenprobe (Race): normal beendeter Anruf ohne answeredAt bleibt completed, kein Fehlergrund", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", answeredAt: null };
  const store = fakeStore(call);
  const res = fakeRes();

  await makeHandler(store)(
    { query: { callId: "call_1" }, body: hangupBody("cc_1", { hangupCause: "normal_clearing" }) },
    res,
  );

  assert.equal(res.statusSent, HTTP_OK);
  const stored = store.getCall("call_1");
  assert.equal(stored.status, "completed", `widerspruechlicher Beleg (kein answeredAt, aber normal_clearing) darf nicht zu failed fuehren, tatsaechlich ${stored.status}`);
  assert.ok(!stored.failureReason, "bei widerspruechlichen Belegen darf KEIN Fehlergrund gesetzt werden");
});
