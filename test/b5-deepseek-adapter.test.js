// B5 (tasks/b5-spec.md): der DeepSeek-Adapter als Einheit - der ZWEITE Anbieter am Port
// aus src/llm/ports.js und damit der Beweis, dass die Naht traegt. Reine node:test-Unit
// gegen einen injizierten chatCompletionsFetch (DIP): kein Netz, kein Store, kein
// Schluessel, keine echte Zeit (P12 F.I.R.S.T.).
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern) - Praefix ist "B5-<n>:", die Tests landen also im
// npm-test-Regressionslauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeepseekProvider, deepseekErrors } from "../src/llm/adapters/deepseek.js";
import { providerTurnMessage, toolResultsMessage } from "../src/llm/messages.js";
import { LLM_TOOL_CHOICE, forcedTool } from "../src/llm/tool-choice.js";

const MODEL = "deepseek-v4-pro";
// Der Anbieter antwortet mit einer eigenen Modell-ID - genau der Wert, der NICHT gebucht
// werden darf (die angeforderte ID haelt den Bestandsvertrag).
const ANSWERED_MODEL = "deepseek-v4-pro-0807";
const API_KEY = "sk-b5-geheim-nie-in-einer-meldung";

const TAKE_MESSAGE_TOOL = {
  name: "take_message",
  description: "Nimmt eine Nachricht auf.",
  parameters: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
};

// Anthropics SERVERSEITIGES Werkzeug: es hat kein parameters-Feld, weil es dem anderen
// Anbieter gehoert (llm/ports.js LlmRequest.tools).
const FOREIGN_SERVER_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 3 };

// ---- Attrappen des Draht-Transports -------------------------------------------------

function jsonResponse(payload, status = 200) {
  const raw = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => raw,
  };
}

// Der SSE-Strom kommt als Byte-Haeppchen, die NICHT an Ereignisgrenzen liegen - genau so
// muss der Adapter ihn puffern koennen. Kleine Scheiben erzwingen den Pufferpfad.
const STREAM_SLICE_CHARS = 7;

function streamResponseOf(text) {
  const encoder = new TextEncoder();
  let offset = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (offset >= text.length) return { value: undefined, done: true };
          const slice = text.slice(offset, offset + STREAM_SLICE_CHARS);
          offset += STREAM_SLICE_CHARS;
          return { value: encoder.encode(slice), done: false };
        },
      }),
    },
  };
}

const sseText = (events) =>
  events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");

const sseResponse = (events) => streamResponseOf(sseText(events));

function providerReturning(response, options = {}) {
  const seen = [];
  const provider = createDeepseekProvider({
    apiKey: API_KEY,
    ...options,
    chatCompletionsFetch: (url, init) => {
      seen.push({ url, init });
      return Promise.resolve(response);
    },
  });
  return { provider, seen };
}

const sentBody = (seen) => JSON.parse(seen[0].init.body);

