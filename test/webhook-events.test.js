// P4: WebhookEvents (Port 5) - Charakterisierungs-/Dichtheits-Tests. Rein, offline,
// KEIN Server-Spawn, KEIN pglite. Pinnt Twilio- und Telnyx-Parsing byte-identisch zum
// vorherigen server.js-Verhalten (extractSpeech/extractLifecycleEvent/extractSpeakOutcome)
// + den Registry-Dispatch (Port 5, analog voiceControl/messaging).
import { test } from "node:test";
import assert from "node:assert/strict";
import { twilioWebhookEvents } from "../src/telephony/adapters/twilio/webhook-events.js";
import { telnyxWebhookEvents } from "../src/telephony/adapters/telnyx/webhook-events.js";
import { webhookEvents } from "../src/telephony/registry.js";
import { SPEAK_OUTCOME } from "../src/telephony/adapters/telnyx/speak-events.js";
import { DEFAULT_PROVIDER, PROVIDER } from "../src/store/defaults.js";

// ---- Twilio ----
test("Twilio parseSpeechResult: SpeechResult getrimmt, fehlend -> \"\"", () => {
  assert.equal(twilioWebhookEvents.parseSpeechResult({ SpeechResult: "hallo " }), "hallo");
  assert.equal(twilioWebhookEvents.parseSpeechResult({}), "");
});

test("Twilio parseLifecycleEvent: diagnostics immer leer (keine Telnyx-Diagnose-Felder)", () => {
  assert.deepEqual(
    twilioWebhookEvents.parseLifecycleEvent({ CallStatus: "completed", CallDuration: "45", HangupCause: "x" }),
    { status: "completed", diagnostics: {} },
  );
});

test("Twilio parseSpeakOutcome: immer NONE (kennt keine Speak-Command-Events)", () => {
  assert.deepEqual(twilioWebhookEvents.parseSpeakOutcome({}), { outcome: SPEAK_OUTCOME.NONE, reason: null });
});

// ---- Telnyx ----
test("Telnyx parseSpeechResult: Transcript hat Vorrang vor SpeechResult, sonst Fallback", () => {
  assert.equal(telnyxWebhookEvents.parseSpeechResult({ Transcript: "a", SpeechResult: "b" }), "a");
  assert.equal(telnyxWebhookEvents.parseSpeechResult({ SpeechResult: "b" }), "b");
  assert.equal(telnyxWebhookEvents.parseSpeechResult({}), "");
});

test("Telnyx parseLifecycleEvent: CallDuration + Hangup-Diagnose PII-frei, sanitisiert", () => {
  assert.deepEqual(
    telnyxWebhookEvents.parseLifecycleEvent({
      CallStatus: "completed",
      CallDuration: "45",
      HangupCause: "normal_clearing",
      HangupSource: "caller",
      SipHangupCause: "200",
    }),
    {
      status: "completed",
      diagnostics: { callDurationS: 45, hangupCause: "normal_clearing", hangupSource: "caller", sipHangupCause: "200" },
    },
  );
});

test("Telnyx parseLifecycleEvent: Garbage-CallDuration -> kein callDurationS-Feld", () => {
  const out = telnyxWebhookEvents.parseLifecycleEvent({ CallStatus: "completed", CallDuration: "abc" });
  assert.deepEqual(out, { status: "completed", diagnostics: {} });
});

test("Telnyx parseLifecycleEvent: unsauberes HangupCause (Leerzeichen/zu lang) -> kein Feld (SAFE_CAUSE_TOKEN)", () => {
  const out = telnyxWebhookEvents.parseLifecycleEvent({
    CallStatus: "completed",
    HangupCause: "free text with spaces",
  });
  assert.equal(out.diagnostics.hangupCause, undefined);
  const tooLong = telnyxWebhookEvents.parseLifecycleEvent({
    CallStatus: "completed",
    HangupCause: "x".repeat(49),
  });
  assert.equal(tooLong.diagnostics.hangupCause, undefined);
});

test("Telnyx parseSpeakOutcome: Delegation an parseSpeakEvent (call.speak.failed-Envelope)", () => {
  const ev = { data: { event_type: "call.speak.failed", payload: { status: "failed" } } };
  assert.deepEqual(telnyxWebhookEvents.parseSpeakOutcome(ev), { outcome: SPEAK_OUTCOME.FAILED, reason: "failed" });
});

// ---- Registry-Dispatch (Port 5, analog voiceControl/messaging) ----
// C-P1b: der arg-lose Zweig folgt DEFAULT_PROVIDER statt einem eigenen Twilio-Literal.
// Diese Stelle war die gefaehrlichste der fuenf: routes/voice.js:398 reicht `call.provider`
// roh durch - bei einem Call ohne Provider-Feld griff der Parameter-Default und lieferte
// Twilio, waehrend derselbe Fall in /voice/status ueber DEFAULT_PROVIDER auf Telnyx lief.
test("webhookEvents(): kein Arg -> DEFAULT_PROVIDER (kein eigener Anbieter-Default)", () => {
  assert.equal(webhookEvents(), webhookEvents(DEFAULT_PROVIDER));
});

test("webhookEvents('telnyx') -> telnyxWebhookEvents; webhookEvents('twilio') -> twilioWebhookEvents", () => {
  assert.equal(webhookEvents(PROVIDER.TELNYX), telnyxWebhookEvents);
  assert.equal(webhookEvents(PROVIDER.TWILIO), twilioWebhookEvents);
});
