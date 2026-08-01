// AL-D1 (Draht): die drei neuen PII-freien Spalten der unconditional turn_ok-Zeile -
// offeredToolNames (ANGEBOTEN gegen GEFEUERT), streamArmedRounds (wurde der
// Streaming-Pfad ueberhaupt armiert) und consultPollFresh (wartete zu Turn-Beginn ein
// MCP-Client). Ohne sie bleibt am Live-Log unentscheidbar, ob das Registrierungs-Gate
// nie angeboten oder das Modell nicht gewaehlt hat.
//
// Fake-res, keine echte Zeit, kein Netz (P12/R). Naht wie test/al-p7b-shim-bridge.test.js.
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang - Praefix ist "AL-D1-<n>:".
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole } from "./helpers.js";
import {
  agentTurnSpy,
  fakeRes,
  fakeStore,
  makeCall,
  makeHandler,
  validReq,
} from "./telnyx-shim-harness.js";

const GESPROCHEN = "Hallo Welt";

// Die EINE turn_ok-Zeile eines Handler-Laufs (Operate + Check in einem Schritt, P13).
async function turnOkLine({ call, agentTurn }) {
  const store = fakeStore({ call });
  const handler = makeHandler({ store, agentTurn });
  const lines = await captureConsole(() => handler(validReq(call), fakeRes()));
  const turnOk = lines.filter((l) => l.includes("[telnyx-shim] turn_ok"));
  assert.equal(turnOk.length, 1, "genau eine turn_ok-Zeile erwartet");
  return turnOk[0];
}

test("AL-D1-7: turn_ok traegt offeredToolNames, streamArmedRounds, consultPollFresh - und keinen Text", async () => {
  const call = makeCall({ id: "call_ald1_shim", callControlId: "cc_ald1_shim" });
  const agentTurn = agentTurnSpy({
    speech: GESPROCHEN,
    endCall: false,
    offeredToolNames: ["end_call", "take_message", "get_consult"],
    streamArmedRounds: 0,
  });

  const line = await turnOkLine({ call, agentTurn });

  assert.ok(
    line.includes('"offeredToolNames":["end_call","take_message","get_consult"]'),
    "der ANGEBOTENE Werkzeugsatz muss als Namens-Array stehen",
  );
  assert.ok(line.includes('"streamArmedRounds":0'), "die Armierungs-Zahl muss stehen");
  assert.ok(!line.includes(GESPROCHEN), "der gesprochene Text darf nie in der Zeile landen");
});

test("AL-D1-8: turn_ok bleibt fail-safe, wenn agentTurn die neuen Felder nicht liefert", async () => {
  const call = makeCall({ id: "call_ald1_bare", callControlId: "cc_ald1_bare" });
  // Default-Spy liefert NUR {speech, endCall} - kein offeredToolNames, kein streamArmedRounds.
  const agentTurn = agentTurnSpy({ speech: GESPROCHEN, endCall: false });

  const line = await turnOkLine({ call, agentTurn });

  assert.ok(line.includes('"offeredToolNames":[]'), "fehlendes Feld -> leeres Array, kein Wurf");
  assert.ok(line.includes('"streamArmedRounds":null'), "fehlendes Feld -> null, kein Wurf");
});

test("AL-D1-9: consultPollFresh spiegelt den Call-Zustand zu Turn-Beginn", async () => {
  const agentTurn = agentTurnSpy({ speech: GESPROCHEN, endCall: false });

  const frisch = makeCall({
    id: "call_ald1_poll",
    callControlId: "cc_ald1_poll",
    consultPolledAtMs: Date.now(),
  });
  assert.ok((await turnOkLine({ call: frisch, agentTurn })).includes('"consultPollFresh":true'));

  const ohne = makeCall({ id: "call_ald1_nopoll", callControlId: "cc_ald1_nopoll" });
  assert.ok((await turnOkLine({ call: ohne, agentTurn })).includes('"consultPollFresh":false'));
});