// Eine vollstaendige, unauffaellige Nicht-Stream-Antwort.
function chatResponse({ content = "", toolCalls, usage, finishReason = "stop" } = {}) {
  const message = { role: "assistant", content };
  if (toolCalls) message.tool_calls = toolCalls;
  return {
    model: ANSWERED_MODEL,
    choices: [{ message, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}

const rawToolCall = (id, name, args) => ({
  id,
  type: "function",
  function: { name, arguments: args },
});

const usageOf = (hit, miss, completion, prompt = hit + miss) => ({
  prompt_tokens: prompt,
  prompt_cache_hit_tokens: hit,
  prompt_cache_miss_tokens: miss,
  completion_tokens: completion,
});

function recordingSink() {
  const pushed = [];
  let toolStarts = 0;
  return {
    pushed,
    starts: () => toolStarts,
    pushText: (delta) => pushed.push(delta),
    toolUseStarted: () => {
      toolStarts += 1;
    },
  };
}

const completeWith = (response, request) => providerReturning(response).provider.complete(request);

// ---- Anfrageseite --------------------------------------------------------------------

test("B5-1: Anfrage-Form - system wird ERSTE Nachricht, maxTokens/tools uebersetzt, thinking:disabled ist da", async () => {
  const { provider, seen } = providerReturning(jsonResponse(chatResponse()));
  await provider.complete({
    model: MODEL,
    // messages VOR system im Literal: die Position der Systemnachricht darf NICHT an der
    // Schluesselreihenfolge des Aufrufers haengen.
    messages: [{ role: "user", content: "Hallo" }],
    system: "Du bist Hermes.",
    maxTokens: 128,
    tools: [TAKE_MESSAGE_TOOL],
  });
  const body = sentBody(seen);
  assert.equal(body.max_tokens, 128);
  assert.deepEqual(body.messages, [
    { role: "system", content: "Du bist Hermes." },
    { role: "user", content: "Hallo" },
  ]);
  assert.deepEqual(body.tools, [
    {
      type: "function",
      function: {
        name: "take_message",
        description: "Nimmt eine Nachricht auf.",
        parameters: TAKE_MESSAGE_TOOL.parameters,
      },
    },
  ]);
  assert.deepEqual(
    body.thinking,
    { type: "disabled" },
    "ohne dieses Feld scheitert JEDE erzwungene Werkzeugwahl mit HTTP 400 (Spike 2/2)",
  );
  assert.equal("maxTokens" in body, false);
});

test("B5-2: cachePrefix erreicht den Draht NICHT; unbekannte Schluessel gehen unveraendert durch", async () => {
  const { provider, seen } = providerReturning(jsonResponse(chatResponse()));
  await provider.complete({
    model: MODEL,
    system: "S",
    messages: [],
    cachePrefix: true,
    temperature: 0.4,
  });
  const body = sentBody(seen);
  assert.equal("cachePrefix" in body, false, "cachePrefix ist ein Hinweis an den Adapter");
  assert.equal(body.temperature, 0.4);
  assert.equal(body.model, MODEL);
});

test("B5-3: toolChoice dreiwertig - auto/required/benannt; unbekannter Wert wirft benannt", async () => {
  const choiceOnWire = async (toolChoice) => {
    const { provider, seen } = providerReturning(jsonResponse(chatResponse()));
    await provider.complete({ model: MODEL, system: "S", messages: [], toolChoice });
    return sentBody(seen).tool_choice;
  };
  assert.equal(await choiceOnWire(LLM_TOOL_CHOICE.AUTO), "auto");
  assert.equal(await choiceOnWire(LLM_TOOL_CHOICE.REQUIRED), "required");
  assert.deepEqual(await choiceOnWire(forcedTool("take_message")), {
    type: "function",
    function: { name: "take_message" },
  });
  const { provider } = providerReturning(jsonResponse(chatResponse()));
  await assert.rejects(
    () => provider.complete({ model: MODEL, system: "S", messages: [], toolChoice: "irgendwas" }),
    /DeepSeek-Adapter: unbekannte Werkzeugwahl/,
  );
});

test("B5-4: neutrale Nachrichtenformen - providerTurn 1:1, ZWEI Ergebnisse werden ZWEI tool-Nachrichten", async () => {
  const previousTurn = { role: "assistant", content: "Moment.", tool_calls: [rawToolCall("c1", "take_message", "{}")] };
  const { provider, seen } = providerReturning(jsonResponse(chatResponse()));
  await provider.complete({
    model: MODEL,
    system: "S",
    messages: [
      { role: "user", content: "Hallo" },
      providerTurnMessage(previousTurn),
      toolResultsMessage([
        { toolCallId: "c1", text: "notiert" },
        { toolCallId: "c2", text: "beendet" },
      ]),
    ],
  });
  assert.deepEqual(sentBody(seen).messages, [
    { role: "system", content: "S" },
    { role: "user", content: "Hallo" },
    previousTurn,
    { role: "tool", tool_call_id: "c1", content: "notiert" },
    { role: "tool", tool_call_id: "c2", content: "beendet" },
  ]);
});

test("B5-14: Werkzeug OHNE parameters (fremdes Serverwerkzeug) wird benannt abgelehnt, nicht still verworfen", async () => {
  const { provider } = providerReturning(jsonResponse(chatResponse()));
  await assert.rejects(
    () =>
      provider.complete({
        model: MODEL,
        system: "S",
        messages: [],
        tools: [TAKE_MESSAGE_TOOL, FOREIGN_SERVER_TOOL],
      }),
    (err) =>
      /DeepSeek-Adapter: Werkzeug 'web_search' ohne parameters/.test(err.message) &&
      !/take_message/.test(err.message),
  );
});

// ---- Antwortseite --------------------------------------------------------------------

test("B5-5: tool_calls - arguments-JSON-String wird Objekt, leerer String wird die leere Menge", async () => {
  const turn = await completeWith(
    jsonResponse(
      chatResponse({
        content: "Gerne.",
        toolCalls: [
          rawToolCall("c1", "take_message", '{"msg":"Rueckruf erbeten"}'),
          rawToolCall("c2", "end_call", ""),
        ],
        finishReason: "tool_calls",
      }),
    ),
    { model: MODEL, system: "S", messages: [] },
  );
  assert.deepEqual(turn.toolCalls, [
    { id: "c1", name: "take_message", input: { msg: "Rueckruf erbeten" } },
    { id: "c2", name: "end_call", input: {} },
  ]);
  assert.equal(turn.text, "Gerne.");
  assert.equal(turn.stopReason, "tool_calls");
});

test("B5-6: W2 - nicht-leere, unparsebare arguments werden abgelehnt; die Meldung nennt das Werkzeug, NIE die Argumente", async () => {
  const secretArguments = '{"msg":"Frau Berger, Kontonummer 12345"';
  await assert.rejects(
    () =>
      completeWith(
        jsonResponse(
          chatResponse({
            toolCalls: [rawToolCall("c1", "take_message", secretArguments)],
            finishReason: "tool_calls",
          }),
        ),
        { model: MODEL, system: "S", messages: [] },
      ),
    (err) => {
      assert.match(err.message, /take_message/);
      assert.match(err.message, /c1/);
      assert.equal(
        err.message.includes("Kontonummer"),
        false,
        "der Argument-String traegt Anrufer-Inhalte und darf nie in einer Meldung stehen",
      );
      assert.equal(err.message.includes(secretArguments), false);
      assert.equal(err.status, undefined, "kein status -> isTransient false -> kein Retry");
      assert.equal(deepseekErrors.isTransient(err), false);
      return true;
    },
  );
});

test("B5-7: W2-Rand - arguments parsen zu einem Nicht-Objekt -> derselbe fail-closed-Pfad", async () => {
  for (const raw of ['"5"', "[1]", "null", "5", "true"]) {
    await assert.rejects(
      () =>
        completeWith(
          jsonResponse(
            chatResponse({ toolCalls: [rawToolCall("c1", "take_message", raw)], finishReason: "tool_calls" }),
          ),
          { model: MODEL, system: "S", messages: [] },
        ),
      /sind kein JSON-Objekt/,
      `arguments=${raw} darf keinen LlmToolCall erzeugen`,
    );
  }
});

test("B5-8: Verbrauch - miss/hit/completion auf die vier Sorten, Schreib-Sorte 0, billingModelId = ANGEFORDERTE ID", async () => {
  const turn = await completeWith(
    jsonResponse(chatResponse({ usage: usageOf(960, 40, 17) })),
    { model: MODEL, system: "S", messages: [] },
  );
  assert.deepEqual(turn.usage, {
    inputUncachedTokens: 40,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 960,
    outputTokens: 17,
    estimated: false,
    billingModelId: MODEL,
  });
  assert.notEqual(turn.usage.billingModelId, ANSWERED_MODEL);
});

test("B5-9: verletzte Vollstaendigkeits-Invariante (prompt_tokens != hit+miss) -> estimated:true, alles auf der ungecachten Sorte", async () => {
  const turn = await completeWith(
    jsonResponse(chatResponse({ usage: usageOf(960, 40, 17, 1200) })),
    { model: MODEL, system: "S", messages: [] },
  );
  assert.deepEqual(turn.usage, {
    inputUncachedTokens: 1200,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: 17,
    estimated: true,
    billingModelId: MODEL,
  });
});

test("B5-10: usage fehlt ganz -> Nullen plus estimated:true (0 heisst nie 'unbekannt')", async () => {
  const turn = await completeWith(jsonResponse(chatResponse()), {
    model: MODEL,
    system: "S",
    messages: [],
  });
  assert.deepEqual(turn.usage, {
    inputUncachedTokens: 0,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: 0,
    estimated: true,
    billingModelId: MODEL,
  });
});

// ---- Streaming -----------------------------------------------------------------------

const streamDelta = (delta) => ({ choices: [{ index: 0, delta }] });

test("B5-11: Streaming - ueber vier Chunks fragmentierte tool_calls werden nach index zusammengesetzt; toolUseStarted genau einmal je index", async () => {
  const events = [
    streamDelta({ tool_calls: [{ index: 0, id: "c1", function: { name: "take_", arguments: "" } }] }),
    streamDelta({ tool_calls: [{ index: 0, function: { name: "message", arguments: '{"ms' } }] }),
    streamDelta({ tool_calls: [{ index: 0, function: { arguments: 'g":"Rueckruf' } }] }),
    streamDelta({
      tool_calls: [
        { index: 0, function: { arguments: ' erbeten"}' } },
        { index: 1, id: "c2", function: { name: "end_call", arguments: "{}" } },
      ],
    }),
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage: usageOf(0, 30, 5) },
    "[DONE]",
  ];
  const { provider } = providerReturning(sseResponse(events));
  const sink = recordingSink();
  const turn = await provider.completeStream({ model: MODEL, system: "S", messages: [] }, sink);
  assert.deepEqual(turn.toolCalls, [
    { id: "c1", name: "take_message", input: { msg: "Rueckruf erbeten" } },
    { id: "c2", name: "end_call", input: {} },
  ]);
  assert.equal(sink.starts(), 2, "genau ein Signal je Werkzeug-index, nicht je Fragment");
  assert.equal(turn.stopReason, "tool_calls");
});

test("B5-17: Streaming - rekonstruierte tool_calls tragen type:function in providerTurn und ueberleben unveraendert eine zweite Runde (W4, tasks/befund-toolwahl-1-draht.md Abschnitt 4: ohne das Feld lehnt der Anbieter Runde 2 mit HTTP 400 'missing field type' ab)", async () => {
  const events = [
    streamDelta({ tool_calls: [{ index: 0, id: "c1", function: { name: "take_", arguments: "" } }] }),
    streamDelta({
      tool_calls: [{ index: 0, function: { name: "message", arguments: '{"msg":"Rueckruf erbeten"}' } }],
    }),
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage: usageOf(0, 10, 5) },
    "[DONE]",
  ];
  const { provider } = providerReturning(sseResponse(events));
  const firstTurn = await provider.completeStream(
    { model: MODEL, system: "S", messages: [] },
    recordingSink(),
  );
  const expectedToolCall = {
    id: "c1",
    type: "function",
    function: { name: "take_message", arguments: '{"msg":"Rueckruf erbeten"}' },
  };
  assert.deepEqual(
    firstTurn.providerTurn.tool_calls,
    [expectedToolCall],
    "die aus SSE-Fragmenten rekonstruierte Ruecktrage muss dieselbe Form tragen wie ein Anbieter-tool_call - inkl. type",
  );

  // Runde 2: die rekonstruierte Ruecktrage geht unveraendert auf den Draht, genau wie sie
  // ein echter Aufrufer (claude.js agentTurn) zurueckschickt.
  const { provider: providerRound2, seen } = providerReturning(jsonResponse(chatResponse()));
  await providerRound2.complete({
    model: MODEL,
    system: "S",
    messages: [
      providerTurnMessage(firstTurn.providerTurn),
      toolResultsMessage([{ toolCallId: "c1", text: "notiert" }]),
    ],
  });
  assert.deepEqual(sentBody(seen).messages[1].tool_calls, [expectedToolCall]);
});

test("B5-12: Streaming - reasoning_content erreicht weder den Sink noch turn.text; die Fragmente ergeben EXAKT turn.text", async () => {
  const events = [
    streamDelta({ reasoning_content: "Die Anruferin " }),
    streamDelta({ reasoning_content: "moechte einen Termin." }),
    streamDelta({ content: "Guten " }),
    streamDelta({ content: "Tag, " }),
    streamDelta({ reasoning_content: "Noch ein Gedanke." }),
    streamDelta({ content: "Frau Berger." }),
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: usageOf(10, 5, 9) },
    "[DONE]",
  ];
  const { provider } = providerReturning(sseResponse(events));
  const sink = recordingSink();
  const turn = await provider.completeStream({ model: MODEL, system: "S", messages: [] }, sink);
  assert.equal(turn.text, "Guten Tag, Frau Berger.");
  assert.equal(
    sink.pushed.join(""),
    turn.text,
    "Vertrags-Invariante: gestreamte Fragmente ergeben aneinandergereiht EXAKT turn.text",
  );
  for (const fragment of sink.pushed)
    assert.equal(/Anruferin|Gedanke/.test(fragment), false, "Denk-Text darf nie gesprochen werden");
  assert.equal(/Anruferin|Gedanke/.test(turn.text), false);
});

