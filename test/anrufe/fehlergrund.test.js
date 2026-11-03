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
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

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
  const ohneErrorType = Object.fromEntries(
    Object.entries(error).filter(([schluessel]) => schluessel !== "error_type"),
  );
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

const AT_CAPACITY = "at-capacity";
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_CLIENT_ERROR_FIRST = 400;
const HTTP_CLIENT_ERROR_LAST = 499;
const HTTP_SERVER_ERROR_FIRST = 500;
const HTTP_SERVER_ERROR_LAST = 599;
const HTTP_OK = 200;
const SIP_UNAUTHORIZED = 401;
const SIP_PROXY_AUTH_REQUIRED = 407;
const SIP_SERVICE_UNAVAILABLE = 503;
const SIP_LETZTER_SERVERFEHLER = 599;
const TELNYX_CODE = "D45";
const STATUS_WARTEZEIT_MS = 8000;

const KANALGRENZE_IM_TEXT = ["Channel limit exceeded", "channel limit", "CHANNEL LIMIT"];
const KANALGRENZE_ALS_TOKEN = ["channel_limit", "channel-limit", "Channel_Limit", "CHANNEL-LIMIT"];
const KANALGRENZE_ALLE_SCHREIBWEISEN = [...KANALGRENZE_IM_TEXT, ...KANALGRENZE_ALS_TOKEN];
const KONFIGURATIONS_UND_SERVERABBRUECHE = [
  SIP_UNAUTHORIZED,
  SIP_FORBIDDEN,
  SIP_PROXY_AUTH_REQUIRED,
  SIP_SERVER_ERROR,
  SIP_SERVICE_UNAVAILABLE,
  SIP_LETZTER_SERVERFEHLER,
];

const elevenLabsAbbruch = (sip, text) => ({
  ...CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata.error,
  code: sip,
  reason: `unexpected status from INVITE response: sip status: ${sip}: ${text} ${TELNYX_CODE} (SIP ${sip})`,
});
const telnyxAbbruch = (diagnostics) => callFailureReason({ status: "failed", diagnostics });

test("Anrufstart mit HTTP 429: der Anbieter ist ausgelastet, nicht falsch konfiguriert", () => {
  assert.equal(
    startRejectionReason(HTTP_TOO_MANY_REQUESTS),
    "at-capacity:start-429",
    "startRejectionReason(429) liefert at-capacity:start-429",
  );
  assert.equal(failureReasonBase(startRejectionReason(HTTP_TOO_MANY_REQUESTS)), AT_CAPACITY);
});

test("ElevenLabs meldet eine Kanalgrenze im SIP-Abbruch: at-capacity mit SIP- und Telnyx-Code", () => {
  for (const sip of [SIP_UNAUTHORIZED, SIP_FORBIDDEN, SIP_PROXY_AUTH_REQUIRED]) {
    for (const text of KANALGRENZE_ALLE_SCHREIBWEISEN) {
      assert.equal(
        providerErrorReason(elevenLabsAbbruch(sip, text)),
        `at-capacity:invite-${sip}-${TELNYX_CODE}`,
        `SIP ${sip} mit „${text}“`,
      );
    }
  }
  assert.equal(
    providerErrorReason({ code: HTTP_TOO_MANY_REQUESTS, reason: "channel limit reached" }),
    "result-unknown:provider-429",
    "ohne SIP-Status im reason bleibt der Grund unveraendert",
  );
});

test("Telnyx meldet failed mit Kanalgrenze als Auflegegrund: at-capacity, mit SIP-Code nur wenn er vorliegt", () => {
  for (const merkmal of KANALGRENZE_ALS_TOKEN) {
    assert.equal(
      telnyxAbbruch({ sipHangupCause: String(SIP_FORBIDDEN), hangupCause: merkmal }),
      "at-capacity:invite-403",
      `SIP 403 mit ${merkmal}`,
    );
    assert.equal(telnyxAbbruch({ hangupCause: merkmal }), "at-capacity:invite", `ohne SIP mit ${merkmal}`);
  }
  for (const sip of [SIP_UNAUTHORIZED, SIP_PROXY_AUTH_REQUIRED]) {
    assert.equal(
      telnyxAbbruch({ sipHangupCause: String(sip), hangupCause: "channel_limit" }),
      `at-capacity:invite-${sip}`,
    );
  }
});

test("[NIE1] ohne Kanalgrenzen-Merkmal bleibt jeder Konfigurations- und Serverabbruch not-placed, auch bei 403", () => {
  assert.equal(
    providerErrorReason(CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata.error),
    "not-placed:invite-403-D51",
  );
  assert.equal(
    providerErrorReason({ code: SIP_SERVICE_UNAVAILABLE, reason: "sip status: 503: Service Unavailable" }),
    "not-placed:invite-503",
  );
  for (const sip of KONFIGURATIONS_UND_SERVERABBRUECHE) {
    assert.equal(
      providerErrorReason(elevenLabsAbbruch(sip, "Forbidden")),
      `not-placed:invite-${sip}-${TELNYX_CODE}`,
    );
    assert.equal(telnyxAbbruch({ sipHangupCause: String(sip) }), `not-placed:invite-${sip}`);
    assert.equal(
      telnyxAbbruch({ sipHangupCause: String(sip), hangupCause: "call_rejected" }),
      `not-placed:invite-${sip}`,
    );
  }
  assert.notEqual(
    failureReasonBase(providerErrorReason({ code: SIP_FORBIDDEN, reason: "Forbidden" })),
    AT_CAPACITY,
    "der Code 403 allein ist nie eine Kanalgrenze",
  );
});

