// AL-P7b (Draht): der Shim liest "wurde schon gesprochen" jetzt vom TURN
// (turn.speechStreamed), nicht mehr von der Chunk-ZAHL - seit dem Denk-Signal sind das
// zwei verschiedene Aussagen (die Ueberbrueckung ist ein Chunk, die Antwort steht aber
// noch aus). Fail-safe-Richtung: fehlt das Feld, wird die Antwort GESPROCHEN.
// Fake-res, keine echte Zeit, kein Netz (P12/R). Naht wie test/al-p7-shim-stream-wire.test.js.
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang - Praefix ist "AL-P7b-<n>:".
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole } from "./helpers.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import {
  fakeRes,
  fakeStore,
  makeCall,
  makeHandler,
  validReq,
  sseChunks,
  sseContent,
  sseFinishReason,
  sseEndsWithDone,
  voiceControlSpy,
} from "./telnyx-shim-harness.js";
import { thinkingSignalBannerLine } from "../src/boot.js";

const BRUECKE = "Einen Moment, das pruefe ich. ";
const ANTWORT = "Donnerstag um neun passt.";
const streamingConfig = () => fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true });

// agentTurn-Double: spricht die Bruecke ueber onSpeechChunk (wie das echte agentTurn es
// fuer thinkingSignal.speakBridge tut), liefert dann den Turn mit den beiden neuen Feldern.
function bridgingAgentTurn({ speechStreamed = false, thinkingSignalSpoken = true, omitSpeechStreamed = false } = {}) {
  async function agentTurn(call, callerText, options = {}) {
    options.onSpeechChunk?.(BRUECKE);
    const turn = { speech: ANTWORT, thinkingSignalSpoken, endCall: false, roundtrips: 2, toolNames: [] };
    if (!omitSpeechStreamed) turn.speechStreamed = speechStreamed;
    return turn;
  }
  return agentTurn;
}

const contentPieces = (res) =>
  sseChunks(res)
    .map((c) => c.choices[0].delta.content)
    .filter((t) => typeof t === "string");

test("AL-P7b-15: Bruecke UND Antwort auf dem Draht, ANTWORT genau einmal, ein Envelope", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const handler = makeHandler({
    store,
    config: streamingConfig(),
    agentTurn: bridgingAgentTurn({ speechStreamed: false }),
    voiceControl: voiceControlSpy(),
  });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.deepEqual(contentPieces(res), [BRUECKE, ANTWORT]);
  assert.equal(sseContent(res), BRUECKE + ANTWORT);
  assert.equal(sseContent(res).split(ANTWORT).length - 1, 1, "die Antwort steht genau einmal");
  assert.equal(sseFinishReason(res), "stop");
  assert.equal(sseEndsWithDone(res), true);
  assert.equal(new Set(sseChunks(res).map((c) => c.id)).size, 1, "ein Envelope");
});

test("AL-P7b-16: speechStreamed:true -> die Antwort geht NICHT nochmal raus (Doppelrede-Riegel haelt)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const handler = makeHandler({
    store,
    config: streamingConfig(),
    agentTurn: bridgingAgentTurn({ speechStreamed: true }),
    voiceControl: voiceControlSpy(),
  });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.deepEqual(contentPieces(res), [BRUECKE], "nur die Bruecke, kein zweiter Antwort-Chunk");
  assert.ok(!sseContent(res).includes(ANTWORT));
});

test("AL-P7b-17: fehlendes speechStreamed (Fremd-/Alt-Double) -> die Antwort wird GESPROCHEN (fail-safe)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const handler = makeHandler({
    store,
    config: streamingConfig(),
    agentTurn: bridgingAgentTurn({ omitSpeechStreamed: true }),
    voiceControl: voiceControlSpy(),
  });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.ok(sseContent(res).includes(ANTWORT), "der schlimmste Fall ist eine Wiederholung, nicht Stille");
});

test("AL-P7b-18: turn_ok traegt thinkingSignal als Boolean, keinen gesprochenen Text", async () => {
  const call = makeCall({ id: "call_shim_thinking", callControlId: "cc_shim_thinking" });
  const store = fakeStore({ call });
  const handler = makeHandler({
    store,
    config: streamingConfig(),
    agentTurn: bridgingAgentTurn({ speechStreamed: false, thinkingSignalSpoken: true }),
    voiceControl: voiceControlSpy(),
  });

  const lines = await captureConsole(() => handler(validReq(call), fakeRes()));

  const turnOk = lines.filter((l) => l.includes("[telnyx-shim] turn_ok"));
  assert.equal(turnOk.length, 1);
  assert.ok(turnOk[0].includes('"thinkingSignal":true'), "Boolean-Feld muss stehen");
  assert.ok(!turnOk[0].includes(BRUECKE.trim()), "kein gesprochener Text in der Log-Zeile");
  assert.ok(!turnOk[0].includes(ANTWORT), "kein gesprochener Text in der Log-Zeile");
});

test("AL-P7b-19: thinkingSignalBannerLine - aus -> leer, an -> die Zeile", () => {
  assert.equal(thinkingSignalBannerLine({ thinkingSignalEnabled: false }), "");
  assert.equal(
    thinkingSignalBannerLine({ thinkingSignalEnabled: true }),
    "Denk-Signal: AKTIV (THINKING_SIGNAL_ENABLED=true)",
  );
});
