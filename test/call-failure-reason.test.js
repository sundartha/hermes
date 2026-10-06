import { test } from "node:test";
import assert from "node:assert/strict";
import { callFailureReason, failureReasonBase, providerErrorReason } from "../src/telephony/failure-reason.js";

const SIP_FORBIDDEN = 403;
const SIP_NOT_FOUND = 404;
const SIP_BUSY_HERE = 486;
const SIP_DECLINE = 603;
const SIP_SERVER_ERROR = 500;

test("completed/leer/aktiv -> null (kein Fehlergrund)", () => {
  assert.equal(callFailureReason({ status: "completed" }), null);
  assert.equal(callFailureReason({}), null);
  assert.equal(callFailureReason({ status: undefined }), null);
  assert.equal(callFailureReason(), null);
});

test("selbstsprechende Status: Status gewinnt vor SIP-Cause (Spec-Beispiel)", () => {
  assert.equal(
    callFailureReason({ status: "no-answer", diagnostics: { sipHangupCause: "487" } }),
    "no-answer",
  );
  assert.equal(callFailureReason({ status: "busy" }), "busy");
  assert.equal(callFailureReason({ status: "canceled" }), "canceled");
});

test("generisches failed: numerischer SIP-Code klassifiziert nach Schuld (sipBase)", () => {
  assert.equal(
    callFailureReason({ status: "failed", diagnostics: { sipHangupCause: "503" } }),
    "not-placed:invite-503",
  );
});

test("generisches failed: nicht-numerischer Auflegegrund bleibt unklassifiziertes Detail", () => {
  assert.equal(
    callFailureReason({ status: "failed", diagnostics: { sipHangupCause: "normal_clearing" } }),
    "failed:normal_clearing",
  );
});

test("failed ohne SIP-Cause -> nacktes failed", () => {
  assert.equal(callFailureReason({ status: "failed" }), "failed");
  assert.equal(callFailureReason({ status: "failed", diagnostics: {} }), "failed");
});

test("unbekannter Nicht-completed-Status -> defensiver Passthrough", () => {
  assert.equal(callFailureReason({ status: "ringing" }), "ringing");
});

test("S2-1: derselbe SIP-Code traegt auf dem Lifecycle-Weg (TeXML) und dem EL-Weg dieselbe Schuldklasse", () => {
  for (const sip of [SIP_FORBIDDEN, SIP_NOT_FOUND, SIP_BUSY_HERE, SIP_DECLINE, SIP_SERVER_ERROR]) {
    const lifecycleReason = callFailureReason({ status: "failed", diagnostics: { sipHangupCause: String(sip) } });
    const elReason = providerErrorReason({ code: sip, reason: `sip status: ${sip}` });
    assert.equal(
      failureReasonBase(lifecycleReason),
      failureReasonBase(elReason),
      `SIP ${sip}: Lifecycle-Basis (${failureReasonBase(lifecycleReason)}) != EL-Basis (${failureReasonBase(elReason)})`,
    );
  }
});

test("PII-frei: nur ein kurzes Token, KEIN Durchreichen von hangupSource/callDurationS", () => {
  const reason = callFailureReason({
    status: "failed",
    diagnostics: { sipHangupCause: "603", hangupSource: "callee", callDurationS: 12 },
  });
  assert.equal(reason, "unreachable:invite-603");
  assert.equal(typeof reason, "string");
  assert.ok(!reason.includes("callee"), "hangupSource leakt nicht in den Grund");
  assert.ok(!reason.includes("12"), "callDurationS leakt nicht in den Grund");
});
