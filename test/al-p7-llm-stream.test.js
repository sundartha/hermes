// AL-P7 (Seam): llm.completeStream reicht die Text-Fragmente WAEHREND der Generierung an
// einen Sink durch und behaelt dabei die Resilienz von complete - mit EINER neuen,
// bindenden Regel: kein Retry mehr, sobald ein Fragment den Seam verlassen hat.
// Reine node:test-Unit gegen einen injizierten messagesStream (DIP) - kein Netz, keine
// echte Zeit, kein Store (P12 F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  attemptReachedProvider,
  createLlmClient,
  LlmUnavailableError,
  LLM_UNAVAILABLE_REASON,
} from "../src/llm.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

function llmConfig(overrides = {}) {
  return withConfigNamespaces({
    llmRequestTimeoutMs: 3500,
    llmMaxRetries: 2,
    llmBackoffMs: 1,
    llmBreakerThreshold: 5,
    llmBreakerWindowMs: 10000,
    llmBreakerCooldownMs: 30000,
    ...overrides,
  });
}

const noSleep = () => Promise.resolve();

// Sink-Spy im Vertrag des Chunkers (pushText/toolUseStarted) - ohne dessen Satz-Logik,
// damit dieser Test wirklich nur den Seam prueft.
function sinkSpy() {
  const pushed = [];
  let toolUse = 0;
  return {
    pushed,
    pushText: (t) => pushed.push(t),
    toolUseStarted: () => (toolUse += 1),
    toolUseCount: () => toolUse,
    text: () => pushed.join(""),
  };
}

const textBlockStart = { type: "content_block_start", content_block: { type: "text", text: "" } };
const toolBlockStart = {
  type: "content_block_start",
  content_block: { type: "tool_use", id: "tu1", name: "take_message", input: {} },
};
const textDelta = (text) => ({ type: "content_block_delta", delta: { type: "text_delta", text } });
const jsonDelta = (partial) => ({
  type: "content_block_delta",
  delta: { type: "input_json_delta", partial_json: partial },
});

// Fake-MessageStream: AsyncIterable ueber eine feste Event-Folge + finalMessage().
// throwAt = Index, an dem die Iteration stattdessen wirft (Abriss mitten im Strom).
function fakeStream({ events, final, throwAt = -1, error }) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const [i, event] of events.entries()) {
        if (i === throwAt) throw error;
        yield event;
      }
      if (throwAt === events.length) throw error;
    },
    async finalMessage() {
      return final;
    },
  };
}

const FINAL = {
  content: [{ type: "text", text: "Guten Tag. Wie kann ich helfen?" }],
  usage: { input_tokens: 11, output_tokens: 20 },
};

// Fabrik fuer den injizierten Seam: liefert nacheinander die uebergebenen Streams und
// protokolliert die Aufrufe (params + options).
function streamFactory(...streams) {
  const calls = [];
  const fn = (params, options) => {
    calls.push({ params, options });
    return streams[Math.min(calls.length - 1, streams.length - 1)];
  };
  fn.calls = calls;
  return fn;
}

test("AL-P7-9: Text-Deltas kommen in Reihenfolge am Sink an, finalMessage wird durchgereicht", async () => {
  const sink = sinkSpy();
  const messagesStream = streamFactory(
    fakeStream({
      events: [textBlockStart, textDelta("Guten Tag. "), textDelta("Wie kann ich helfen?")],
      final: FINAL,
    }),
  );
  const client = createLlmClient({ config: llmConfig(), sleep: noSleep, messagesStream });
  const resp = await client.completeStream({
    callId: "call_1",
    sink,
    streamBudgetMs: 5000,
    model: "claude-haiku-4-5",
    messages: [],
  });
  assert.deepEqual(sink.pushed, ["Guten Tag. ", "Wie kann ich helfen?"]);
  assert.deepEqual(resp, FINAL);
  // callId wird wie bei complete abgestreift, bevor params an den SDK-Seam geht.
  assert.equal(messagesStream.calls[0].params.callId, undefined);
  assert.equal(messagesStream.calls[0].params.sink, undefined);
  assert.equal(messagesStream.calls[0].params.streamBudgetMs, undefined);
});

test("AL-P7-10: ein tool_use-Block meldet den Riegel; input_json-Deltas erreichen den Sink nie", async () => {
  const sink = sinkSpy();
  const messagesStream = streamFactory(
    fakeStream({
      events: [textBlockStart, textDelta("Ich notiere das."), toolBlockStart, jsonDelta('{"m":1}')],
      final: FINAL,
    }),
  );
  const client = createLlmClient({ config: llmConfig(), sleep: noSleep, messagesStream });
  await client.completeStream({ sink, streamBudgetMs: 5000, messages: [] });
  assert.equal(sink.toolUseCount(), 1);
  assert.deepEqual(sink.pushed, ["Ich notiere das."]);
});

