// AL-P1 (Latenz-/Abbruch-Achse): Turn-Beobachtbarkeit im Shim + Boot-Banner. Zwei Aspekte:
//   1. der Shim traegt die vier PII-freien Diagnose-Felder in jeder turn_ok-Zeile (Muster
//      test/telnyx-llm-shim.test.js OBS-1 turn_ok, EINE Quelle test/telnyx-shim-harness.js).
//   2. assistantPathLabel (boot.js) ist eine reine, pinnbare Funktion (Muster
//      test/boot-budget-axis-label.test.js).
// AL-P1-6 (agentTurn selbst) lebt bewusst in einer EIGENEN Datei
// (test/al-p1-agent-turn-callerturns.test.js): der statische config.js-Import in
// telnyx-shim-harness.js muesste sonst dem DATA_DIR-Binden dort in die Quere kommen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole } from "./helpers.js";
import { fakeStore, makeCall, agentTurnSpy, makeHandler, validReq, fakeRes } from "./telnyx-shim-harness.js";
import { assistantPathLabel } from "../src/boot.js";

test("AL-P1-7: turn_ok traegt roundtrips/toolNames/chars/speechEmpty und keinen Turn-Text", async () => {
  const call = makeCall({ id: "call_shim_x", callControlId: "cc_shim_x" });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({
    speech: "Ein gesprochener Satz, der NIE im Log landen darf.",
    endCall: false,
    roundtrips: 2,
    toolNames: ["get_calendar"],
  });
  const handler = makeHandler({ store, agentTurn });

  const lines = await captureConsole(() =>
    handler(validReq(call, { messages: [{ role: "user", content: "Hallo dort" }] }), fakeRes()),
  );

  const turnOk = lines.filter((l) => l.includes("[telnyx-shim] turn_ok"));
  assert.equal(turnOk.length, 1);
  assert.ok(turnOk[0].includes('"roundtrips":2'), "roundtrips muss in der Zeile stehen");
  assert.ok(turnOk[0].includes('"toolNames":["get_calendar"]'), "toolNames muss als Namens-Array stehen");
  assert.match(turnOk[0], /"chars":\d+/, "chars muss eine Ganzzahl sein");
  assert.ok(turnOk[0].includes('"speechEmpty":false'), "speechEmpty muss den Diskriminator tragen");
  assert.ok(
    !turnOk[0].includes("Ein gesprochener Satz"),
    "der gesprochene Text darf nie in der turn_ok-Zeile landen",
  );
});

test("AL-P1-8: turn_ok bleibt fail-safe, wenn agentTurn die Diagnose-Felder nicht liefert", async () => {
  const call = makeCall({ id: "call_shim_bare", callControlId: "cc_shim_bare" });
  const store = fakeStore({ call });
  // Default-agentTurnSpy liefert NUR {speech, endCall} - keine roundtrips/toolNames.
  const agentTurn = agentTurnSpy({ speech: "Hallo", endCall: false });
  const handler = makeHandler({ store, agentTurn });

  const lines = await captureConsole(() => handler(validReq(call), fakeRes()));

  const turnOk = lines.filter((l) => l.includes("[telnyx-shim] turn_ok"));
  assert.equal(turnOk.length, 1);
  assert.ok(turnOk[0].includes('"roundtrips":null'), "fehlendes Feld -> null, kein Crash");
  assert.ok(turnOk[0].includes('"toolNames":[]'), "fehlendes Feld -> leeres Array, kein Crash");
});

test("AL-P1-9: assistantPathLabel nennt das Flag in beiden Richtungen", () => {
  assert.equal(assistantPathLabel(true), "AKTIV (TELNYX_AI_ASSISTANT_ENABLED=true)");
  assert.equal(assistantPathLabel(false), "aus (TELNYX_AI_ASSISTANT_ENABLED=false)");
});
