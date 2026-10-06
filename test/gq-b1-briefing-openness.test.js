import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "./helpers.js";

let registerTools;
let maxInCallConsultsPerCall;
let consultInstructions;

before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ registerTools } = await import("../src/mcp-tools.js"));
  ({ MCP_CONSULT_INSTRUCTIONS: consultInstructions } = await import("../src/mcp-server-info.js"));
  ({ MAX_IN_CALL_CONSULTS_PER_CALL: maxInCallConsultsPerCall } = await import(
    "../src/consult/in-call.js"
  ));
});

const PLACE_CALL_BUDGET_CHARS = 6690;
const PLACE_CALL_WITH_CONSULT_BUDGET_CHARS = 7090;
const PREPARE_CALL_TOP_BUDGET_CHARS = 1370;
const PREPARE_CALL_NAME = "prepare_call";
const CONSULT_CTX = Object.freeze({ consultAllowed: true });
const PLACE_CALL_PREFIX = "place_call";
const ASK_FIRST = /ask the user first/gi;

const describedOf = (node) => node?.description || "";

const objectShapeOf = (node) => {
  const inner = typeof node?.unwrap === "function" ? node.unwrap() : null;
  return inner?.shape || null;
};

function captureDescriptions(ctx = {}) {
  const descriptions = new Map();
  const collect = (name, description, schema) => {
    descriptions.set(name, description || "");
    for (const [field, node] of Object.entries(schema || {})) {
      descriptions.set(`${name}.${field}`, describedOf(node));
      const shape = objectShapeOf(node);
      if (!shape) continue;
      for (const [sub, subNode] of Object.entries(shape))
        descriptions.set(`${name}.${field}.${sub}`, describedOf(subNode));
    }
  };
  const fakeServer = {
    tool: (name, description, schema) => collect(name, description, schema),
    registerTool: (name, config) => collect(name, config.description, config.inputSchema),
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return descriptions;
}

const placeCallPaths = (descriptions) =>
  [...descriptions].filter(([pfad]) => pfad.startsWith(PLACE_CALL_PREFIX));

const placeCallChars = (descriptions) =>
  placeCallPaths(descriptions).reduce((summe, [, text]) => summe + text.length, 0);

const loopSuffixOf = (plain, withConsult) => withConsult.slice(plain.length);

test("GQ-B1-01: die briefing-Beschreibung untersagt die erfundene Antwort und nennt kein kanalabhaengiges Werkzeug", () => {
  const briefing = captureDescriptions().get("place_call.briefing");
  assert.match(briefing, /never script an answer/i, "untersagt die erfundene Antwort");
  assert.doesNotMatch(briefing, /await_call_event/, "nennt kein kanalabhaengiges Werkzeug");
  assert.doesNotMatch(briefing, /get_consult/, "nennt kein kanalabhaengiges Werkzeug");
});

test("GQ-B1-02: der Hinweis auf die Live-Rueckfrage steht NUR bei aktivem Kanal", () => {
  const plain = captureDescriptions().get(PLACE_CALL_PREFIX);
  const looped = captureDescriptions(CONSULT_CTX).get(PLACE_CALL_PREFIX);
  assert.doesNotMatch(plain, /inside this loop/i, "ohne Kanal kein Schleifen-Hinweis");
  assert.match(looped, /its question reaches you only inside this loop/i, "konditional formuliert");
  assert.match(looped, /at most once/i, "nennt das Kontingent");
  assert.doesNotMatch(looped, /while the phone is still ringing/i, "keine Klingelzeit-Zusage");
});

test("GQ-B1-03: die Vorab-Rueckfrage steht an GENAU EINER Stelle des place_call-Schemas", () => {
  const treffer = placeCallPaths(captureDescriptions(CONSULT_CTX)).flatMap(([pfad, text]) =>
    (text.match(ASK_FIRST) || []).map(() => pfad),
  );
  assert.deepEqual(treffer, ["place_call.objective"], "Anzahl UND Ort sind gepinnt");
});

test("GQ-B1-04: die place_call-Beschreibungen bleiben unter dem Zeichen-Deckel", () => {
  const ohneKanal = placeCallChars(captureDescriptions());
  assert.ok(
    ohneKanal <= PLACE_CALL_BUDGET_CHARS,
    `place_call-Beschreibungen ohne Kanal: ${ohneKanal} von ${PLACE_CALL_BUDGET_CHARS} Zeichen`,
  );
  const mitKanal = placeCallChars(captureDescriptions(CONSULT_CTX));
  assert.ok(
    mitKanal <= PLACE_CALL_WITH_CONSULT_BUDGET_CHARS,
    `place_call-Beschreibungen mit Kanal: ${mitKanal} von ${PLACE_CALL_WITH_CONSULT_BUDGET_CHARS} Zeichen`,
  );
});

test("GQ-B1-04b: die Top-Beschreibung von prepare_call bleibt unter ihrem eigenen Deckel", () => {
  const top = captureDescriptions().get(PREPARE_CALL_NAME);
  assert.ok(top, "prepare_call ist registriert");
  assert.ok(
    top.length <= PREPARE_CALL_TOP_BUDGET_CHARS,
    `prepare_call-Top-Beschreibung: ${top.length} von ${PREPARE_CALL_TOP_BUDGET_CHARS} Zeichen`,
  );
});

test("GQ-B1-05: die Server-Instructions nennen die Frist, ohne eine Sekundenzahl zu nennen", () => {
  assert.ok(
    consultInstructions.includes("While a call placed with place_call is running"),
    "der Bestandssatz bleibt erhalten",
  );
  assert.match(consultInstructions, /Staying in that loop pays off/, "Bestandssatz erhalten");
  assert.match(consultInstructions, /answer within seconds/i, "nennt die Dringlichkeit");
  assert.doesNotMatch(consultInstructions, /\d+\s*(s|sec|seconds)\b/i, "keine Sekundenzahl");
});

test("GQ-B1-06: die Zahl im Loop-Text stammt aus der Zahl im Code", () => {
  assert.equal(maxInCallConsultsPerCall, 1, "das Kontingent ist EINE Rueckfrage pro Anruf");
  const suffix = loopSuffixOf(
    captureDescriptions().get(PLACE_CALL_PREFIX),
    captureDescriptions(CONSULT_CTX).get(PLACE_CALL_PREFIX),
  );
  assert.match(suffix, /at most once/i, "der Loop-Text spiegelt genau dieses Kontingent");
});

test("GQ-B2-01: die briefing-Beschreibung traegt alle drei Klassen der Wissensluecke", () => {
  const briefing = captureDescriptions().get("place_call.briefing");
  assert.match(briefing, /leave the gap open/i, "Klasse 1: die Luecke bleibt offen");
  assert.match(briefing, /declare that in one line/i, "Klasse 1: sie wird deklariert");
  assert.match(briefing, /only the principal know it/i, "Klasse 2: nur der Owner weiss es");
  assert.match(briefing, /get back on it/i, "Klasse 2: die ehrliche Prozess-Auskunft");
  assert.match(briefing, /look it up/i, "Klasse 3: oeffentlich pruefbar");
  assert.match(briefing, /write nothing/i, "Klasse 3: kein Wort dazu ins Briefing");
});

test("GQ-B2-02: die briefing-Beschreibung traegt das GQ-B1-Pauschal-Verbot NICHT mehr", () => {
  const briefing = captureDescriptions().get("place_call.briefing");
  assert.doesNotMatch(
    briefing,
    /never write that the principal will get back/i,
    "die Pauschale ist owner-revidiert",
  );
  assert.doesNotMatch(briefing, /pre-empt/i, "auch ihre Begruendung ist weg");
});

test("GQ-B2-03: die Server-Instructions nennen die eigenen Quellen zuerst und den Unbekannt-Ausgang", () => {
  assert.match(
    consultInstructions,
    /answer from your own tools and context first/i,
    "der eigene Weg steht vor jeder Nutzer-Rueckfrage",
  );
  assert.match(
    consultInstructions,
    /say with answer_consult that you do not know/i,
    "der Unbekannt-Ausgang ist ausdruecklich",
  );
  assert.match(consultInstructions, /instead of waiting/i, "Schweigen ist keine Antwort");
});

test("GQ-B2-04: die Server-Instructions kennen keine unbedingte Vorab-Rueckfrage mehr", () => {
  assert.doesNotMatch(
    consultInstructions,
    /ask the user first/i,
    "der Owner ist im Normalfall abwesend",
  );
  assert.match(
    consultInstructions,
    /only ask the user when they are actually present/i,
    "die Nutzer-Rueckfrage ist an Anwesenheit gebunden",
  );
});

test("GQ-B2-05: answer_consult traegt keine unbedingte Vorab-Rueckfrage mehr (pfad-uebergreifend)", () => {
  const answerConsult = captureDescriptions(CONSULT_CTX).get("answer_consult");
  assert.doesNotMatch(
    answerConsult,
    /ask the user first/i,
    "der Owner ist waehrend des Anrufs abwesend, wie in MCP_CONSULT_INSTRUCTIONS",
  );
  assert.match(
    answerConsult,
    /do not know, say so honestly/i,
    "der Unbekannt-Ausgang ist ausdruecklich, wie in MCP_CONSULT_INSTRUCTIONS",
  );
});