test("AL-P7-11: zweiter Textblock bekommt das Fugen-Leerzeichen (Zeichenfolge == content.join)", async () => {
  const sink = sinkSpy();
  const final = {
    content: [
      { type: "text", text: "Erster Block." },
      { type: "text", text: "Zweiter Block." },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const messagesStream = streamFactory(
    fakeStream({
      events: [textBlockStart, textDelta("Erster Block."), textBlockStart, textDelta("Zweiter Block.")],
      final,
    }),
  );
  const client = createLlmClient({ config: llmConfig(), sleep: noSleep, messagesStream });
  await client.completeStream({ sink, streamBudgetMs: 5000, messages: [] });
  const ausContent = final.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  assert.equal(sink.text(), ausContent);
});

test("AL-P7-12: transienter Fehler VOR dem ersten Fragment wird wie im Bestand wiederholt", async () => {
  const sink = sinkSpy();
  const transient = new Anthropic.APIConnectionError({ message: "connection failed" });
  const messagesStream = streamFactory(
    fakeStream({ events: [textBlockStart], throwAt: 0, error: transient }),
    fakeStream({ events: [textBlockStart, textDelta("Zweiter Versuch.")], final: FINAL }),
  );
  const client = createLlmClient({ config: llmConfig(), sleep: noSleep, messagesStream });
  const resp = await client.completeStream({ sink, streamBudgetMs: 5000, messages: [] });
  assert.equal(messagesStream.calls.length, 2, "genau ein Retry");
  assert.deepEqual(sink.pushed, ["Zweiter Versuch."]);
  assert.deepEqual(resp, FINAL);
});

test("AL-P7-13: derselbe Fehler NACH dem ersten Fragment wird NICHT wiederholt (kein halber Satz zweimal)", async () => {
  const sink = sinkSpy();
  const transient = new Anthropic.APIConnectionError({ message: "connection failed" });
  const messagesStream = streamFactory(
    fakeStream({
      events: [textBlockStart, textDelta("Guten Tag.")],
      throwAt: 2,
      error: transient,
    }),
  );
  const client = createLlmClient({ config: llmConfig(), sleep: noSleep, messagesStream });
  await assert.rejects(
    () => client.completeStream({ sink, streamBudgetMs: 5000, messages: [] }),
    (err) => {
      assert.ok(err instanceof LlmUnavailableError);
      assert.equal(err.reason, LLM_UNAVAILABLE_REASON.RETRIES_EXHAUSTED);
      return true;
    },
  );
  assert.equal(messagesStream.calls.length, 1, "kein zweiter Versuch");
  assert.deepEqual(sink.pushed, ["Guten Tag."]);
});

test("AL-P7-14: ein Abbruch der eigenen Wanduhr wird zu LlmUnavailableError(stream-aborted)", async () => {
  const sink = sinkSpy();
  const abort = new Anthropic.APIUserAbortError();
  const messagesStream = streamFactory(
    fakeStream({ events: [textBlockStart, textDelta("Guten")], throwAt: 2, error: abort }),
  );
  const client = createLlmClient({ config: llmConfig(), sleep: noSleep, messagesStream });
  await assert.rejects(
    () => client.completeStream({ sink, streamBudgetMs: 5000, messages: [] }),
    (err) => {
      assert.ok(err instanceof LlmUnavailableError);
      assert.equal(err.reason, LLM_UNAVAILABLE_REASON.STREAM_ABORTED);
      return true;
    },
  );
  assert.equal(messagesStream.calls.length, 1);
});

test("AL-P7-15: streamBudgetMs wird als AbortSignal an den Seam durchgereicht", async () => {
  const sink = sinkSpy();
  const messagesStream = streamFactory(fakeStream({ events: [], final: FINAL }));
  const client = createLlmClient({ config: llmConfig(), sleep: noSleep, messagesStream });
  await client.completeStream({ sink, streamBudgetMs: 4000, messages: [] });
  const signal = messagesStream.calls[0].options.signal;
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
});

test("AL-P7-16: offener Breaker wirft VOR dem Stream (kein openStream-Aufruf)", async () => {
  const sink = sinkSpy();
  const transient = new Anthropic.APIConnectionError({ message: "connection failed" });
  const messagesStream = streamFactory(
    fakeStream({ events: [], throwAt: 0, error: transient }),
  );
  const client = createLlmClient({
    config: llmConfig({ llmMaxRetries: 0, llmBreakerThreshold: 1 }),
    sleep: noSleep,
    messagesStream,
  });
  await assert.rejects(() => client.completeStream({ sink, streamBudgetMs: 5000, messages: [] }));
  const nachErstemFehler = messagesStream.calls.length;
  await assert.rejects(
    () => client.completeStream({ sink, streamBudgetMs: 5000, messages: [] }),
    (err) => err instanceof LlmUnavailableError && err.reason === LLM_UNAVAILABLE_REASON.CIRCUIT_OPEN,
  );
  assert.equal(messagesStream.calls.length, nachErstemFehler, "kein zweiter Stream geoeffnet");
});

test("AL-P7-17: attemptReachedProvider trennt 'nie rausgegangen' von 'war auf der Leitung'", () => {
  const reached = [LLM_UNAVAILABLE_REASON.RETRIES_EXHAUSTED, LLM_UNAVAILABLE_REASON.STREAM_ABORTED];
  for (const reason of reached)
    assert.equal(attemptReachedProvider(new LlmUnavailableError(reason)), true, reason);
  assert.equal(
    attemptReachedProvider(new LlmUnavailableError(LLM_UNAVAILABLE_REASON.CIRCUIT_OPEN)),
    false,
  );
  assert.equal(attemptReachedProvider(new Error("4xx")), false);
  assert.equal(attemptReachedProvider(null), false);
});
