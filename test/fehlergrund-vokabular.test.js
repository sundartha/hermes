// OUTBOUND-E2 (F1, Regressionsfang Ausfall 27.08.2026): EIN Fehlervokabular ueber alle
// Engines, getrennt nach SCHULD. Diese Suite pinnt den Klassifizierer
// (src/telephony/failure-reason.js) selbst - rein, ohne Netz/Store/Log, ohne echten Anruf.
//
// Der zentrale Regressionsfang: die gemessene 403-Antwort vom 27.08.2026 (unsere
// Absendernummer gehoerte dem Telnyx-Konto nicht mehr) muss auf eine ANDERE Klasse
// aufloesen als der Bestandsfund SIP-404 (der Tippfehler eines Nutzers) - genau die
// Vermischung, die bis heute bestand (beide Faelle trugen dasselbe Label,
// call_duration_secs_zero_not_answered).
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (package.json
// config.i18nCatalogPattern / config.abnahmePattern), sonst landen sie in der falschen
// Testbank (Lehre catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAILURE_REASON_BASE_TOKENS,
  NOT_PLACED,
  POLL_TIMEOUT_REASON,
  RESULT_UNKNOWN,
  UNREACHABLE,
  failureReasonBase,
  pollProviderErrorReason,
  providerErrorReason,
  startRejectionReason,
} from "../src/telephony/failure-reason.js";
import {
  CONVERSATION_FAILED_INVALID_DESTINATION,
  CONVERSATION_FAILED_UNVERIFIED_ORIGINATION,
} from "./fixtures/elevenlabs-conversations.js";

// HTTP-/SIP-Zahlen als benannte Konstanten (no-magic-numbers gilt auch in test/**).
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_NOT_FOUND = 404;
const SIP_NOT_ACCEPTABLE_HERE = 488;

// Reserviertes Rufnummern-Testbereich (RFC 5735/ITU-Konvention des Bestands, Muster
// test/fixtures/elevenlabs-conversations.js "***2163#..."): +1 202 555 0143 ist eine
// fiktive, offiziell reservierte US-Beispielnummer, keine echte Zuteilung.
const EINGEBETTETE_TESTNUMMER = "+12025550143";

test("REGRESSIONSFANG 27.08.2026: die gemessene 403-Antwort ergibt not-placed:invite-403-D51", () => {
  const { error } = CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata;
  assert.equal(providerErrorReason(error), "not-placed:invite-403-D51");
  // error_type wird BEWUSST NICHT gelesen (nicht Teil der veroeffentlichten Anbieter-
  // Schemazusicherung) - dieselbe Antwort ohne das Feld ergibt dasselbe Token.
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
  assert.equal(startRejectionReason(undefined), null, "kein providerStatus -> kein erfundener Grund");
  assert.equal(startRejectionReason("nonsense"), null, "kein Fremdtext als Zahl missverstehen");
  assert.equal(POLL_TIMEOUT_REASON, "result-unknown:poll-timeout");
  assert.equal(pollProviderErrorReason(HTTP_NOT_FOUND), "result-unknown:poll-provider-404");
  // Unbekannter SIP-Code faellt fail-closed auf RESULT_UNKNOWN, statt eine ungemessene
  // Schuldzuweisung zu erfinden.
  assert.equal(
    providerErrorReason({ code: SIP_NOT_ACCEPTABLE_HERE, reason: "sip status: 488: Not Acceptable Here" }),
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
  assert.ok(!token.includes("2025550143"), "die eingebettete Rufnummer darf im Token nicht auftauchen");
  assert.ok(!token.includes("+"), "kein E.164-Praefix im Token");
  // Form-Whitelist: nur Basis, Quelle, 3-stellige Zahl/„timeout“, optional Carrier-Kuerzel.
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
    [NOT_PLACED, UNREACHABLE, RESULT_UNKNOWN, "no-answer", "busy", "canceled", "failed"].every((token) =>
      FAILURE_REASON_BASE_TOKENS.includes(token),
    ),
    "die vier Bestands- und die drei neuen Basis-Token muessen alle in der Menge stehen",
  );
  assert.equal(
    new Set(FAILURE_REASON_BASE_TOKENS).size,
    FAILURE_REASON_BASE_TOKENS.length,
    "keine Duplikate in der Basis-Token-Menge",
  );
});
