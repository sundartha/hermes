import assert from "node:assert/strict";
import { test } from "node:test";
import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";

test("Abfrage-Durchlauf: ein Anruf, den der Speicher nicht mehr kennt, startet keine Abfrage und der Durchlauf endet ohne Fehler", async () => {
  const gelesen = [];
  const store = {
    leseCall: async (callId) => {
      gelesen.push(callId);
      return undefined;
    },
  };
  const outbound = makeElevenLabsOutbound({
    store,
    config: { voice: { elevenLabsOutbound: {} } },
    terminateAndBillCall: async () => {},
    billThunk: () => async () => {},
    finishCall: async () => {},
  });
  assert.equal(await outbound.abfrageDurchLauf("call_weg"), undefined);
  assert.deepEqual(gelesen, ["call_weg"]);
});
