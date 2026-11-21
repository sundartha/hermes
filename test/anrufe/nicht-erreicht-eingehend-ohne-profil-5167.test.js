import assert from "node:assert/strict";
import { test } from "node:test";

import { NICHT_ERREICHT_FRIST_MS, nichtErreichtNachFrist } from "../../src/elevenlabs/nicht-erreicht-frist.ts";

const START_ISO = "2026-01-01T10:00:00.000Z";
const START_MS = Date.parse(START_ISO);
const KEIN_GESPRAECH = { transcript: [], metadata: { call_duration_secs: 0 } };

const FAELLE = [
  { name: "eingehend, costProfile null", call: { direction: "inbound", costProfile: null }, versatz: NICHT_ERREICHT_FRIST_MS * 2, erwartet: false },
  { name: "eingehend, costProfile fehlt", call: { direction: "inbound" }, versatz: NICHT_ERREICHT_FRIST_MS * 2, erwartet: false },
  { name: "ausgehend, costProfile null, 74999 ms", call: { direction: "outbound", costProfile: null }, versatz: NICHT_ERREICHT_FRIST_MS - 1, erwartet: false },
  { name: "ausgehend, costProfile null, 75000 ms", call: { direction: "outbound", costProfile: null }, versatz: NICHT_ERREICHT_FRIST_MS, erwartet: true },
  { name: "ausgehend mit sipCallId, costProfile null, 74999 ms", call: { direction: "outbound", costProfile: null, sipCallId: "sip-1" }, versatz: NICHT_ERREICHT_FRIST_MS - 1, erwartet: false },
  { name: "ausgehend mit sipCallId, costProfile null, 75000 ms", call: { direction: "outbound", costProfile: null, sipCallId: "sip-1" }, versatz: NICHT_ERREICHT_FRIST_MS, erwartet: true },
];

for (const { name, call, versatz, erwartet } of FAELLE) {
  test(`5167 ${name}`, () => {
    const ergebnis = nichtErreichtNachFrist({ call: { ...call, startedAt: START_ISO }, conversation: KEIN_GESPRAECH, nowMs: START_MS + versatz });
    assert.equal(ergebnis, erwartet);
  });
}
