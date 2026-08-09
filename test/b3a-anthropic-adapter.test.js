// B3a: der Anthropic-Adapter als Einheit - die EINE Uebersetzungsstelle zwischen
// Anbieter-Vokabular und der neutralen Form aus src/llm/ports.js. Reine node:test-Unit
// gegen injizierte messagesCreate/messagesStream (DIP): kein Netz, kein Store, keine
// echte Zeit (P12 F.I.R.S.T.).
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern) - Praefix ist "B3A-<n>:".
import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropicErrors, createAnthropicProvider } from "../src/llm/adapters/anthropic.js";
import { providerTurnMessage, toolResultsMessage } from "../src/llm/messages.js";
import { LLM_TOOL_CHOICE } from "../src/llm/tool-choice.js";

const MODEL = "claude-haiku-4-5";
// Anthropic antwortet mit der aufgeloesten, DATIERTEN Snapshot-ID - genau der Wert, der
// in keiner Preistabelle steht und deshalb NICHT gebucht werden darf.
const SNAPSHOT_MODEL = "claude-haiku-4-5-20260101";

const text = (value) => ({ type: "text", text: value });
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, ...(input ? { input } : {}) });

// Provider mit festem Antwort-Objekt; merkt sich, was messagesCreate bekommen hat.
function providerReturning(resp) {
  const seen = [];
  const provider = createAnthropicProvider({
    messagesCreate: (params) => {
      seen.push(params);
      return Promise.resolve(resp);
    },
  });
  return { provider, seen };
}

const turnOf = (resp, model = MODEL) =>
  providerReturning(resp).provider.complete({ model, messages: [] });

test("B3A-1: zwei Textbloecke werden mit EINEM Fugen-Leerzeichen verbunden und getrimmt", async () => {
  const turn = await turnOf({ content: [text("  Erster Block."), text("Zweiter Block.  ")] });
  assert.equal(turn.text, "Erster Block. Zweiter Block.");
});

test("B3A-2: tool_use-Bloecke werden zu {id,name,input} in Reihenfolge; fehlendes input wird {}", async () => {
  const turn = await turnOf({
    content: [
      text("Moment."),
      toolUse("tu_a", "take_message", { message: "Notiz" }),
      toolUse("tu_b", "end_call"),
    ],
  });
  assert.deepEqual(turn.toolCalls, [
    { id: "tu_a", name: "take_message", input: { message: "Notiz" } },
    { id: "tu_b", name: "end_call", input: {} },
  ]);
});

test("B3A-3: alle vier Token-Sorten werden gemeldet -> vollstaendige LlmTokenUsage, estimated:false", async () => {
  const turn = await turnOf({
    content: [],
    usage: {
      input_tokens: 5,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 100,
      output_tokens: 7,
    },
  });
  assert.deepEqual(turn.usage, {
    inputUncachedTokens: 5,
    inputCacheWriteTokens: 20,
    inputCacheReadTokens: 100,
    outputTokens: 7,
    estimated: false,
    billingModelId: MODEL,
  });
});

test("B3A-4: fehlende Cache-Felder sind 0 ('keine Token dieser Preisklasse'), nicht 'unbekannt'", async () => {
  const turn = await turnOf({ content: [], usage: { input_tokens: 5, output_tokens: 7 } });
  assert.equal(turn.usage.inputCacheWriteTokens, 0);
  assert.equal(turn.usage.inputCacheReadTokens, 0);
  assert.equal(turn.usage.estimated, false);
});

test("B3A-5: fehlt die usage ganz, greift die Notfall-Regel: Nullen + estimated:true", async () => {
  const turn = await turnOf({ content: [] });
  assert.deepEqual(turn.usage, {
    inputUncachedTokens: 0,
    inputCacheWriteTokens: 0,
    inputCacheReadTokens: 0,
    outputTokens: 0,
    estimated: true,
    billingModelId: MODEL,
  });
});

test("B3A-6: billingModelId ist die ANGEFORDERTE ID, nicht die geantwortete Snapshot-ID", async () => {
  const turn = await turnOf({
    content: [],
    model: SNAPSHOT_MODEL,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  assert.equal(turn.usage.billingModelId, MODEL);
});

test("B3A-7: providerTurn ist die Anbieter-Antwort SELBST; stopReason wird durchgereicht", async () => {
  const resp = { content: [text("ok")], stop_reason: "end_turn" };
  const turn = await turnOf(resp);
  assert.equal(turn.providerTurn, resp, "Referenzgleichheit - keine Zwischenform, kein Verlust");
  assert.equal(turn.stopReason, "end_turn");
  const ohneGrund = await turnOf({ content: [] });
  assert.equal(ohneGrund.stopReason, null);
});

test("B3A-8: die zwei neutralen Nachrichtenformen werden in Anthropic-Form uebersetzt", async () => {
  const providerTurn = { content: [toolUse("tu_a", "take_message", { message: "Notiz" })] };
  const { provider, seen } = providerReturning({ content: [] });
  await provider.complete({
    model: MODEL,
    messages: [
      { role: "user", content: "Guten Tag" },
      providerTurnMessage(providerTurn),
      toolResultsMessage([
        { toolCallId: "tu_a", text: "Nachricht ist notiert." },
        { toolCallId: "tu_b", text: "OK" },
      ]),
    ],
  });
  assert.deepEqual(seen[0].messages, [
    { role: "user", content: "Guten Tag" },
    { role: "assistant", content: providerTurn.content },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_a", content: "Nachricht ist notiert." },
        { type: "tool_result", tool_use_id: "tu_b", content: "OK" },
      ],
    },
  ]);
});

test("B3A-9: die Schluessel-Reihenfolge der Anfrage bleibt erhalten, auch wenn messages nicht letztes Feld ist", async () => {
  const { provider, seen } = providerReturning({ content: [] });
  await provider.complete({
    model: MODEL,
    maxTokens: 300,
    system: "s",
    messages: [],
    tools: [],
    toolChoice: LLM_TOOL_CHOICE.REQUIRED,
  });
  assert.deepEqual(Object.keys(seen[0]), [
    "model",
    "max_tokens",
    "system",
    "messages",
    "tools",
    "tool_choice",
  ]);
});

test("B3A-10: isBillingError erkennt Anthropics zwei Marken - und keinen beliebigen 400er", () => {
  assert.equal(anthropicErrors.isBillingError({ type: "billing_error" }), true);
  assert.equal(
    anthropicErrors.isBillingError({
      status: 400,
      message: "Your credit balance is too low to access the Anthropic API",
    }),
    true,
  );
  assert.equal(anthropicErrors.isBillingError({ status: 400, message: "invalid_request" }), false);
  assert.equal(anthropicErrors.isBillingError(null), false);
});