test("B5-13: Streaming-Draht - stream:true plus stream_options.include_usage; usage kommt aus dem letzten Chunk", async () => {
  const events = [
    streamDelta({ content: "Ja." }),
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: usageOf(64, 36, 3) },
    "[DONE]",
  ];
  const { provider, seen } = providerReturning(sseResponse(events));
  const turn = await provider.completeStream({ model: MODEL, system: "S", messages: [] }, recordingSink());
  const body = sentBody(seen);
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.deepEqual(turn.usage, {
    inputUncachedTokens: 36,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 64,
    outputTokens: 3,
    estimated: false,
    billingModelId: MODEL,
  });
});

// ---- Fehler + Secret-Schutz ------------------------------------------------------------

test("B5-15: Fehlerklassifikation - Last-/Transportklasse transient, 4xx endgueltig, isBillingError konstant false", () => {
  for (const status of [408, 409, 429, 500, 503])
    assert.equal(deepseekErrors.isTransient({ status }), true, `HTTP ${status} ist retrybar`);
  for (const status of [400, 401, 402, 403, 404, 422])
    assert.equal(deepseekErrors.isTransient({ status }), false, `HTTP ${status} ist endgueltig`);
  assert.equal(deepseekErrors.isTransient({ cause: { code: "ECONNRESET" } }), true);
  assert.equal(deepseekErrors.isTransient({ code: "UND_ERR_SOCKET" }), true);
  assert.equal(deepseekErrors.isTransient(null), false);
  assert.equal(deepseekErrors.isTransient({ message: "irgendwas" }), false);
  // Der Bezahlfall (HTTP 402) wird anbieter-UNABHAENGIG im Seam beurteilt - eine zweite
  // Pruefung hier waere Duplizierung, jede andere Marke unbelegt.
  for (const err of [{ status: 402 }, { message: "insufficient balance" }, null])
    assert.equal(deepseekErrors.isBillingError(err), false);
});

test("B5-16: Secret-Schutz - der Schluessel steht im authorization-Header und in KEINER Fehlermeldung", async () => {
  const { provider, seen } = providerReturning(
    jsonResponse({ error: { message: "Authentication Fails, Your api key is invalid" } }, 401),
  );
  await assert.rejects(
    () => provider.complete({ model: MODEL, system: "S", messages: [] }),
    (err) => {
      assert.equal(err.status, 401, "der Status traegt Retry- und Bezahl-Klassifikation");
      assert.match(err.message, /HTTP 401/);
      assert.match(err.message, /Authentication Fails/);
      assert.equal(err.message.includes(API_KEY), false, "nie der Schluessel");
      assert.equal(err.message.includes("messages"), false, "nie der gesendete Body");
      return true;
    },
  );
  assert.equal(seen[0].init.headers.authorization, `Bearer ${API_KEY}`);
});
