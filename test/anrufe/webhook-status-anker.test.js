import { test } from "node:test";
import assert from "node:assert/strict";
import { statusAnchors } from "../../src/telephony/webhook-idempotenz.js";

const KOERPER = "CallStatus=failed&SipHangupCause=403";
const ZEIT = "1760000000";

const zustellung = (callId, zeit = ZEIT) => ({
  headers: { "telnyx-timestamp": zeit },
  rawBody: Buffer.from(KOERPER),
  query: callId === undefined ? {} : { callId },
});

test("Status-Anker: gleicher Koerper und Zeitstempel, verschiedene callId ergeben verschiedene Anker", () => {
  const eins = statusAnchors(zustellung("call_a"));
  const zwei = statusAnchors(zustellung("call_b"));
  assert.equal(eins.length, 1);
  assert.equal(zwei.length, 1);
  assert.notEqual(eins[0], zwei[0]);
});

test("Status-Anker: gleiche callId, Koerper und Zeitstempel ergeben denselben Anker", () => {
  assert.deepEqual(statusAnchors(zustellung("call_a")), statusAnchors(zustellung("call_a")));
});

test("Status-Anker: anderer Zeitstempel ergibt anderen Anker, ohne callId bleibt der Anker erhalten", () => {
  assert.notDeepEqual(statusAnchors(zustellung("call_a")), statusAnchors(zustellung("call_a", "1760000001")));
  const ohne = statusAnchors(zustellung(undefined));
  assert.equal(ohne.length, 1);
  assert.notEqual(ohne[0], statusAnchors(zustellung("call_a"))[0]);
});
