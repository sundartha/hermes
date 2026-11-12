import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import {
  FAILURE_REASON_BASE_TOKENS,
  callFailureReason,
  failureReasonBase,
  providerErrorReason,
  startRejectionReason,
} from "../../src/telephony/failure-reason.js";

const SIP_FORBIDDEN = 403;
const SIP_NOT_FOUND = 404;
const SIP_BUSY_HERE = 486;
const SIP_DECLINE = 603;
const SIP_SERVER_ERROR = 500;

const AUSGELASTET = "at-capacity";
const HTTP_TOO_MANY_REQUESTS = 429;
const KANALGRENZEN_SCHREIBWEISEN = ["channel limit", "channel_limit", "channel-limit", "Channel Limit", "CHANNEL_LIMIT"];
const KANALGRENZEN_TOKEN = ["channel_limit", "channel-limit", "Channel_Limit", "CHANNEL-LIMIT"];

const elAbbruch = (sip, text) => ({ code: sip, reason: `INVITE failed: sip status: ${sip}: ${text} (SIP ${sip})` });
const texmlAbbruch = (diagnostics) => callFailureReason({ status: "failed", diagnostics });

test("beim Anrufstart ist HTTP 429 eine Kanalgrenze des Anbieters: at-capacity:start-429", () => {
  assert.equal(
    startRejectionReason(HTTP_TOO_MANY_REQUESTS),
    "at-capacity:start-429",
    "startRejectionReason(429) liefert at-capacity:start-429",
  );
  assert.equal(startRejectionReason("429"), "at-capacity:start-429");
});

test("ElevenLabs meldet einen SIP-Abbruch mit Kanalgrenze: at-capacity:invite-<sip>, mit Telnyx-Code -Dnn", () => {
  for (const schreibweise of KANALGRENZEN_SCHREIBWEISEN) {
    assert.equal(
      providerErrorReason(elAbbruch(SIP_FORBIDDEN, `User ${schreibweise} exceeded`)),
      "at-capacity:invite-403",
      `Schreibweise "${schreibweise}"`,
    );
  }
  assert.equal(
    providerErrorReason(elAbbruch(SIP_FORBIDDEN, "Outbound channel limit exceeded D40")),
    "at-capacity:invite-403-D40",
  );
});

test("Telnyx (TeXML, failed) meldet eine Kanalgrenze im hangupCause: at-capacity:invite-<sip>, ohne SIP at-capacity:invite", () => {
  for (const hangupCause of KANALGRENZEN_TOKEN) {
    assert.equal(
      texmlAbbruch({ sipHangupCause: "403", hangupCause }),
      "at-capacity:invite-403",
      `hangupCause "${hangupCause}"`,
    );
    assert.equal(texmlAbbruch({ hangupCause }), "at-capacity:invite", `hangupCause "${hangupCause}" ohne SIP`);
  }
});

test("ein ausgelasteter Grund loest auf das Basis-Token at-capacity auf", () => {
  assert.equal(failureReasonBase(startRejectionReason(HTTP_TOO_MANY_REQUESTS)), AUSGELASTET);
  assert.equal(failureReasonBase(texmlAbbruch({ sipHangupCause: "403", hangupCause: "channel_limit" })), AUSGELASTET);
});

const SIP_UNAUTHORIZED = 401;
const SIP_PROXY_AUTH_REQUIRED = 407;
const SIP_SERVICE_UNAVAILABLE = 503;
const UNVERIFIED_ORIGINATION = "sip status: 403: Unverified origination number D51 (SIP 403)";

test("[NIE1] 403 ohne Kanalgrenzen-Merkmal bleibt not-placed:invite-403, bei ElevenLabs wie bei Telnyx", () => {
  assert.equal(
    providerErrorReason({ code: SIP_FORBIDDEN, reason: `INVITE failed: ${UNVERIFIED_ORIGINATION}` }),
    "not-placed:invite-403-D51",
  );
  assert.equal(providerErrorReason(elAbbruch(SIP_FORBIDDEN, "Forbidden")), "not-placed:invite-403");
  assert.equal(texmlAbbruch({ sipHangupCause: "403" }), "not-placed:invite-403");
  assert.equal(texmlAbbruch({ sipHangupCause: "403", hangupCause: "call_rejected" }), "not-placed:invite-403");
});

