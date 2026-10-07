import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAILURE_REASON_BASE_TOKENS,
  NOT_PLACED,
  POLL_TIMEOUT_REASON,
  RESULT_UNKNOWN,
  UNREACHABLE,
  callFailureReason,
  failureReasonBase,
  pollProviderErrorReason,
  providerErrorReason,
  startRejectionReason,
} from "../../src/telephony/failure-reason.js";
import {
  CONVERSATION_FAILED_INVALID_DESTINATION,
  CONVERSATION_FAILED_UNVERIFIED_ORIGINATION,
} from "../fixtures/elevenlabs-conversations.js";

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
    const lifecycleReason = callFailureReason({
      status: "failed",
      diagnostics: { sipHangupCause: String(sip) },
    });
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

const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_NOT_FOUND = 404;
const SIP_NOT_ACCEPTABLE_HERE = 488;

const EINGEBETTETE_TESTNUMMER = "+12025550143";

test("REGRESSIONSFANG 27.08.2026: die gemessene 403-Antwort ergibt not-placed:invite-403-D51", () => {
  const { error } = CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata;
  assert.equal(providerErrorReason(error), "not-placed:invite-403-D51");
  const { error_type: _ignoriert, ...ohneErrorType } = error;
  assert.equal(providerErrorReason(ohneErrorType), "not-placed:invite-403-D51");
});

test("der SIP-404-Bestandsfund ergibt unreachable:invite-404-D11 - eine ANDERE Klasse als der 403-Fall", () => {
  const token404 = providerErrorReason(CONVERSATION_FAILED_INVALID_DESTINATION.metadata.error);
  const token403 = providerErrorReason(CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata.error);
  assert.equal(token404, "unreachable:invite-404-D11");
  assert.notEqual(
    failureReasonBase(token404),
    failureReasonBase(token403),
    "der Tippfehler eines Nutzers (404) und unser Konfigurationsdefekt (403) duerfen NIE dasselbe Basis-Token tragen",
  );
});

test("die HTTP-Statusklasse entscheidet die Schuld: 4xx wir, 5xx unbekannt - beim Anrufstart wie beim Ergebnisabruf", () => {
  assert.equal(startRejectionReason(HTTP_UNPROCESSABLE), "not-placed:start-422");
  assert.equal(startRejectionReason(HTTP_SERVICE_UNAVAILABLE), "result-unknown:start-503");
  assert.equal(
    startRejectionReason(undefined),
    "result-unknown:start-no-status",
    "kein erfundener Grund, aber auch kein leeres Feld",
  );
  assert.equal(
    startRejectionReason("nonsense"),
    "result-unknown:start-no-status",
    "kein Fremdtext als Zahl missverstehen",
  );
  assert.equal(POLL_TIMEOUT_REASON, "result-unknown:poll-timeout");
  assert.equal(pollProviderErrorReason(HTTP_NOT_FOUND), "result-unknown:poll-provider-404");
  assert.equal(
    providerErrorReason({
      code: SIP_NOT_ACCEPTABLE_HERE,
      reason: "sip status: 488: Not Acceptable Here",
    }),
    "result-unknown:invite-488",
  );
});

test("PII: ein Anbieter-Grundtext mit eingebetteter Rufnummer kommt nicht durch", () => {
  const error = {
    code: HTTP_NOT_FOUND,
    reason: `INVITE failed: sip status: 404: Invalid destination number ${EINGEBETTETE_TESTNUMMER} D11 (SIP 404)`,
  };
  const token = providerErrorReason(error);
  assert.equal(token, "unreachable:invite-404-D11");
  assert.ok(
    !token.includes("2025550143"),
    "die eingebettete Rufnummer darf im Token nicht auftauchen",
  );
  assert.ok(!token.includes("+"), "kein E.164-Praefix im Token");
  assert.match(
    token,
    /^(not-placed|unreachable|result-unknown)(:(start|invite|provider|poll)(-\d{3}|-timeout|-provider(-\d{3})?)?(-D\d{2})?)?$/,
  );
});

test("failureReasonBase loest die neuen Token auf ihre Basis auf, und jedes Basis-Token ist EINE exportierte Quelle", () => {
  assert.equal(failureReasonBase("not-placed:invite-403-D51"), NOT_PLACED);
  assert.equal(failureReasonBase("unreachable:invite-404-D11"), UNREACHABLE);
  assert.equal(failureReasonBase("result-unknown:poll-timeout"), RESULT_UNKNOWN);
  assert.ok(Object.isFrozen(FAILURE_REASON_BASE_TOKENS), "die Token-Menge muss eingefroren sein");
  assert.ok(
    [NOT_PLACED, UNREACHABLE, RESULT_UNKNOWN, "no-answer", "busy", "canceled", "failed"].every(
      (token) => FAILURE_REASON_BASE_TOKENS.includes(token),
    ),
    "die vier Bestands- und die drei neuen Basis-Token muessen alle in der Menge stehen",
  );
  assert.equal(
    new Set(FAILURE_REASON_BASE_TOKENS).size,
    FAILURE_REASON_BASE_TOKENS.length,
    "keine Duplikate in der Basis-Token-Menge",
  );
});

test("SIP-Grenze 599 vs. 600 vs. 604: nur 5xx faellt fail-closed auf NOT_PLACED, 6xx auf RESULT_UNKNOWN", () => {
  const SIP_LAST_SERVER_ERROR = 599;
  const SIP_FIRST_GLOBAL_FAILURE = 600;
  const SIP_DOES_NOT_EXIST_ANYWHERE = 604;
  assert.equal(
    failureReasonBase(
      providerErrorReason({ reason: `sip status: ${SIP_LAST_SERVER_ERROR}: Server Error` }),
    ),
    NOT_PLACED,
    "599 ist der letzte belegte 5xx-Code - bleibt unsere Schuld",
  );
  assert.equal(
    failureReasonBase(
      providerErrorReason({ reason: `sip status: ${SIP_FIRST_GLOBAL_FAILURE}: Busy Everywhere` }),
    ),
    RESULT_UNKNOWN,
    "600 ist unbelegtes 6xx - fail-closed auf result-unknown, keine erfundene Schuldzuweisung",
  );
  assert.equal(
    failureReasonBase(
      providerErrorReason({
        reason: `sip status: ${SIP_DOES_NOT_EXIST_ANYWHERE}: Does Not Exist Anywhere`,
      }),
    ),
    RESULT_UNKNOWN,
    "604 ist der Zwilling von 404 (Ziel existiert nicht) - darf NICHT uns zugeschrieben werden",
  );
});
