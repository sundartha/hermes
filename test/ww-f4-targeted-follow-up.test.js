import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  announcesConsultAction,
  announcesToolAction,
  followUpToolChoiceFor,
} from "../src/tool-follow-up.js";
import { LLM_TOOL_CHOICE, forcedTool } from "../src/llm/tool-choice.js";

const OWNER = "Jonas Beispiel";
const CONSULT = "get_consult";
const TAKE_MESSAGE = "take_message";
const END_CALL = "end_call";
const LANGUAGES = ["de", "en", "fr"];
const CALLER = "Donnerstag um siebzehn Uhr, der Grosscheck kostet fuenfundneunzig Euro";
const CONSULT_ANNOUNCEMENT = "Da müsste ich noch Rücksprache mit Jonas halten.";
const MESSAGE_ANNOUNCEMENT = "Ich gebe Jonas die Option aber gern weiter.";
const BESCHEID_ANNOUNCEMENT = "Ich gebe Jonas aber gerne Bescheid: Donnerstag ginge auch.";
const QUESTION = "Darf der Termin auf einen anderen Wochentag rutschen?";

function message(content, stopReason) {
  return {
    id: "msg_wwf4",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const textOnly = (text) => message([{ type: "text", text }], "end_turn");
const toolOnly = (name, input = {}) =>
  message([{ type: "tool_use", id: "tu1", name, input }], "tool_use");
const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

let server;
let queue = [];
let bodies = [];
let store, agentTurn;

function armCall(id) {
  const call = store.getCall(id);
  call.answeredAt = new Date().toISOString();
  call.consultPolledAtMs = Date.now();
  return call;
}

const toolNamesOf = (body) => body.tools.map((t) => t.name);

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queue.shift() || textOnly(UNWANTED_EXTRA_ROUNDTRIP_MARKER)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-wwf4-key";
  process.env.TOOL_FOLLOW_UP_ENABLED = "true";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const calls = Array.from({ length: 4 }, (_, i) =>
    seedCall({ id: `call_wwf4_${i + 1}`, direction: "outbound", language: "de" }),
  );
  calls.push(seedCall({ id: "call_wwf4_inbound", direction: "inbound", language: "de" }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ agentTurn } = await import("../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("WW-F4-1 angekuendigte Ruecksprache + get_consult im Zug -> der Nachfass-Zug erzwingt get_consult BENANNT", async () => {
  bodies = [];
  queue = [textOnly(CONSULT_ANNOUNCEMENT), toolOnly(CONSULT, { question: QUESTION })];
  const call = armCall("call_wwf4_1");
  const turn = await agentTurn(call, CALLER);

  assert.equal(bodies.length, 2, "genau ein zusaetzlicher Roundtrip");
  assert.equal("tool_choice" in bodies[0], false, "Runde 1 traegt kein tool_choice");
  assert.deepEqual(bodies[1].tool_choice, { type: "tool", name: CONSULT });
  assert.ok(toolNamesOf(bodies[1]).includes(CONSULT), "das benannte Werkzeug liegt im Satz");
  assert.equal(toolNamesOf(bodies[1]).includes(END_CALL), false, "B6 haelt: kein end_call");
  assert.deepEqual(turn.toolNames, [CONSULT], "die Rueckfrage ist wirklich gestellt");
  assert.equal(store.getCall("call_wwf4_1").consults.length, 1, "Consult-Datensatz existiert");
});

test("WW-F4-2 angekuendigte NACHRICHT -> KEIN benannter Zwang auf get_consult, obwohl es im Zug liegt", async () => {
  bodies = [];
  queue = [
    textOnly(MESSAGE_ANNOUNCEMENT),
    toolOnly(TAKE_MESSAGE, { message: "Option Donnerstag" }),
  ];
  const call = armCall("call_wwf4_2");
  const turn = await agentTurn(call, CALLER);

  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].tool_choice, { type: "any" });
  assert.ok(
    toolNamesOf(bodies[1]).includes(CONSULT),
    "get_consult LAG im Zug - die freie Wahl ist die Aussage, nicht ein fehlendes Werkzeug",
  );
  assert.deepEqual(turn.toolNames, [TAKE_MESSAGE]);
  assert.equal(store.getCall("call_wwf4_2").consults, null, "keine Rueckfrage erzwungen");
});

test("WW-F4-3 ohne get_consult im Zug (Inbound) bleibt der Nachfass-Zug beim Bestands-Zwang", async () => {
  bodies = [];
  queue = [
    textOnly(CONSULT_ANNOUNCEMENT),
    toolOnly(TAKE_MESSAGE, { message: "Rueckfrage an Jonas" }),
  ];
  const call = armCall("call_wwf4_inbound");
  const turn = await agentTurn(call, CALLER);

  assert.equal(bodies.length, 2);
  assert.equal(toolNamesOf(bodies[1]).includes(CONSULT), false, "Inbound sieht das Werkzeug nie");
  assert.deepEqual(bodies[1].tool_choice, { type: "any" }, "unveraendertes Bestandsverhalten");
  assert.deepEqual(turn.toolNames, [TAKE_MESSAGE]);
});

