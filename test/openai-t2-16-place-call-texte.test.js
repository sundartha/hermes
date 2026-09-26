// place_call-/prepare_call-Texte: neutral (kein Markenname eines Chat-Modells, keine fremden
// Werkzeugklassen), minimal (kein "Chat bisher", kein zweiter Sammeltrichter), mit enger
// Zweckbindung als NUTZUNGSREGEL (nicht als Pruefung ausgegeben), ehrlichem Hinweis zu
// on_out_of_scope und dem Satz zu sensiblen Mandaten. Gemessen NUR am echten Draht
// (tools/list + initialize-instructions) auf sieben Pfaden, s. test/mcp-draht-pfade.js.
// Testnamen ohne Katalog-/ABNAHME-Praefix, sonst landen sie im falschen Lauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_WIRE_PATHS } from "./mcp-draht-pfade.js";
import { CALL_PURPOSE_RULE } from "../src/mcp-server-info.js";

const BRAND_NAMES = /\b(claude|gemini|chatgpt|copilot|openai)\b/i;
const FOREIGN_TOOL_CLASSES = /calendar, mail|mail, files/i;
const CHAT_HISTORY_REQUEST = /chat so far/i;
const SECOND_FUNNEL = /ADDITIONAL to the briefing/;
const FORBIDDEN_TEXT_PATTERNS = [BRAND_NAMES, FOREIGN_TOOL_CLASSES, CHAT_HISTORY_REQUEST, SECOND_FUNNEL];
// Der Zwecksatz ist eine Nutzungsregel an das Modell - der Server prueft den Zweck nicht.
// Ein Durchsetzungs-Verb darin waere eine unwahre Behauptung gegenueber dem Pruefer.
const ENFORCEMENT_WORDS = /\b(server|checked|rejected|blocked|enforced|refused)\b/i;
const PURPOSE_PATTERNS = [/telemarketing/i, /political campaign/i, /advertis/i];
const PURPOSE_POSITIVE_LIST = /booking, rescheduling, enquiring or complaining/;
const OUT_OF_SCOPE_HONESTY = /not applied on every call path/i;
const SENSITIVE_MANDATES = /contracts, loans, insurance, tenancy, employment or legal matters/;
const CALL_TOOLS = ["prepare_call", "place_call"];
// OpenAI: "Keep the most important details in the first 512 characters". Die
// Bestaetigungs-Sequenz beginnt dort, die Zweckregel folgt ihr (nicht umgekehrt).
const INSTRUCTIONS_PRIORITY_CHARS = 512;
const CONFIRMATION_SEQUENCE_START = "Before every place_call, call prepare_call first";
// Enge Fassung (Verweigerungsrisiko): Auftrag auch fuer Angehoerige, ausgeschlossen nur die
// Massenanwahl, und die Terminwahl bleibt bei sensiblen Mandaten erlaubt.
const NARROW_PURPOSE = [/someone they act for/, /mass or automated dialling/];
const APPOINTMENT_TIMES_ALLOWED = /decide_freely cover appointment times only/;
// Nur die Werte dieser _meta-Schluessel sind modell-lesbarer Text; die Schluessel selbst
// heissen protokollbedingt "openai/..." und sind kein Werkzeugtext.
const MODEL_READABLE_META_KEYS = ["openai/toolInvocation/invoking", "openai/toolInvocation/invoked"];

// Jede `description` in einem JSON-Schema, rekursiv (properties, items, anyOf ...).
function schemaDescriptions(node) {
  if (!node || typeof node !== "object") return [];
  const own = typeof node.description === "string" ? [node.description] : [];
  return own.concat(Object.values(node).flatMap(schemaDescriptions));
}

// Alle modell-lesbaren Texte eines Werkzeugs am Draht.
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

// Scanner: liefert je Treffer "<werkzeug>: <muster>". Leer = sauber.
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

// Einmal je Pfad messen, alle Faelle lesen denselben Schnappschuss.
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

for (const path of MCP_WIRE_PATHS) {
  test(`T16-a (${path.label}): kein Markenname, keine fremden Werkzeugklassen, kein Chat-Verlauf, kein zweiter Trichter`, async () => {
    const { tools, instructions } = await snapshotOf(path);
    assert.ok(tools.length > 0, "tools/list ist nicht leer");
    assert.deepEqual(forbiddenHits(tools, instructions), []);
  });

  test(`T16-b (${path.label}): Zweckbindung in prepare_call und instructions, Kurzfassung in place_call, ohne Pruefungs-Behauptung`, async () => {
    const { tools, instructions } = await snapshotOf(path);
    assertPurposeRule("prepare_call", toolByName(tools, "prepare_call").description);
    assertPurposeRule("instructions", instructions);
    const placeCall = toolByName(tools, "place_call").description;
    const shortRule = sentenceWith(placeCall, /telemarketing/i);
    assert.ok(shortRule, "place_call traegt die Kurzfassung");
    assert.match(shortRule, /political campaign/i);
    assert.doesNotMatch(shortRule, ENFORCEMENT_WORDS, "Kurzfassung behauptet keine Pruefung");
  });

  test(`T16-d (${path.label}): Zweckregel wortgleich aus einer Quelle, eng, hinter der Bestaetigungs-Sequenz`, async () => {
    const { tools, instructions } = await snapshotOf(path);
    assert.ok(toolByName(tools, "prepare_call").description.includes(CALL_PURPOSE_RULE), "prepare_call");
    assert.ok(instructions.includes(CALL_PURPOSE_RULE), "instructions");
    for (const pattern of NARROW_PURPOSE) assert.match(CALL_PURPOSE_RULE, pattern);
    const sequenceAt = instructions.indexOf(CONFIRMATION_SEQUENCE_START);
    assert.ok(sequenceAt >= 0, "Bestaetigungs-Sequenz vorhanden");
    assert.ok(sequenceAt < INSTRUCTIONS_PRIORITY_CHARS, `Sequenz beginnt bei ${sequenceAt}`);
    assert.ok(sequenceAt < instructions.indexOf(CALL_PURPOSE_RULE), "Zweckregel steht hinter der Sequenz");
  });

  test(`T16-c (${path.label}): on_out_of_scope ehrlich, sensible Mandate in prepare_call`, async () => {
    const { tools } = await snapshotOf(path);
    for (const name of CALL_TOOLS)
      assert.match(outOfScopeText(toolByName(tools, name)), OUT_OF_SCOPE_HONESTY, name);
    const prepare = toolByName(tools, "prepare_call").description;
    const sentence = sentenceWith(prepare, SENSITIVE_MANDATES);
    assert.ok(sentence, "Satz zu sensiblen Mandaten vorhanden");
    assert.match(sentence, /decide_freely/);
    assert.match(sentence, /accept_best/);
    assert.match(sentence, APPOINTMENT_TIMES_ALLOWED, "Terminwahl bleibt erlaubt");
    assert.doesNotMatch(sentence, ENFORCEMENT_WORDS, "keine Pruefungs-Behauptung");
  });
}
