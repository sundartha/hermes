import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config.js";
import { createLlmProvider, latchBillingBlockedProvider } from "../../src/llm/registry.js";
import { makeTransientClassifier } from "../../src/llm/transient-errors.ts";
import { makeConfigOverrides } from "../helpers.js";
import { LLM_LUECKEN_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const { withConfigOverrides } = makeConfigOverrides(config);
const MODEL = "deepseek-v4-pro";
const KEY = LLM_LUECKEN_SCHLUESSEL;
const isTransient = makeTransientClassifier();

test("3395-1: Transient-Tabelle - jeder Transportcode, Statusgrenzen, Ursachenkette ohne Endlosschleife", () => {
  for (const code of [
    "ERR_STREAM_PREMATURE_CLOSE",
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EPIPE",
  ])
    assert.equal(isTransient({ code }), true, code);
  const selbst = {};
  selbst.cause = selbst;
  const faelle = [
    [{ code: "EACCES" }, false],
    [{ code: "" }, false],
    [{ status: 499 }, false],
    [{ status: 500 }, true],
    [{ status: 407 }, false],
    [{ status: 408 }, true],
    [{ status: "503", code: "EPIPE" }, true],
    [{ status: 404, code: "ECONNRESET" }, false],
    [{ status: 400, message: "Premature close" }, false],
    [{ message: "Premature close" }, true],
    [{ message: "premature close" }, false],
    [{ cause: { cause: { code: "EPIPE" } } }, true],
    [selbst, false],
    [{ cause: undefined }, false],
    [undefined, false],
  ];
  for (const [err, erwartet] of faelle)
    assert.equal(isTransient(err), erwartet, String(err?.code ?? err?.status ?? err?.message));
});

test("3395-2: Transient-Klassifizierer - Anbieter-Verbindungsfehler zaehlt nur, wenn der Anbieter ihn meldet", () => {
  const verbindung = { name: "Verbindung" };
  assert.equal(isTransient(verbindung), false);
  const mitAnbieter = makeTransientClassifier((err) => err === verbindung);
  assert.equal(mitAnbieter(verbindung), true);
  assert.equal(mitAnbieter({ name: "andere" }), false);
});

test("3395-3: Latch - ohne Ausweichanbieter null, mit Ausweichanbieter wechselt der Zielanbieter und meldet die Frist", async () => {
  const ZEIT_IN_DER_VERGANGENHEIT_MS = 1000;
  assert.equal(latchBillingBlockedProvider(ZEIT_IN_DER_VERGANGENHEIT_MS), null);
  await withConfigOverrides(
    { llmProviderFallback: "deepseek", llmBillingLatchCooldownMs: 4321 },
    async () => {
      assert.deepEqual(latchBillingBlockedProvider(ZEIT_IN_DER_VERGANGENHEIT_MS), {
        blockedProvider: "anthropic",
        nextProvider: "deepseek",
        cooldownMs: 4321,
        freshlyLatched: true,
      });
    },
  );
});

function sendet(antwort, optionen = {}) {
  const gesehen = [];
  const provider = withConfigOverrides({ llmProvider: "deepseek", deepseekApiKey: KEY }, () =>
    createLlmProvider({
      ...optionen,
      chatCompletionsFetch: (url, init) => {
        gesehen.push({ url, init });
        return Promise.resolve(antwort);
      },
    }),
  );
  return { provider, gesehen };
}

const ok = (message, extra = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message, ...extra }] }),
  text: async () => "",
});
const roh = { model: MODEL, system: "S", messages: [] };
const sinkMitText = () => {
  const gepusht = [];
  let starts = 0;
  return {
    gepusht,
    starts: () => starts,
    pushText: (t) => gepusht.push(t),
    toolUseStarted: () => starts++,
  };
};

