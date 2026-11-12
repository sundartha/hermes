import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_WIRE_PATHS } from "../mcp-draht-pfade.js";
import {
  CALL_PURPOSE_EXCLUSIONS,
  CALL_PURPOSE_RULE,
  CALL_PURPOSE_SHORT_RULE,
  listWithOr,
} from "../../src/mcp-server-info.js";

const BRAND_NAMES = /\b(claude|gemini|chatgpt|copilot|openai)\b/i;
const FOREIGN_TOOL_CLASSES = /calendar, mail|mail, files/i;
const CHAT_HISTORY_REQUEST = /chat so far/i;
const SECOND_FUNNEL = /ADDITIONAL to the briefing/;
const FORBIDDEN_TEXT_PATTERNS = [BRAND_NAMES, FOREIGN_TOOL_CLASSES, CHAT_HISTORY_REQUEST, SECOND_FUNNEL];
const ENFORCEMENT_WORDS = /\b(server|checked|rejected|blocked|enforced|refused)\b/i;
const PURPOSE_PATTERNS = [/telemarketing/i, /political campaign/i, /advertis/i];
const PURPOSE_POSITIVE_LIST = /booking, rescheduling, enquiring or complaining/;
const OUT_OF_SCOPE_HONESTY = /not applied on every call path/i;
const CALL_TOOLS = ["place_call"];
const INSTRUCTIONS_PRIORITY_CHARS = 512;
const CALL_SEQUENCE_START = "Place a phone call with place_call only when the user asks for it";
const NARROW_PURPOSE = [/someone they act for/, /mass or automated dialling/];
const EXCLUSIONS_MISSING_FROM_SHORT_RULE = ["mass or automated dialling of many numbers"];
const MODEL_READABLE_META_KEYS = ["openai/toolInvocation/invoking", "openai/toolInvocation/invoked"];

function schemaDescriptions(node) {
  if (!node || typeof node !== "object") return [];
  const own = typeof node.description === "string" ? [node.description] : [];
  return own.concat(Object.values(node).flatMap(schemaDescriptions));
}

function modelReadableTexts(tool) {
  const meta = tool._meta || {};
  const flat = [
    tool.description,
    tool.title,
    tool.annotations?.title,
    ...MODEL_READABLE_META_KEYS.map((key) => meta[key]),
  ];
  const schemaTexts = [tool.inputSchema, tool.outputSchema].flatMap(schemaDescriptions);
  return flat.concat(schemaTexts).filter((text) => typeof text === "string");
}

function forbiddenHits(tools, instructions) {
  const sources = tools.map((tool) => [tool.name, modelReadableTexts(tool)]);
  sources.push(["instructions", [instructions || ""]]);
  return sources.flatMap(([name, texts]) =>
    FORBIDDEN_TEXT_PATTERNS.filter((pattern) => texts.some((text) => pattern.test(text))).map(
      (pattern) => `${name}: ${pattern}`,
    ),
  );
}

function toolByName(tools, name) {
  const tool = tools.find((entry) => entry.name === name);
  assert.ok(tool, `${name} fehlt im tools/list`);
  return tool;
}

const sentenceWith = (text, pattern) => text.split(/(?<=\.)\s+/).find((sentence) => pattern.test(sentence));

function assertPurposeRule(label, text) {
  for (const pattern of PURPOSE_PATTERNS) assert.match(text, pattern, `${label}: ${pattern}`);
  assert.match(text, PURPOSE_POSITIVE_LIST, `${label}: Positivliste vor dem Ausschluss`);
  const sentence = sentenceWith(text, /telemarketing/i);
  assert.doesNotMatch(sentence, ENFORCEMENT_WORDS, `${label}: Zwecksatz behauptet keine Pruefung`);
}

function outOfScopeText(tool) {
  const mandate = tool.inputSchema.properties.mandate;
  return mandate.properties.on_out_of_scope.description;
}

const snapshots = new Map();
async function snapshotOf(path) {
  if (!snapshots.has(path.label)) snapshots.set(path.label, await path.snapshot());
  return snapshots.get(path.label);
}

