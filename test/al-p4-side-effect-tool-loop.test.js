import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const SUBSTANTIAL = "Ja, Donnerstag passt gut";
const HALLUCINATED_TOOL = "look_up_not_yet_built";

function message(content, stopReason) {
  return {
    id: "msg_alp4",
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
const toolOnly = (name, input = {}) => message([{ type: "tool_use", id: "tu1", name, input }], "tool_use");
const textPlus = (text, ...names) =>
  message(
    [
      { type: "text", text },
      ...names.map((n, i) => ({ type: "tool_use", id: `tu${i}`, name: n, input: { message: "Notiz" } })),
    ],
    "tool_use",
  );

const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

let server;
let queue = [];
let bodies = [];

let store, agentTurn, isSideEffectOnlyTool, toolDefs;
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
  process.env.ANTHROPIC_API_KEY = "test-alp4-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({ id: "call_alp4_1", direction: "outbound", language: "de" }),
        seedCall({ id: "call_alp4_2", direction: "outbound", language: "de" }),
        seedCall({ id: "call_alp4_3", direction: "outbound", language: "de" }),
        seedCall({ id: "call_alp4_4", direction: "outbound", language: "de" }),
        seedCall({ id: "call_alp4_5", direction: "outbound", language: "de" }),
        seedCall({ id: "call_alp4_6", direction: "outbound", language: "de" }),
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ agentTurn, isSideEffectOnlyTool, toolDefs } = await import("../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test("AL-P4-1: take_message mit begleitendem Text beendet den Turn nach EINEM Roundtrip", async () => {
  bodies = [];
  queue = [textPlus("Ich gebe das an Jonas weiter.", "take_message")];
  const call = store.getCall("call_alp4_1");
  const turn = await agentTurn(call, "Ruf mich morgen zurueck.");
  assert.equal(bodies.length, 1, "genau ein llm.complete-Aufruf");
  assert.equal(turn.roundtrips, 1);
  assert.deepEqual(turn.toolNames, ["take_message"]);
  assert.equal(turn.endCall, false);
  assert.equal(turn.speech, "Ich gebe das an Jonas weiter.");
});

test("AL-P4-2: der Seiteneffekt laeuft trotz fruehem Abbruch", async () => {
  bodies = [];
  queue = [textPlus("Ich notiere das.", "take_message")];
  const call = store.getCall("call_alp4_2");
  await agentTurn(call, "Bitte richte etwas aus.");
  assert.equal(store.getCall("call_alp4_2").actionItemIds.length, 1);
});

test("AL-P4-3: take_message OHNE Text laeuft weiter wie im Bestand", async () => {
  bodies = [];
  queue = [toolOnly("take_message", { message: "Notiz" }), textOnly("Mache ich.")];
  const call = store.getCall("call_alp4_3");
  const turn = await agentTurn(call, "Bitte richte etwas aus.");
  assert.equal(bodies.length, 2, "ohne begleitenden Text bleibt der zweite Roundtrip bestehen");
  assert.equal(turn.roundtrips, 2);
});

test("AL-P4-4: end_call mit Text bleibt beim Ein-Runden-Ausstieg", async () => {
  bodies = [];
  queue = [textPlus("Danke, bis dann.", "end_call")];
  const call = store.getCall("call_alp4_4");
  const turn = await agentTurn(call, SUBSTANTIAL);
  assert.equal(bodies.length, 1);
  assert.equal(turn.endCall, true);
});

test("AL-P4-5: end_call neben einem unklassifizierten Werkzeug bricht weiterhin ab (nur-erweitern-Invariante)", async () => {
  bodies = [];
  queue = [textPlus("Danke.", HALLUCINATED_TOOL, "end_call")];
  const call = store.getCall("call_alp4_5");
  const turn = await agentTurn(call, SUBSTANTIAL);
  assert.equal(bodies.length, 1);
  assert.equal(turn.endCall, true);
});

test("AL-P4-6: ein unklassifiziertes Werkzeug mit Text bricht NICHT ab", async () => {
  bodies = [];
  queue = [textPlus("Moment.", HALLUCINATED_TOOL), textOnly("Da steht Folgendes.")];
  const call = store.getCall("call_alp4_6");
  const turn = await agentTurn(call, "Frag doch mal nach.");
  assert.equal(bodies.length, 2, "der Platz, den AL-P10b/P14 fuer informationsliefernde Tools brauchen");
  assert.equal(turn.roundtrips, 2);
});

test("AL-P4-7: isSideEffectOnlyTool klassifiziert beide Bestandswerkzeuge und nichts sonst", () => {
  assert.equal(isSideEffectOnlyTool("end_call"), true);
  assert.equal(isSideEffectOnlyTool("take_message"), true);
  assert.equal(isSideEffectOnlyTool(HALLUCINATED_TOOL), false);
  assert.equal(isSideEffectOnlyTool(""), false);
  assert.equal(isSideEffectOnlyTool(undefined), false);
});

test("AL-P4-8: heute ist JEDES Werkzeug aus toolDefs ein Seiteneffekt-Werkzeug", () => {
  assert.ok(toolDefs("de").every((t) => isSideEffectOnlyTool(t.name)));
});

test("AL-P4-9: die take_message-Beschreibung verlangt den Satz in derselben Antwort", () => {
  const expectations = [
    ["de", "in dieselbe Antwort"],
    ["en", "in the very same reply"],
    ["fr", "dans la réponse MÊME"],
  ];
  for (const [lang, clause] of expectations) {
    const def = toolDefs(lang).find((t) => t.name === "take_message");
    assert.ok(
      def.description.includes(clause),
      `${lang}: take_message-Description muss "${clause}" enthalten`,
    );
  }
});
