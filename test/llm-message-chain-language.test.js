import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";

const OUTBOUND_OPENING_BOOTSTRAP = "[Der Angerufene hat abgenommen. Beginne das Gespraech.]";
const SILENT_TURN_MARKER = "[Es kam keine Antwort.]";
const TAKE_MESSAGE_RESULT = "Nachricht ist notiert.";
const END_CALL_WAIT_INSTRUCTION_TEXT =
  "Dein Gegenüber hat noch nichts gesagt. Lege nicht auf - warte auf seine Antwort.";

function textMessage(text) {
  return {
    id: "msg_gap28_text",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function toolUseOnlyMessage(name, input = {}) {
  return {
    id: "msg_gap28_tool",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "tool_use", id: "tu_gap28", name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 4 },
  };
}

let server;
let queue = [];
let bodies = [];

let store, agentTurn;
before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queue.shift() || textMessage("Alright, thank you for your time.")));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-gap28-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({ id: "call_gap28_boot", direction: "outbound", language: "en" }),
        seedCall({
          id: "call_gap28_silent",
          direction: "outbound",
          language: "en",
          transcript: [{ role: "agent", text: "Hello, this is calling on behalf of Jonas." }],
        }),
        seedCall({
          id: "call_gap28_msg",
          direction: "outbound",
          language: "en",
          transcript: [{ role: "caller", text: "Can you leave a note for Jonas?" }],
        }),
        seedCall({ id: "call_gap28_wait", direction: "outbound", language: "en" }),
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ agentTurn } = await import("../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

function messageChainContains(capturedBodies, marker) {
  return capturedBodies.some((body) =>
    body.messages.some((m) => {
      if (typeof m.content === "string") return m.content.includes(marker);
      if (Array.isArray(m.content)) {
        return m.content.some(
          (block) => typeof block.content === "string" && block.content.includes(marker),
        );
      }
      return false;
    }),
  );
}

test("Outbound-Erst-Turn injiziert keinen deutschen Bootstrap-Marker bei language=en (ex GAP-28, 1/4)", async () => {
  bodies = [];
  queue = [textMessage("Hello, how can I help you today?")];
  const call = store.getCall("call_gap28_boot");
  await agentTurn(call, "");
  assert.ok(
    !messageChainContains(bodies, OUTBOUND_OPENING_BOOTSTRAP),
    "Bootstrap-Marker ist weiterhin hartcodiert deutsch, unabhaengig von call.language=en",
  );
});

test("stiller Folge-Turn injiziert keinen deutschen Silent-Marker bei language=en (ex GAP-28, 2/4)", async () => {
  bodies = [];
  queue = [textMessage("Sure, take your time.")];
  const call = store.getCall("call_gap28_silent");
  await agentTurn(call, "");
  assert.ok(
    !messageChainContains(bodies, SILENT_TURN_MARKER),
    "Silent-Turn-Marker ist weiterhin hartcodiert deutsch, unabhaengig von call.language=en",
  );
});

test("take_message liefert kein deutsches tool_result bei language=en (ex GAP-28, 3/4)", async () => {
  bodies = [];
  queue = [
    toolUseOnlyMessage("take_message", { message: "Please note something for Jonas." }),
    textMessage("Sure, I'll pass that along."),
  ];
  const call = store.getCall("call_gap28_msg");
  await agentTurn(call, null);
  assert.equal(bodies.length, 2, "take_message muss einen zweiten Roundtrip mit tool_result ausloesen");
  assert.ok(
    !messageChainContains(bodies, TAKE_MESSAGE_RESULT),
    "take_message-tool_result ist weiterhin hartcodiert deutsch, unabhaengig von call.language=en",
  );
});

test("unterdruecktes end_call im Erst-Turn liefert kein deutsches tool_result bei language=en (ex GAP-28, 4/4)", async () => {
  bodies = [];
  queue = [toolUseOnlyMessage("end_call", {}), textMessage("Alright, I'll wait.")];
  const call = store.getCall("call_gap28_wait");
  await agentTurn(call, "");
  assert.equal(bodies.length, 2, "unterdruecktes end_call muss einen zweiten Roundtrip ausloesen");
  assert.ok(
    !messageChainContains(bodies, END_CALL_WAIT_INSTRUCTION_TEXT),
    "END_CALL_WAIT_INSTRUCTION ist weiterhin hartcodiert deutsch, unabhaengig von call.language=en",
  );
});