test("[NIE1] ohne Merkmal bleiben 401, 407 und SIP 5xx not-placed", () => {
  for (const sip of [SIP_UNAUTHORIZED, SIP_PROXY_AUTH_REQUIRED, SIP_SERVER_ERROR, SIP_SERVICE_UNAVAILABLE, 599]) {
    assert.equal(providerErrorReason(elAbbruch(sip, "Rejected")), `not-placed:invite-${sip}`, `EL SIP ${sip}`);
    assert.equal(texmlAbbruch({ sipHangupCause: String(sip) }), `not-placed:invite-${sip}`, `TeXML SIP ${sip}`);
  }
  assert.equal(
    providerErrorReason({ code: SIP_SERVICE_UNAVAILABLE, reason: "sip status: 503: Service Unavailable" }),
    "not-placed:invite-503",
  );
});

test("[NIE1] at-capacity entsteht nie allein aus dem Code 403", () => {
  const nurDerCode = [
    providerErrorReason({ code: SIP_FORBIDDEN, reason: "sip status: 403" }),
    providerErrorReason({ code: SIP_FORBIDDEN, reason: "" }),
    providerErrorReason({ code: SIP_FORBIDDEN }),
    texmlAbbruch({ sipHangupCause: "403" }),
    startRejectionReason(SIP_FORBIDDEN),
  ];
  for (const grund of nurDerCode) assert.notEqual(failureReasonBase(grund), AUSGELASTET, grund);
});

test("[NIE1] ein hangupCause, der kein Text ist, ist kein Merkmal: 403 bleibt not-placed:invite-403", () => {
  for (const hangupCause of [["channel_limit"], { toString: 1 }, 403, null]) {
    assert.equal(texmlAbbruch({ sipHangupCause: "403", hangupCause }), "not-placed:invite-403");
  }
});

test("[NIE2] beim Anrufstart bleibt jede 4xx ausser 429 not-placed:start-<code> und jede 5xx result-unknown:start-<code>", () => {
  for (const code of [400, 401, 403, 404, 408, 409, 422, 428, 430, 431, 499]) {
    assert.equal(startRejectionReason(code), `not-placed:start-${code}`, `HTTP ${code}`);
  }
  for (const code of [500, 502, 503, 504, 529, 599]) {
    assert.equal(startRejectionReason(code), `result-unknown:start-${code}`, `HTTP ${code}`);
  }
});

const SIP_TEMPORARILY_UNAVAILABLE = 480;

test("[NIE5] mit Merkmal bleibt ein unreachable-Abbruch unreachable, bei ElevenLabs wie bei Telnyx", () => {
  for (const sip of [SIP_NOT_FOUND, SIP_TEMPORARILY_UNAVAILABLE, SIP_BUSY_HERE, SIP_DECLINE]) {
    assert.equal(
      providerErrorReason(elAbbruch(sip, "channel limit")),
      `unreachable:invite-${sip}`,
      `EL SIP ${sip}`,
    );
    assert.equal(
      texmlAbbruch({ sipHangupCause: String(sip), hangupCause: "channel_limit" }),
      `unreachable:invite-${sip}`,
      `TeXML SIP ${sip}`,
    );
  }
});

test("[NIE5] mit Merkmal ist SIP 503 at-capacity:invite-503, gelesen aus reason und hangupCause mit demselben Muster", () => {
  for (const merkmal of KANALGRENZEN_TOKEN) {
    assert.equal(
      providerErrorReason(elAbbruch(SIP_SERVICE_UNAVAILABLE, `Service Unavailable ${merkmal}`)),
      "at-capacity:invite-503",
      `EL-Merkmal "${merkmal}"`,
    );
    assert.equal(
      texmlAbbruch({ sipHangupCause: "503", hangupCause: merkmal }),
      "at-capacity:invite-503",
      `TeXML-Merkmal "${merkmal}"`,
    );
  }
});


