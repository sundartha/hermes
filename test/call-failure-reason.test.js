// CDF1 (Report #2 5.4): Unit-Test des provider-agnostischen Reason-Mappers
// callFailureReason. Pure-Import (kein Top-Level-IO) -> direkt testbar. Pinnt die
// Token-Form + die Grenzfaelle (T5) + die PII-Freiheit (Output ist immer ein kurzes Token).
import { test } from "node:test";
import assert from "node:assert/strict";
import { callFailureReason } from "../src/telephony/failure-reason.js";

test("completed/leer/aktiv -> null (kein Fehlergrund)", () => {
  assert.equal(callFailureReason({ status: "completed" }), null);
  assert.equal(callFailureReason({}), null);
  assert.equal(callFailureReason({ status: undefined }), null);
  assert.equal(callFailureReason(), null);
});

test("selbstsprechende Status: Status gewinnt vor SIP-Cause (Spec-Beispiel)", () => {
  // no-answer + sipHangupCause=487 -> "no-answer" (Status gewinnt, NICHT failed:487).
  assert.equal(
    callFailureReason({ status: "no-answer", diagnostics: { sipHangupCause: "487" } }),
    "no-answer",
  );
  assert.equal(callFailureReason({ status: "busy" }), "busy");
  assert.equal(callFailureReason({ status: "canceled" }), "canceled");
});

test("generisches failed: SIP-Cause verfeinert -> failed:<sipcause>", () => {
  assert.equal(
    callFailureReason({ status: "failed", diagnostics: { sipHangupCause: "503" } }),
    "failed:503",
  );
});

test("failed ohne SIP-Cause -> nacktes failed", () => {
  assert.equal(callFailureReason({ status: "failed" }), "failed");
  assert.equal(callFailureReason({ status: "failed", diagnostics: {} }), "failed");
});

test("unbekannter Nicht-completed-Status -> defensiver Passthrough", () => {
  assert.equal(callFailureReason({ status: "ringing" }), "ringing");
});

test("PII-frei: nur ein kurzes Token, KEIN Durchreichen von hangupSource/callDurationS", () => {
  const reason = callFailureReason({
    status: "failed",
    diagnostics: { sipHangupCause: "603", hangupSource: "callee", callDurationS: 12 },
  });
  assert.equal(reason, "failed:603");
  assert.equal(typeof reason, "string");
  assert.ok(!reason.includes("callee"), "hangupSource leakt nicht in den Grund");
  assert.ok(!reason.includes("12"), "callDurationS leakt nicht in den Grund");
});