test("3395-5: DeepSeek - Adresse, Methode und Kopfzeilen; Standard-Basis und eigene Basis", async () => {
  const standard = sendet(ok({ content: "a" }));
  await standard.provider.complete(roh);
  const [angefragt] = standard.gesehen;
  assert.equal(angefragt.url, "https://api.deepseek.com/chat/completions");
  assert.equal(angefragt.init.method, "POST");
  assert.deepEqual(angefragt.init.headers, {
    authorization: `Bearer ${KEY}`,
    "content-type": "application/json",
  });
  const eigene = sendet(ok({ content: "a" }), { baseUrl: "https://proxy.example.test" });
  await eigene.provider.complete(roh);
  assert.equal(eigene.gesehen[0].url, "https://proxy.example.test/chat/completions");
});

test("3395-6: DeepSeek - Werkzeug-Argumente null/fehlend sind leer, Name fehlt oder ist leer wirft, Antwortform ohne Text/Liste", async () => {
  const mitAufrufen = async (toolCalls) =>
    sendet(ok({ content: "x", tool_calls: toolCalls })).provider.complete(roh);
  const leer = await mitAufrufen([
    { id: "c1", function: { name: "a", arguments: null } },
    { id: "c2", function: { name: "b" } },
    { id: "c3", function: { name: "c", arguments: "   " } },
  ]);
  assert.deepEqual(
    leer.toolCalls.map((c) => c.input),
    [{}, {}, {}],
  );
  await assert.rejects(
    () => mitAufrufen([{ id: "c9", function: { name: "", arguments: "{}" } }]),
    /ohne Namen \(Aufruf c9\)/,
  );
  await assert.rejects(
    () => mitAufrufen([{ id: "c8", function: { arguments: "{}" } }]),
    /ohne Namen \(Aufruf c8\)/,
  );
  await assert.rejects(
    () => mitAufrufen([{ id: "c7", function: { name: "n", arguments: { a: 1 } } }]),
    /sind kein JSON-Objekt/,
  );
  const form = await sendet(ok({ content: 5, tool_calls: "kaputt" })).provider.complete(roh);
  assert.equal(form.text, "");
  assert.deepEqual(form.toolCalls, []);
  assert.deepEqual(form.providerTurn, { role: "assistant", content: "" });
  assert.equal(form.stopReason, null);
  const einfach = await sendet(
    ok({ content: "Hi" }, { finish_reason: "length" }),
  ).provider.complete(roh);
  assert.deepEqual(einfach.providerTurn, { role: "assistant", content: "Hi" });
  assert.equal(einfach.stopReason, "length");
});

test("3395-7: DeepSeek - Verbrauch ohne Cache-Zahlen schaetzt aus prompt_tokens oder hit+miss; Unzahlen zaehlen 0", async () => {
  const verbrauch = async (usage) =>
    (
      await sendet({
        ...ok({ content: "" }),
        json: async () => ({ choices: [{ message: {} }], usage }),
      }).provider.complete(roh)
    ).usage;
  assert.deepEqual(await verbrauch({ prompt_tokens: 50, completion_tokens: 7 }), {
    inputUncachedTokens: 50,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: 7,
    estimated: true,
    billingModelId: MODEL,
  });
  assert.equal(
    (await verbrauch({ prompt_cache_hit_tokens: 30, prompt_cache_miss_tokens: 12 }))
      .inputUncachedTokens,
    42,
  );
  assert.equal((await verbrauch({ prompt_cache_hit_tokens: 30 })).inputUncachedTokens, 30);
  assert.equal((await verbrauch({ prompt_cache_miss_tokens: 12 })).inputUncachedTokens, 12);
  const unzahl = await verbrauch({ prompt_tokens: "50", completion_tokens: "7" });
  assert.equal(unzahl.inputUncachedTokens, 0);
  assert.equal(unzahl.outputTokens, 0);
  assert.equal(
    (
      await verbrauch({
        prompt_tokens: 10,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
        completion_tokens: 0,
      })
    ).estimated,
    false,
    "completion_tokens 0 ist eine gemeldete Zahl",
  );
});

