import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AT_CAPACITY,
  FAILURE_REASON_BASE_TOKENS,
  NOT_PLACED,
  POLL_TIMEOUT_REASON,
  RESULT_UNKNOWN,
  UNREACHABLE,
  callFailureReason,
  failureReasonBase,
  meldetAlsNichtGestartet,
  pollProviderErrorReason,
  providerErrorReason,
  reasonWithoutCarrier,
  startRejectionReason,
} from "../../src/telephony/failure-reason.js";
import { ANSWERED_BY, classifyAnsweredBy, parseAnsweredBy } from "../../src/telephony/answered-by.ts";
import { DEDUP_WINDOW_MS, findDuplicateOutboundCall } from "../../src/telephony/call-dedup.ts";

function tabelle(name, faelle, fn) {
  for (const [eingabe, erwartet] of faelle) {
    test(`${name}: ${JSON.stringify(eingabe)}`, () => assert.equal(fn(eingabe), erwartet));
  }
}

test("Grundwerte der Ausfallgruende", () => {
  assert.equal(NOT_PLACED, "not-placed");
  assert.equal(UNREACHABLE, "unreachable");
  assert.equal(RESULT_UNKNOWN, "result-unknown");
  assert.equal(AT_CAPACITY, "at-capacity");
  assert.equal(POLL_TIMEOUT_REASON, "result-unknown:poll-timeout");
  assert.deepEqual(
    [...FAILURE_REASON_BASE_TOKENS],
    ["no-answer", "busy", "canceled", "failed", "not-placed", "unreachable", "result-unknown", "at-capacity"],
  );
  assert.ok(Object.isFrozen(FAILURE_REASON_BASE_TOKENS));
});

tabelle(
  "callFailureReason Status",
  [
    [undefined, null],
    [{}, null],
    [{ status: "" }, null],
    [{ status: "completed" }, null],
    [{ status: "no-answer" }, "no-answer"],
    [{ status: "busy" }, "busy"],
    [{ status: "canceled" }, "canceled"],
    [{ status: "in-progress" }, "in-progress"],
    [{ status: "failed" }, "failed"],
    [{ status: "failed", diagnostics: {} }, "failed"],
  ],
  callFailureReason,
);

tabelle(
  "callFailureReason SIP-Code bei failed",
  [
    [399, "failed:399"],
    [400, "result-unknown:invite-400"],
    [401, "not-placed:invite-401"],
    [403, "not-placed:invite-403"],
    [404, "unreachable:invite-404"],
    [407, "not-placed:invite-407"],
    [481, "result-unknown:invite-481"],
    [480, "unreachable:invite-480"],
    [486, "unreachable:invite-486"],
    [499, "result-unknown:invite-499"],
    [500, "not-placed:invite-500"],
    [599, "not-placed:invite-599"],
    [600, "result-unknown:invite-600"],
    [603, "unreachable:invite-603"],
    [699, "result-unknown:invite-699"],
    [700, "failed:700"],
    ["486", "unreachable:invite-486"],
    ["abc", "failed:abc"],
    ["", "failed"],
    [null, "failed"],
  ],
  (sipHangupCause) => callFailureReason({ status: "failed", diagnostics: { sipHangupCause } }),
);

tabelle(
  "callFailureReason Kanalgrenze",
  [
    [[403, "channel_limit"], "at-capacity:invite-403"],
    [[500, "Channel-Limit exceeded"], "at-capacity:invite-500"],
    [[401, "channel limit"], "at-capacity:invite-401"],
    [[486, "channel_limit"], "unreachable:invite-486"],
    [[600, "channel_limit"], "result-unknown:invite-600"],
    [[undefined, "channel_limit"], "at-capacity:invite"],
    [[undefined, "channellimit"], "failed"],
    [[undefined, 5], "failed"],
    [[403, 5], "not-placed:invite-403"],
  ],
  ([sipHangupCause, hangupCause]) =>
    callFailureReason({ status: "failed", diagnostics: { sipHangupCause, hangupCause } }),
);

tabelle(
  "failureReasonBase",
  [
    [null, null],
    [undefined, null],
    ["", null],
    ["not-placed:start-401", "not-placed"],
    ["failed", "failed"],
    ["a:b:c", "a"],
  ],
  failureReasonBase,
);

tabelle(
  "meldetAlsNichtGestartet",
  [
    ["not-placed:invite-403", true],
    ["at-capacity", true],
    ["at-capacity:start-429", true],
    ["unreachable:invite-404", false],
    ["result-unknown:poll-timeout", false],
    ["failed", false],
    [null, false],
  ],
  meldetAlsNichtGestartet,
);

tabelle(
  "reasonWithoutCarrier",
  [
    [null, null],
    ["", null],
    ["not-placed:invite-403-D12", "not-placed:invite-403"],
    ["not-placed:invite-403", "not-placed:invite-403"],
    ["x-D1", "x-D1"],
    ["x-D123", "x-D123"],
    ["D12-x", "D12-x"],
    ["a-D12b", "a-D12b"],
  ],
  reasonWithoutCarrier,
);

tabelle(
  "startRejectionReason",
  [
    [undefined, "result-unknown:start-no-status"],
    ["abc", "result-unknown:start-no-status"],
    [399, "result-unknown:start-no-status"],
    [600, "result-unknown:start-no-status"],
    [400, "not-placed:start-400"],
    [401, "not-placed:start-401"],
    ["404", "not-placed:start-404"],
    [428, "not-placed:start-428"],
    [429, "at-capacity:start-429"],
    [430, "not-placed:start-430"],
    [499, "not-placed:start-499"],
    [500, "result-unknown:start-500"],
    ["503", "result-unknown:start-503"],
    [599, "result-unknown:start-599"],
  ],
  startRejectionReason,
);

