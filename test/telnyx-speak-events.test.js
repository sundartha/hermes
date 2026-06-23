// Pure-Unit-Tests fuer parseSpeakEvent (Telnyx-Speak-Command-Klassifikation).
// Hintergrund: das server-seitige TTS (<Say> ueber Azure-NTTS) faellt sporadisch aus
// ("speak_failed"); Telnyx meldet das als Command-Event OHNE CallStatus, das sonst im
// /voice/status-Handler stumm durchfaellt. parseSpeakEvent macht daraus ein neutrales
// Ergebnis. KEIN Netz, kein Server-Spawn (F.I.R.S.T.): reine Funktion, reine Eingaben.
//
// Geprueft wird: (a) eindeutiges Fehlsignal -> FAILED, (b) Erfolg -> OK, (c) FAIL-SAFE:
// der form-encodete Lifecycle-Callback + Unbekanntes -> NONE (Lifecycle-Pfad unberuehrt),
// (d) PII-Klemme: reason ist nie Payload-Freitext.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpeakEvent, SPEAK_OUTCOME } from "../src/telephony/adapters/telnyx/speak-events.js";

test("call.speak.failed (data-Wrapper) -> FAILED + reason 'failed'", () => {
  const ev = { data: { event_type: "call.speak.failed", payload: { status: "failed" } } };
  assert.deepEqual(parseSpeakEvent(ev), { outcome: SPEAK_OUTCOME.FAILED, reason: "failed" });
});

test("call.speak.ended mit status 'failed' -> FAILED (Azure-NTTS-Stoerung)", () => {
  const ev = { data: { event_type: "call.speak.ended", payload: { status: "failed" } } };
  assert.deepEqual(parseSpeakEvent(ev), { outcome: SPEAK_OUTCOME.FAILED, reason: "failed" });
});

test("call.speak.ended mit status 'completed' -> OK", () => {
  const ev = { data: { event_type: "call.speak.ended", payload: { status: "completed" } } };
  assert.deepEqual(parseSpeakEvent(ev), { outcome: SPEAK_OUTCOME.OK, reason: "completed" });
});

test("flache Event-Form (ohne data-Wrapper) wird ebenso erkannt -> FAILED", () => {
  const ev = { event_type: "call.speak.failed", payload: { status: "failed" } };
  assert.equal(parseSpeakEvent(ev).outcome, SPEAK_OUTCOME.FAILED);
});

test("FAIL-SAFE: form-encodeter Lifecycle-Callback (CallStatus) -> NONE", () => {
  // Genau dieser Body trifft im Bestand auf /voice/status -> darf NIE als Speak-Event
  // gewertet werden, sonst bricht der Lifecycle-Pfad (markAnswered/endCallRecord).
  const lifecycle = { CallStatus: "completed", CallDuration: "45" };
  assert.deepEqual(parseSpeakEvent(lifecycle), { outcome: SPEAK_OUTCOME.NONE, reason: null });
});

test("call.speak.started ist kein Ergebnis -> NONE (nicht handlungsrelevant)", () => {
  const ev = { data: { event_type: "call.speak.started", payload: {} } };
  assert.equal(parseSpeakEvent(ev).outcome, SPEAK_OUTCOME.NONE);
});

test("call.speak.ended ohne/unbekannten Status -> NONE (kein Fehlalarm)", () => {
  const noStatus = { data: { event_type: "call.speak.ended", payload: {} } };
  const weird = { data: { event_type: "call.speak.ended", payload: { status: "queued" } } };
  assert.equal(parseSpeakEvent(noStatus).outcome, SPEAK_OUTCOME.NONE);
  assert.equal(parseSpeakEvent(weird).outcome, SPEAK_OUTCOME.NONE);
});

test("defensive Grenzfaelle (null/leer/fremdes Event) -> NONE, kein Wurf", () => {
  for (const body of [null, undefined, {}, "kaputt", { event_type: "call.hangup" }])
    assert.deepEqual(parseSpeakEvent(body), { outcome: SPEAK_OUTCOME.NONE, reason: null });
});

test("PII-Klemme: Freitext im status leakt nie als reason (-> 'unknown')", () => {
  // call.speak.failed feuert FAILED unabhaengig vom Status; reason wird auf die
  // Allowlist geklemmt, damit kein injizierter Payload-Freitext (Name/Nummer) ins Log geht.
  const ev = {
    data: { event_type: "call.speak.failed", payload: { status: "failed; caller=+4915112345678" } },
  };
  const res = parseSpeakEvent(ev);
  assert.equal(res.outcome, SPEAK_OUTCOME.FAILED);
  assert.equal(res.reason, "unknown");
});