test("WW-F4-4 die Obergrenze aus F2 haelt auch im benannten Zwang: hoechstens EIN Nachfassen je Zug", async () => {
  bodies = [];
  queue = [textOnly(CONSULT_ANNOUNCEMENT), textOnly(CONSULT_ANNOUNCEMENT)];
  const call = armCall("call_wwf4_3");
  const turn = await agentTurn(call, CALLER);

  assert.equal(bodies.length, 2, "hoechstens EIN Nachfassen je Zug");
  assert.equal(
    bodies.filter((b) => "tool_choice" in b).length,
    1,
    "genau eine erzwungene Runde im ganzen Zug",
  );
  assert.equal(turn.speech, CONSULT_ANNOUNCEMENT, "der Zug endet mit dem Text, nie in Stille");
});

test("WW-F4-5 die neu erkannte Bescheid-Form loest ein Nachfassen aus - als NACHRICHT, nicht als Rueckfrage", async () => {
  bodies = [];
  queue = [
    textOnly(BESCHEID_ANNOUNCEMENT),
    toolOnly(TAKE_MESSAGE, { message: "Donnerstag als Option" }),
  ];
  const call = armCall("call_wwf4_4");
  const turn = await agentTurn(call, CALLER);

  assert.equal(bodies.length, 2, "die Marker-Luecke ist geschlossen - es wird nachgefasst");
  assert.deepEqual(
    bodies[1].tool_choice,
    { type: "any" },
    "eine Weitergabe bleibt eine Weitergabe",
  );
  assert.deepEqual(turn.toolNames, [TAKE_MESSAGE]);
});

test("WW-F4-6 followUpToolChoiceFor: benannt NUR bei Ruecksprache UND angebotenem Werkzeug", () => {
  const withConsult = [{ name: TAKE_MESSAGE }, { name: CONSULT }];
  const withoutConsult = [{ name: TAKE_MESSAGE }];
  const choiceFor = (text, candidateTools) =>
    followUpToolChoiceFor({ text, language: "de", candidateTools, consultToolName: CONSULT });

  assert.deepEqual(
    choiceFor(CONSULT_ANNOUNCEMENT, withConsult),
    forcedTool(CONSULT),
    "Ruecksprache + Werkzeug im Zug",
  );
  assert.equal(
    choiceFor(MESSAGE_ANNOUNCEMENT, withConsult),
    LLM_TOOL_CHOICE.REQUIRED,
    "Nachricht wird nicht umgebogen",
  );
  assert.equal(
    choiceFor(BESCHEID_ANNOUNCEMENT, withConsult),
    LLM_TOOL_CHOICE.REQUIRED,
    "auch die neue Bescheid-Form ist eine Nachricht",
  );
  assert.equal(
    choiceFor(CONSULT_ANNOUNCEMENT, withoutConsult),
    LLM_TOOL_CHOICE.REQUIRED,
    "ohne angebotenes get_consult bleibt es beim Sammel-Zwang",
  );
  assert.deepEqual(
    choiceFor("Ich frage bei Jonas nach und gebe Ihnen dann Bescheid.", withConsult),
    forcedTool(CONSULT),
    "beide Klassen im Text -> die Rueckfrage gewinnt",
  );
});

test("WW-F4-7 die neuen Marker tragen in allen drei Sprachen - und ein harmloser Satz loest NICHTS aus", () => {
  const cases = {
    de: {
      hits: [BESCHEID_ANNOUNCEMENT, "Ich sage Jonas Bescheid.", "Ich werde Jonas Bescheid geben."],
      misses: [
        "Sagen Sie mir gerne Bescheid, wenn sich etwas ändert.",
        "Da weiß ich Bescheid, das passt.",
        "Donnerstag um siebzehn Uhr passt gut.",
      ],
    },
    en: {
      hits: ["I'll let Jonas know.", "I will let him know today."],
      misses: ["Please let me know if anything changes.", "Thursday at five works fine."],
    },
    fr: {
      hits: ["Je le tiens au courant.", "Je vais le tenir au courant."],
      misses: ["Pouvez-vous me tenir au courant ?", "Jeudi dix-sept heures, cela convient."],
    },
  };
  for (const lang of LANGUAGES) {
    for (const hit of cases[lang].hits) {
      assert.equal(announcesToolAction(hit, lang), true, `${lang}: nicht erkannt - ${hit}`);
      assert.equal(
        announcesConsultAction(hit, lang),
        false,
        `${lang}: als Rueckfrage missverstanden - ${hit}`,
      );
    }
    for (const miss of cases[lang].misses)
      assert.equal(announcesToolAction(miss, lang), false, `${lang}: falsch erkannt - ${miss}`);
  }
});