tabelle(
  "providerErrorReason",
  [
    [null, null],
    [undefined, null],
    ["text", null],
    [{ reason: "SIP Status: 486 Busy Here" }, "unreachable:invite-486"],
    [{ reason: "sip status:404" }, "unreachable:invite-404"],
    [{ reason: "SIP Status: 403 Forbidden D35" }, "not-placed:invite-403-D35"],
    [{ reason: "SIP Status: 404 D355" }, "unreachable:invite-404"],
    [{ reason: "SIP Status: 404 xD35" }, "unreachable:invite-404"],
    [{ reason: "sip status: 403 channel limit" }, "at-capacity:invite-403"],
    [{ reason: "sip status: 486 channel_limit" }, "unreachable:invite-486"],
    [{ reason: "sip status: 700", code: 502 }, "result-unknown:provider-502"],
    [{ reason: "sip status: 399", code: 502 }, "result-unknown:provider-502"],
    [{ reason: "kein Code", code: 503 }, "result-unknown:provider-503"],
    [{ reason: 5, code: "502" }, "result-unknown:provider-502"],
    [{ code: 399 }, "result-unknown:provider"],
    [{ code: 600 }, "result-unknown:provider"],
    [{}, "result-unknown:provider"],
  ],
  providerErrorReason,
);

tabelle(
  "pollProviderErrorReason",
  [
    [502, "result-unknown:poll-provider-502"],
    [400, "result-unknown:poll-provider-400"],
    [599, "result-unknown:poll-provider-599"],
    [399, "result-unknown:poll-provider"],
    [600, "result-unknown:poll-provider"],
    [undefined, "result-unknown:poll-provider"],
  ],
  pollProviderErrorReason,
);

test("AnsweredBy: Maschinen, Mensch und Unbekannt", () => {
  assert.deepEqual({ ...ANSWERED_BY }, { MACHINE: "machine", HUMAN: "human", UNKNOWN: "unknown" });
  assert.ok(Object.isFrozen(ANSWERED_BY));
  for (const token of ["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax"]) {
    assert.equal(classifyAnsweredBy(token), "machine", token);
  }
  assert.equal(classifyAnsweredBy("human"), "human");
  for (const roh of ["Human", "machine", "unknown", "", undefined, null, 5, ["human"], {}]) {
    assert.equal(classifyAnsweredBy(roh), "unknown", String(roh));
  }
  assert.equal(parseAnsweredBy({ AnsweredBy: "fax" }), "machine");
  assert.equal(parseAnsweredBy({ AnsweredBy: "human" }), "human");
  assert.equal(parseAnsweredBy({}), "unknown");
});

const NOW = Date.parse("2026-05-01T12:00:00.000Z");
const vorMs = (ms) => new Date(NOW - ms).toISOString();
const ausgehend = (id, to, startedAt) => ({ id, to, startedAt, direction: "outbound" });
const eingehend = (id, to, startedAt) => ({ ...ausgehend(id, to, startedAt), direction: "inbound" });

test("Doppelanruf-Erkennung: Fenster und Filter", () => {
  assert.equal(DEDUP_WINDOW_MS, 180000);
  const anfrage = { to: "+491701234567", nowMs: NOW };
  const imRand = ausgehend("rand", anfrage.to, vorMs(DEDUP_WINDOW_MS));
  assert.equal(findDuplicateOutboundCall([imRand], anfrage), imRand);
  assert.equal(findDuplicateOutboundCall([ausgehend("alt", anfrage.to, vorMs(DEDUP_WINDOW_MS + 1))], anfrage), null);
  const zukunft = ausgehend("zukunft", anfrage.to, vorMs(-5000));
  assert.equal(findDuplicateOutboundCall([zukunft], anfrage), zukunft);
  assert.equal(findDuplicateOutboundCall([eingehend("ein", anfrage.to, vorMs(10))], anfrage), null);
  assert.equal(findDuplicateOutboundCall([ausgehend("andere", "+491709999999", vorMs(10))], anfrage), null);
  assert.equal(findDuplicateOutboundCall([], anfrage), null);
});

test("Doppelanruf-Erkennung: ungueltige Eingaben und neuester Treffer", () => {
  const to = "+491701234567";
  const aktiv = [ausgehend("a", to, vorMs(10))];
  assert.equal(findDuplicateOutboundCall(null, { to, nowMs: NOW }), null);
  assert.equal(findDuplicateOutboundCall({}, { to, nowMs: NOW }), null);
  assert.equal(findDuplicateOutboundCall(aktiv, { to: "", nowMs: NOW }), null);
  assert.equal(findDuplicateOutboundCall(aktiv, { to: 4917, nowMs: NOW }), null);
  assert.equal(findDuplicateOutboundCall(aktiv, { nowMs: NOW }), null);
  const alt = ausgehend("alt", to, vorMs(60000));
  const neu = ausgehend("neu", to, vorMs(1000));
  const mitte = ausgehend("mitte", to, vorMs(30000));
  assert.equal(findDuplicateOutboundCall([alt, neu, mitte], { to, nowMs: NOW }).id, "neu");
  assert.equal(findDuplicateOutboundCall([neu, alt, mitte], { to, nowMs: NOW }).id, "neu");
  assert.equal(findDuplicateOutboundCall([mitte, alt], { to, nowMs: NOW }).id, "mitte");
  const gleichA = ausgehend("gleichA", to, vorMs(500));
  const gleichB = ausgehend("gleichB", to, vorMs(500));
  assert.equal(findDuplicateOutboundCall([gleichA, gleichB], { to, nowMs: NOW }).id, "gleichB");
});