test("T16-kontrolle: der Scanner schlaegt auf dem alten Wortlaut an (Positiv-Kontrolle)", () => {
  const oldTool = {
    name: "place_call",
    description: "Starts a call.",
    inputSchema: {
      properties: {
        briefing: {
          description:
            "Relevant context from the chat so far (calendar, mail, files, chat) (not as Claude/Gemini).",
        },
        context: { description: "BACKGROUND, ADDITIONAL to the briefing." },
      },
    },
  };
  const hits = forbiddenHits([oldTool], "");
  assert.equal(hits.length, FORBIDDEN_TEXT_PATTERNS.length, `alle vier Muster treffen: ${hits.join(" | ")}`);
  assert.deepEqual(forbiddenHits([], "Answer with Claude."), [`instructions: ${BRAND_NAMES}`]);
});

test("T16-e: volle Zweckregel und Kurzfassung decken dieselbe Ausschluss-Tabelle ab", () => {
  assert.ok(CALL_PURPOSE_EXCLUSIONS.length > 0, "Tabelle ist nicht leer");
  for (const entry of CALL_PURPOSE_EXCLUSIONS) {
    assert.ok(Object.hasOwn(entry, "short"), `${entry.full}: short ausdruecklich gesetzt`);
    assert.ok(CALL_PURPOSE_RULE.includes(entry.full), `volle Regel nennt "${entry.full}"`);
    if (entry.short !== null)
      assert.ok(CALL_PURPOSE_SHORT_RULE.includes(entry.short), `Kurzfassung nennt "${entry.short}"`);
  }
  const missing = CALL_PURPOSE_EXCLUSIONS.filter((entry) => entry.short === null).map((entry) => entry.full);
  assert.deepEqual(missing, EXCLUSIONS_MISSING_FROM_SHORT_RULE);
  assert.doesNotMatch(CALL_PURPOSE_SHORT_RULE, ENFORCEMENT_WORDS, "Kurzfassung behauptet keine Pruefung");
});

for (const path of MCP_WIRE_PATHS) {
  test(`T16-a (${path.label}): kein Markenname, keine fremden Werkzeugklassen, kein Chat-Verlauf, kein zweiter Trichter`, async () => {
    const { tools, instructions } = await snapshotOf(path);
    assert.ok(tools.length > 0, "tools/list ist nicht leer");
    assert.deepEqual(forbiddenHits(tools, instructions), []);
  });

  test(`T16-b (${path.label}): Zweckbindung in instructions, Kurzfassung in place_call, ohne Pruefungs-Behauptung`, async () => {
    const { tools, instructions } = await snapshotOf(path);
    assertPurposeRule("instructions", instructions);
    const placeCall = toolByName(tools, "place_call").description;
    assert.ok(placeCall.includes(CALL_PURPOSE_SHORT_RULE), "place_call traegt die Kurzfassung aus der Tabelle");
    const shortRule = sentenceWith(placeCall, /telemarketing/i);
    assert.ok(shortRule, "place_call traegt die Kurzfassung");
    assert.match(shortRule, /political campaign/i);
    assert.doesNotMatch(shortRule, ENFORCEMENT_WORDS, "Kurzfassung behauptet keine Pruefung");
  });

  test(`T16-d (${path.label}): Zweckregel wortgleich aus einer Quelle, eng, hinter der Anruf-Sequenz`, async () => {
    const { instructions } = await snapshotOf(path);
    assert.ok(instructions.includes(CALL_PURPOSE_RULE), "instructions");
    for (const pattern of NARROW_PURPOSE) assert.match(CALL_PURPOSE_RULE, pattern);
    const sequenceAt = instructions.indexOf(CALL_SEQUENCE_START);
    assert.ok(sequenceAt >= 0, "Anruf-Sequenz vorhanden");
    assert.ok(sequenceAt < INSTRUCTIONS_PRIORITY_CHARS, `Sequenz beginnt bei ${sequenceAt}`);
    assert.ok(sequenceAt < instructions.indexOf(CALL_PURPOSE_RULE), "Zweckregel steht hinter der Sequenz");
  });

  test(`T16-c (${path.label}): on_out_of_scope ehrlich`, async () => {
    const { tools } = await snapshotOf(path);
    for (const name of CALL_TOOLS)
      assert.match(outOfScopeText(toolByName(tools, name)), OUT_OF_SCOPE_HONESTY, name);
  });
}

test("T16-g: listWithOr an den Raendern - ein Glied steht allein, leer bleibt leer, mehrere wie bisher", () => {
  assert.equal(listWithOr(["telemarketing"], " or "), "telemarketing");
  assert.equal(listWithOr([], ", or "), "");
  assert.equal(listWithOr(["a", "b"], " or "), "a or b");
  assert.equal(listWithOr(["a", "b", "c"], ", or "), "a, b, or c");
});
