import assert from "node:assert/strict";
import { test } from "node:test";

import { vorspannAnchors } from "../../src/telephony/webhook-idempotenz.js";

const ZEITSTEMPEL = "1700000000";
const KOERPER = Buffer.from('{"data":{"id":"evt-1"}}');

const FAELLE = [
  { name: "ohne Zeitstempel", req: { query: { callId: "c1" }, headers: {}, rawBody: KOERPER } },
  { name: "ohne Rohkörper", req: { query: { callId: "c1" }, headers: { "telnyx-timestamp": ZEITSTEMPEL } } },
  { name: "ohne alles", req: {} },
];

for (const { name, req } of FAELLE) {
  test(`Vorspann-Zustellung ${name}: kein Anker, also keine Beanspruchung, die fremde Zustellungen verschluckt`, () => {
    assert.deepEqual(vorspannAnchors({ query: {}, headers: {}, ...req }), []);
  });
}

test("Vorspann-Zustellung mit Zeitstempel und Körper: genau ein Anker mit Präfix v, je Anruf verschieden", () => {
  const req = (callId) => ({ query: { callId }, headers: { "telnyx-timestamp": ZEITSTEMPEL }, rawBody: KOERPER });
  const [eins] = vorspannAnchors(req("c1"));
  assert.match(eins, /^ve:[0-9a-f]{64}$/);
  assert.equal(vorspannAnchors(req("c1")).length, 1);
  assert.notDeepEqual(vorspannAnchors(req("c2")), [eins]);
});