const HTTP_OK = 200;
const WARTEZEIT_MS = 8000;
const SATZ_NICHT_AUFGEBAUT = {
  de: "der Anruf konnte auf unserer Seite nicht aufgebaut werden",
  en: "the call could not be placed on our side",
  fr: "l'appel n'a pas pu être établi de notre côté",
};
const SATZ_AUSGELASTET = { de: /ausgelastet/i, en: /capacity/i, fr: /satur/i };
const SATZ_IM_TEXT = /, (?:Grund:|reason:|motif :) (.+)\)$/;

const telnyxAnruf = (id, language = "de") => seedCall({ id, provider: "telnyx", language });
let telnyxServer;

before(async () => {
  telnyxServer = await startServer({
    seed: seedState({
      calls: [
        telnyxAnruf("kg_403"),
        telnyxAnruf("kg_ohne_sip"),
        telnyxAnruf("kg_leerzeichen"),
        telnyxAnruf("kg_de"),
        telnyxAnruf("kg_en", "en"),
        telnyxAnruf("kg_fr", "fr"),
      ],
    }),
  });
});

after(async () => {
  await telnyxServer?.stop();
});

async function meldeStatus(id, felder) {
  const antwort = await abrufMitFrist(`${telnyxServer.localUrl}/voice/status?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ CallStatus: "failed", ...felder }),
  });
  assert.equal(antwort.status, HTTP_OK);
  const stand = await waitForStoreState(
    telnyxServer,
    (st) => (st.notifications ?? []).some((eintrag) => eintrag.callId === id),
    WARTEZEIT_MS,
  );
  return {
    anruf: stand.calls.find((anruf) => anruf.id === id),
    benachrichtigung: stand.notifications.find((eintrag) => eintrag.callId === id),
  };
}

test("[NIE4] POST /voice/status mit SipHangupCause 403 und HangupCause channel_limit traegt at-capacity:invite-403", async () => {
  const { anruf } = await meldeStatus("kg_403", { SipHangupCause: "403", HangupCause: "channel_limit" });
  assert.equal(anruf.failureReason, "at-capacity:invite-403");
});

test("[NIE4] POST /voice/status mit HangupCause channel_limit ohne SipHangupCause traegt at-capacity:invite", async () => {
  const { anruf } = await meldeStatus("kg_ohne_sip", { HangupCause: "channel_limit" });
  assert.equal(anruf.failureReason, "at-capacity:invite");
});

test("[NIE4] ein HangupCause mit Leerzeichen kommt nie an, der Anruf bleibt not-placed:invite-403", async () => {
  const { anruf } = await meldeStatus("kg_leerzeichen", { SipHangupCause: "403", HangupCause: "channel limit" });
  assert.equal(anruf.failureReason, "not-placed:invite-403");
});

test("[NIE3] at-capacity hat in de, en und fr einen eigenen Satz in der Benachrichtigung", async () => {
  const faelle = [
    ["de", "kg_de"],
    ["en", "kg_en"],
    ["fr", "kg_fr"],
  ];
  for (const [sprache, id] of faelle) {
    const { anruf, benachrichtigung } = await meldeStatus(id, { SipHangupCause: "403", HangupCause: "channel_limit" });
    assert.equal(failureReasonBase(anruf.failureReason), AUSGELASTET, `${sprache}: ${anruf.failureReason}`);
    const satz = SATZ_IM_TEXT.exec(benachrichtigung.body)?.[1];
    assert.ok(satz, `${sprache}: kein Satz zum Grund in "${benachrichtigung.body}"`);
    assert.notEqual(satz, SATZ_NICHT_AUFGEBAUT[sprache], `${sprache}: Satz von not-placed`);
    assert.match(satz, SATZ_AUSGELASTET[sprache], `${sprache}: "${satz}"`);
  }
});

test("[NIE3] at-capacity ist Basis-Token der Fehlergruende", () => {
  assert.ok(FAILURE_REASON_BASE_TOKENS.includes(AUSGELASTET), "at-capacity fehlt in FAILURE_REASON_BASE_TOKENS");
});
