// AL-P7 (Draht): der Brain-Shim schreibt die Saetze des Turns SOFORT als SSE-Chunks,
// statt auf die komplette Modellantwort zu warten. Gegenstand sind fuenf Zusagen:
//   (1) Flag AUS -> byte-identische Bestandskadenz (4 Writes);
//   (2) Flag AN  -> n content-Chunks VOR dem finish-Chunk, Text vollstaendig, Rahmen gleich;
//   (3) keine Doppelrede - was gestreamt wurde, kommt nicht noch einmal als Completion;
//   (4) Degradation bleibt erreichbar, auch nach dem ersten gestreamten Byte (und T1 gilt weiter);
//   (5) ALLE Gates schreiben weiterhin genau EINE vollstaendige Completion, VOR dem ersten Byte.
// Fake-res, keine echte Zeit, kein Netz (P12/R).
import { test } from "node:test";
import assert from "node:assert/strict";
import { noopWatchdog } from "./helpers.js";
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
  sseRole,
  sseEndsWithDone,
  voiceControlSpy,
} from "./telnyx-shim-harness.js";
import { tokenStreamingBannerLine } from "../src/boot.js";
import { localeFor } from "../src/i18n/locales.js";

const SATZ_1 = "Guten Tag, hier ist Hermes.";
// Ab dem zweiten Chunk traegt das Fragment sein Trennzeichen selbst (speech-chunker.js) -
// die Fixture bildet genau das ab, was der echte agentTurn liefert.
const SATZ_2 = " Wie kann ich Ihnen helfen?";
const GANZER_TEXT = SATZ_1 + SATZ_2;
const DE = localeFor("de");

const streamingConfig = () => fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true });

// agentTurn-Double, das den Streaming-Vertrag bedient: es spricht die uebergebenen Saetze
// ueber onSpeechChunk und liefert danach denselben Text als turn.speech (genau das tut der
// echte agentTurn auf dem armierten Pfad).
function streamingAgentTurn({ chunks = [SATZ_1, SATZ_2], speech = GANZER_TEXT, throwAfter = -1 } = {}) {
  const calls = [];
  async function agentTurn(call, callerText, options = {}) {
    calls.push({ call, callerText, options });
    for (const [i, chunk] of chunks.entries()) {
      options.onSpeechChunk?.(chunk);
      if (i === throwAfter) throw new Error("modell weg");
    }
    // AL-P7b: der Double streamt den GANZEN Text NUR, wenn ihm ueberhaupt ein Abnehmer
    // durchgereicht wurde - sagt das jetzt explizit statt es den Shim aus der Chunk-Zahl
    // raten zu lassen. Ohne Abnehmer (Flag AUS, kein wire) blieb der Text unbestritten,
    // der Bestandspfad muss ihn also weiterhin einmal aussprechen.
    return {
      speech,
      speechStreamed: Boolean(options.onSpeechChunk),
      thinkingSignalSpoken: false,
      endCall: false,
      roundtrips: 1,
      toolNames: [],
      stopReason: null,
    };
  }
  agentTurn.calls = calls;
  return agentTurn;
}

// Alle content-Fragmente in Draht-Reihenfolge (der finish-Chunk traegt keinen content).
const contentPieces = (res) =>
  sseChunks(res)
    .map((c) => c.choices[0].delta.content)
    .filter((t) => typeof t === "string");

test("AL-P7-25: Flag AUS -> Bestandskadenz (role, content, finish, [DONE] = 4 Writes)", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = streamingAgentTurn();
  const handler = makeHandler({ store, agentTurn, voiceControl: voiceControlSpy() });
  const res = fakeRes();

  await handler(validReq(makeCall()), res);

  assert.equal(res.chunks.length, 4);
  assert.deepEqual(contentPieces(res), [GANZER_TEXT], "EIN content-Chunk am Ende");
  assert.equal(agentTurn.calls[0].options.onSpeechChunk, undefined, "kein Abnehmer durchgereicht");
});

test("AL-P7-26: Flag AN -> n content-Chunks VOR dem finish-Chunk, Rahmen unveraendert", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const handler = makeHandler({
    store,
    config: streamingConfig(),
    agentTurn: streamingAgentTurn(),
    voiceControl: voiceControlSpy(),
  });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.deepEqual(contentPieces(res), [SATZ_1, SATZ_2]);
  assert.equal(sseContent(res), GANZER_TEXT, "der volle Text steht auf der Leitung");
  assert.equal(sseRole(res), "assistant");
  assert.equal(sseFinishReason(res), "stop");
  assert.equal(sseEndsWithDone(res), true);
  // id/created bleiben ueber alle Chunks EINER Antwort stabil (OpenAI-Verhalten).
  const ids = new Set(sseChunks(res).map((c) => c.id));
  assert.equal(ids.size, 1);
});

test("AL-P7-27: keine Doppelrede - der gestreamte Text steht GENAU EINMAL auf dem Draht", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const handler = makeHandler({
    store,
    config: streamingConfig(),
    agentTurn: streamingAgentTurn(),
    voiceControl: voiceControlSpy(),
  });
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.equal(sseContent(res), GANZER_TEXT);
  assert.equal(sseContent(res).split(SATZ_1).length - 1, 1, "erster Satz genau einmal");
  assert.equal(sseContent(res).split(SATZ_2).length - 1, 1, "zweiter Satz genau einmal");
});

