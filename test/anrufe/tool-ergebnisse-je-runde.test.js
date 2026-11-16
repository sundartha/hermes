import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const SUBSTANTIAL = "Ja, Donnerstag passt gut";

function message(content, stopReason) {
  return {
    id: "msg_ter",
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
const toolCall = (name, input, id) => ({ type: "tool_use", id, name, input });

let server;
let queue = [];
let bodies = [];
let store, claude, LOCALES;

const outbound = (id) => seedCall({ id, direction: "outbound", language: "de", answeredAt: new Date().toISOString() });

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queue.shift() || textOnly("Ende.")));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-ter-key";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls: [outbound("call_ter_1"), outbound("call_ter_2"), outbound("call_ter_3")],
    }),
  );
  await import("../../src/config.js");
  store = await import("../../src/store.js");
  claude = await import("../../src/claude.js");
  ({ LOCALES } = await import("../../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const ergebnisse = () => bodies[1].messages.at(-1).content.map((c) => c.content);

test("take_message legt den Aktionspunkt mit der Art todo an", async () => {
  const call = store.getCall("call_ter_1");
  await claude.execTool(call, "take_message", { message: "Bitte zurueckrufen" });
  const items = store.load().actionItems.filter((i) => i.callId === "call_ter_1");
  assert.deepEqual(items.map((i) => i.type), ["todo"]);
});

test("Ohne Aeusserung des Angerufenen bekommt end_call den Warte-Text, take_message derselben Runde sein eigenes Ergebnis", async () => {
  bodies = [];
  queue = [
    message(
      [toolCall("take_message", { message: "Eins" }, "tuA"), toolCall("end_call", {}, "tuB")],
      "tool_use",
    ),
  ];
  const call = store.getCall("call_ter_2");
  await claude.agentTurn(call, "");
  assert.deepEqual(ergebnisse(), [LOCALES.de.prompt.turnControl.takeMessageResult, LOCALES.de.prompt.turnControl.endCallWait]);
});

test("Nach einer Aeusserung des Angerufenen bekommt take_message sein Ergebnis und end_call OK", async () => {
  bodies = [];
  queue = [
    message(
      [toolCall("take_message", { message: "Zwei" }, "tuA"), toolCall("end_call", {}, "tuB")],
      "tool_use",
    ),
  ];
  const call = store.getCall("call_ter_3");
  await claude.agentTurn(call, SUBSTANTIAL);
  assert.deepEqual(ergebnisse(), [LOCALES.de.prompt.turnControl.takeMessageResult, "OK"]);
});