test("3395-8: DeepSeek - Fehlerantwort - Text gekuerzt auf 200 Zeichen, ohne Anbieter-Text nur Status, unlesbarer Body ebenso", async () => {
  const fehler = async (res) => {
    const err = await sendet(res)
      .provider.complete(roh)
      .catch((e) => e);
    assert.equal(err.status, res.status);
    return err.message;
  };
  const lang = "x".repeat(250);
  const kurz = async (error) =>
    fehler({ ok: false, status: 503, text: async () => JSON.stringify({ error }) });
  assert.equal(await kurz({ message: lang }), `DeepSeek-Adapter: HTTP 503 - ${"x".repeat(200)}`);
  assert.equal(await kurz({ message: "" }), "DeepSeek-Adapter: HTTP 503");
  assert.equal(await kurz({ message: 42 }), "DeepSeek-Adapter: HTTP 503");
  assert.equal(
    await fehler({ ok: false, status: 502, text: async () => "<html>" }),
    "DeepSeek-Adapter: HTTP 502",
  );
  assert.equal(
    await fehler({ ok: false, status: 500, text: () => Promise.reject(new Error("abgebrochen")) }),
    "DeepSeek-Adapter: HTTP 500",
  );
  const stream = await sendet({ ok: false, status: 429, text: async () => "{}" })
    .provider.completeStream(roh, { pushText() {}, toolUseStarted() {} })
    .catch((e) => e);
  assert.equal(stream.status, 429);
});

function bytesAntwort(stuecke) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < stuecke.length
            ? { value: stuecke[i++], done: false }
            : { value: undefined, done: true },
      }),
    },
  };
}

const kodiert = (text) => new TextEncoder().encode(text);
const chunk = (delta, finish) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}`;

test("3395-9: DeepSeek-Strom - letztes Ereignis ohne Trenner, kaputtes JSON, fremde Zeilen, leere Deltas, mehrere data-Zeilen und Umlaut ueber Chunk-Grenze", async () => {
  const umlaut = kodiert(
    "data: " + JSON.stringify({ choices: [{ delta: { content: "Grüße" } }] }) + "\n\n",
  );
  const schnitt = umlaut.indexOf(0xc3) + 1;
  const stuecke = [
    umlaut.slice(0, schnitt),
    umlaut.slice(schnitt),
    kodiert(`: kommentar\nevent: x\n${chunk({ content: "" })}\n\ndata: {kaputt\n\n`),
    kodiert(
      `data:${JSON.stringify({ choices: [{ delta: { content: " A" } }] })}\ndata: ${JSON.stringify({ choices: [{ delta: { content: "B" } }] })}\n\n`,
    ),
    kodiert(`${chunk({ content: "!" }, "stop")}`),
  ];
  const sink = sinkMitText();
  const turn = await sendet(bytesAntwort(stuecke)).provider.completeStream(roh, sink);
  assert.deepEqual(sink.gepusht, ["Grüße", " A", "B", "!"]);
  assert.equal(turn.text, "Grüße AB!");
  assert.equal(turn.stopReason, "stop");
  assert.equal(sink.starts(), 0);
});

test("3395-10: DeepSeek-Strom - Werkzeugaufrufe nach index sortiert, Verbrauch aus dem Ereignis, nur Leerraum am Ende erzeugt kein Ereignis", async () => {
  const text =
    [
      chunk({ tool_calls: [{ index: 1, id: "b", function: { name: "zwei", arguments: "{}" } }] }),
      chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "eins", arguments: "{}" } }] }),
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, completion_tokens: 2 } })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n  \n";
  const sink = sinkMitText();
  const turn = await sendet(bytesAntwort([kodiert(text)])).provider.completeStream(roh, sink);
  assert.deepEqual(
    turn.toolCalls.map((c) => c.name),
    ["eins", "zwei"],
  );
  assert.equal(sink.starts(), 2);
  assert.deepEqual(
    [turn.usage.inputUncachedTokens, turn.usage.inputCacheReadTokens, turn.usage.outputTokens],
    [6, 4, 2],
  );
  assert.equal(turn.usage.estimated, false);
  assert.deepEqual(turn.text, "");
});