test("[NIE1] ein Auflegegrund, der kein Text ist, traegt kein Kanalgrenzen-Merkmal: der 403 bleibt not-placed", () => {
  const keinText = [["channel_limit"], { toString: () => "channel_limit" }];
  for (const hangupCause of keinText) {
    assert.equal(
      telnyxAbbruch({ sipHangupCause: String(SIP_FORBIDDEN), hangupCause }),
      "not-placed:invite-403",
      `hangupCause ${JSON.stringify(hangupCause)}`,
    );
    assert.equal(
      telnyxAbbruch({ hangupCause }),
      "failed",
      `ohne SIP: ${JSON.stringify(hangupCause)}`,
    );
  }
});

test("[NIE2] beim Anrufstart ist nur HTTP 429 ausgelastet: andere 4xx bleiben not-placed, 5xx result-unknown", () => {
  for (let code = HTTP_CLIENT_ERROR_FIRST; code <= HTTP_CLIENT_ERROR_LAST; code += 1) {
    if (code === HTTP_TOO_MANY_REQUESTS) continue;
    assert.equal(startRejectionReason(code), `not-placed:start-${code}`);
  }
  for (let code = HTTP_SERVER_ERROR_FIRST; code <= HTTP_SERVER_ERROR_LAST; code += 1) {
    assert.equal(startRejectionReason(code), `result-unknown:start-${code}`);
  }
});

test("[NIE3] at-capacity ist ein eigenes Basis-Token in FAILURE_REASON_BASE_TOKENS", () => {
  assert.ok(
    FAILURE_REASON_BASE_TOKENS.includes(AT_CAPACITY),
    "at-capacity fehlt in FAILURE_REASON_BASE_TOKENS",
  );
  assert.equal(failureReasonBase("at-capacity:invite-403"), AT_CAPACITY);
});

const TELNYX_STATUSMELDUNGEN = [
  {
    id: "kanalgrenze_mit_sip",
    felder: { SipHangupCause: "403", HangupCause: "channel_limit" },
    grund: "at-capacity:invite-403",
  },
  { id: "kanalgrenze_ohne_sip", felder: { HangupCause: "channel_limit" }, grund: "at-capacity:invite" },
  {
    id: "kanalgrenze_mit_leerzeichen",
    felder: { SipHangupCause: "403", HangupCause: "channel limit" },
    grund: "not-placed:invite-403",
  },
];

const gruendeDerStatusmeldungen = (stand) =>
  Object.fromEntries(
    TELNYX_STATUSMELDUNGEN.map(({ id }) => [id, stand.calls.find((anruf) => anruf.id === id)?.failureReason]),
  );

test("[NIE4] POST /voice/status mit channel_limit traegt at-capacity, ein Auflegegrund mit Leerzeichen kommt nie an", async () => {
  const srv = await startServer({
    seed: seedState({ calls: TELNYX_STATUSMELDUNGEN.map(({ id }) => seedCall({ id, provider: "telnyx" })) }),
  });
  try {
    for (const { id, felder } of TELNYX_STATUSMELDUNGEN) {
      const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, {
        method: "POST",
        body: new URLSearchParams({ CallStatus: "failed", ...felder }),
      });
      assert.equal(antwort.status, HTTP_OK, id);
    }
    const stand = await waitForStoreState(
      srv,
      (st) => Object.values(gruendeDerStatusmeldungen(st)).every(Boolean),
      STATUS_WARTEZEIT_MS,
    );
    assert.deepEqual(
      gruendeDerStatusmeldungen(stand),
      Object.fromEntries(TELNYX_STATUSMELDUNGEN.map(({ id, grund }) => [id, grund])),
    );
  } finally {
    await srv.stop();
  }
});

test("[NIE5] das Merkmal deutet nur not-placed um: 486 bleibt unreachable, 503 wird at-capacity, auf beiden Wegen gleich", () => {
  for (const merkmal of KANALGRENZE_ALLE_SCHREIBWEISEN) {
    assert.equal(
      providerErrorReason(elevenLabsAbbruch(SIP_BUSY_HERE, merkmal)),
      `unreachable:invite-486-${TELNYX_CODE}`,
      `ElevenLabs 486 mit „${merkmal}“`,
    );
    assert.equal(
      telnyxAbbruch({ sipHangupCause: String(SIP_BUSY_HERE), hangupCause: merkmal }),
      "unreachable:invite-486",
      `Telnyx 486 mit „${merkmal}“`,
    );
    assert.equal(
      providerErrorReason(elevenLabsAbbruch(SIP_SERVICE_UNAVAILABLE, merkmal)),
      `at-capacity:invite-503-${TELNYX_CODE}`,
      `ElevenLabs 503 mit „${merkmal}“`,
    );
    assert.equal(
      telnyxAbbruch({ sipHangupCause: String(SIP_SERVICE_UNAVAILABLE), hangupCause: merkmal }),
      "at-capacity:invite-503",
      `Telnyx 503 mit „${merkmal}“`,
    );
  }
});
