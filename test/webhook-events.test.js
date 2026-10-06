import { test } from "node:test";
import assert from "node:assert/strict";
import { telnyxWebhookEvents } from "../src/telephony/adapters/telnyx/webhook-events.js";
import { webhookEvents } from "../src/telephony/registry.js";
import { SPEAK_OUTCOME } from "../src/telephony/adapters/telnyx/speak-events.js";
import { DEFAULT_PROVIDER, PROVIDER } from "../src/store/defaults.js";

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

test("webhookEvents(): kein Arg -> DEFAULT_PROVIDER (kein eigener Anbieter-Default)", () => {
  assert.equal(webhookEvents(), webhookEvents(DEFAULT_PROVIDER));
});

test("webhookEvents('telnyx') -> telnyxWebhookEvents; unbekannter Provider wirft fail-closed", () => {
  assert.equal(webhookEvents(PROVIDER.TELNYX), telnyxWebhookEvents);
  assert.throws(() => webhookEvents("twilio"), /nicht unterstuetzt/);
});