test("AL-P7-28: Degradation nach dem ersten gestreamten Byte haengt den Abbruchsatz als letzten Chunk an", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const handler = makeHandler({
    store,
    config: streamingConfig(),
    agentTurn: streamingAgentTurn({ throwAfter: 1 }),
    voiceControl: voiceControlSpy(),
  });
  const res = fakeRes();

  await handler(validReq(call), res);

  const pieces = contentPieces(res);
  // degradedSpeechFor klassifiziert einen NICHT-LlmUnavailableError als technischen
  // Fehler -> turnErrorSpeech (unveraendertes Bestandsverhalten, llm.js).
  assert.deepEqual(pieces, [SATZ_1, SATZ_2, DE.turnErrorSpeech]);
  assert.equal(sseFinishReason(res), "stop");
  assert.equal(sseEndsWithDone(res), true);
  assert.equal(new Set(sseChunks(res).map((c) => c.id)).size, 1, "kein zweiter Envelope");
});

test("AL-P7-29: T1 bleibt - reisst der Draht mitten im Schreiben, folgt nur end()", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const res = fakeRes();
  const originalWrite = res.write.bind(res);
  let writes = 0;
  res.write = (s) => {
    writes += 1;
    if (writes === 1) return originalWrite(s);
    throw new Error("socket kaputt");
  };
  const handler = makeHandler({
    store,
    config: streamingConfig(),
    agentTurn: streamingAgentTurn(),
    voiceControl: voiceControlSpy(),
  });

  await handler(validReq(call), res);

  assert.equal(res.chunks.length, 1, "nur der role-Chunk steht, kein zweiter Versuch");
  assert.equal(res.ended, true);
});

test("AL-P7-30: Rate-Gate schreibt mit aktivem Flag GENAU EINE vollstaendige Completion, ohne agentTurn", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = streamingAgentTurn();
  const handler = makeHandler({
    store,
    // Limit 1: der ZWEITE Turn desselben Calls faellt ins Rate-Gate.
    config: fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true, telnyxShimMaxTurnsPerMin: 1 }),
    agentTurn,
    voiceControl: voiceControlSpy(),
  });
  await handler(validReq(call), fakeRes());
  const res = fakeRes();

  await handler(validReq(call), res);

  assert.equal(agentTurn.calls.length, 1, "der zweite Turn erreicht agentTurn nie");
  assert.deepEqual(contentPieces(res), [DE.llmDegradedSpeech], "genau EIN content-Chunk");
  assert.equal(sseFinishReason(res), "stop");
  assert.equal(sseEndsWithDone(res), true);
});

test("AL-P7-31: Budget-Gate und Loop-Guard schreiben mit aktivem Flag ebenfalls genau EINE Completion", async () => {
  const call = makeCall();
  const agentTurn = streamingAgentTurn();

  const budgetRes = fakeRes();
  await makeHandler({
    store: fakeStore({ call, budgetExceeded: true }),
    config: streamingConfig(),
    agentTurn,
    voiceControl: voiceControlSpy(),
  })(validReq(call), budgetRes);
  assert.deepEqual(contentPieces(budgetRes), [DE.budgetExhaustedHangup]);
  assert.equal(sseEndsWithDone(budgetRes), true);

  const loopRes = fakeRes();
  await makeHandler({
    store: fakeStore({ call }),
    config: streamingConfig(),
    agentTurn,
    voiceControl: voiceControlSpy(),
    watchdog: { ...noopWatchdog(), observeTurn: () => ({ loopExceeded: true, turnSeq: 9 }) },
  })(validReq(call), loopRes);
  assert.deepEqual(contentPieces(loopRes), [DE.llmDegradedSpeech]);
  assert.equal(sseEndsWithDone(loopRes), true);

  assert.equal(agentTurn.calls.length, 0, "kein Gate hat agentTurn erreicht");
});

test("AL-P7-32: turn_ok traegt streamChunks als Zahl und weiterhin keinen Text", async () => {
  const call = makeCall();
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    await makeHandler({
      store: fakeStore({ call }),
      config: streamingConfig(),
      agentTurn: streamingAgentTurn(),
      voiceControl: voiceControlSpy(),
    })(validReq(call), fakeRes());
  } finally {
    console.log = originalLog;
  }
  const turnOk = lines.find((l) => l.includes("turn_ok"));
  assert.ok(turnOk, `keine turn_ok-Zeile in: ${lines.join(" | ")}`);
  const payload = JSON.parse(turnOk.slice(turnOk.indexOf("{")));
  assert.equal(payload.streamChunks, 2);
  assert.equal(typeof payload.streamChunks, "number");
  assert.ok(!turnOk.includes(SATZ_1), "kein gesprochener Text in der Logzeile");
});

test("AL-P7-33: die Boot-Banner-Zeile meldet den Draht in beiden Richtungen", () => {
  assert.equal(tokenStreamingBannerLine({ shimTokenStreaming: false }), "");
  assert.equal(
    tokenStreamingBannerLine({ shimTokenStreaming: true }),
    "Token-Streaming: AKTIV (TELNYX_SHIM_TOKEN_STREAMING=true)",
  );
});
