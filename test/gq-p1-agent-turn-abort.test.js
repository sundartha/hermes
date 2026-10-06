import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const SUBSTANTIAL = "Ja, Donnerstag passt gut";
const MOCK_USAGE = { input_tokens: 10, output_tokens: 5 };

const text = (value) => ({ type: "text", text: value });
const toolUse = (name, input = {}) => ({ type: "tool_use", id: "tu1", name, input });
function reply(...blocks) {
  return { blocks };
}
function replyThenAbort(controller, ...blocks) {
  return { blocks, onReceived: () => controller.abort() };
}

function jsonMessage(blocks) {
  return {
    id: "msg_gqp1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: blocks,
    stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: MOCK_USAGE,
  };
}

let server;
let queue = [];
let bodies = [];
let store, claude, budgetGate;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      const scripted = queue.shift() || reply(text("UNGEWOLLTER-ZUSATZ-ROUNDTRIP"));
      scripted.onReceived?.();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jsonMessage(scripted.blocks)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-gqp1-key";
  process.env.PAYMENT_ENABLED = "true";
  const answeredAt = new Date().toISOString();
  const calls = [];
  for (let i = 1; i <= 6; i++)
    calls.push(seedCall({ id: `call_gqp1_${i}`, direction: "outbound", language: "de", answeredAt }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
  budgetGate = await import("../src/budget-gate.js");
});

after(async () => {
  await new Promise((r) => server.close(r));
});

function bookingSnapshot() {
  const events = store
    .pendingMeterEvents()
    .filter((e) => e.tenantId === BOOTSTRAP_TENANT_ID && e.kind === USAGE_EVENT_KIND.AI_TOKEN);
  return { events };
}

function bookingDelta(before) {
  const after = bookingSnapshot();
  return { newEvents: after.events.slice(before.events.length) };
}

function lastTranscriptRole(callId) {
  const t = store.getCall(callId).transcript;
  return t.length ? t[t.length - 1].role : null;
}

test("GQ-P1-16: vorab abgebrochenes Signal -> keine Modellrunde, superseded, keine agent-Zeile", async () => {
  bodies = [];
  queue = [reply(text("Sollte nie gesprochen werden"))];
  const controller = new AbortController();
  controller.abort();
  const turn = await claude.agentTurn(store.getCall("call_gqp1_1"), SUBSTANTIAL, {
    abortSignal: controller.signal,
  });
  assert.equal(bodies.length, 0, "keine Modellrunde wurde gefahren");
  assert.deepEqual(
    { superseded: turn.superseded, speech: turn.speech, endCall: turn.endCall },
    { superseded: true, speech: "", endCall: false },
  );
  assert.equal(lastTranscriptRole("call_gqp1_1"), "caller", "keine agent-Zeile geschrieben");

  bodies = [];
  queue = [reply(text("Normale Antwort"))];
  const baseline = await claude.agentTurn(store.getCall("call_gqp1_2"), SUBSTANTIAL);
  assert.equal(baseline.superseded, false);
  assert.equal(lastTranscriptRole("call_gqp1_2"), "agent");
});

test("GQ-P1-17: Abbruch waehrend der laufenden Runde -> Antwort verworfen, aber GENAU EIN usage_event", async () => {
  bodies = [];
  const controller = new AbortController();
  queue = [replyThenAbort(controller, text("Wird verworfen"))];
  const before = bookingSnapshot();

  const turn = await claude.agentTurn(store.getCall("call_gqp1_3"), SUBSTANTIAL, {
    abortSignal: controller.signal,
  });

  assert.equal(bodies.length, 1, "die bereits laufende Runde wurde ausgefuehrt und gebucht");
  assert.equal(turn.superseded, true);
  assert.equal(turn.speech, "");
  assert.equal(lastTranscriptRole("call_gqp1_3"), "caller", "keine agent-Zeile");

  const delta = bookingDelta(before);
  assert.equal(delta.newEvents.length, 1, "genau ein usage_event - nicht doppelt, nicht null");
});

test("GQ-P1-18: end_call-Runde liefert nach Verdraengung endCall:false", async () => {
  bodies = [];
  const controllerAborted = new AbortController();
  queue = [replyThenAbort(controllerAborted, text("Auf Wiederhoeren"), toolUse("end_call"))];
  const turnAborted = await claude.agentTurn(store.getCall("call_gqp1_4"), SUBSTANTIAL, {
    abortSignal: controllerAborted.signal,
  });
  assert.equal(turnAborted.superseded, true);
  assert.equal(turnAborted.endCall, false);

  bodies = [];
  queue = [reply(text("Auf Wiederhoeren"), toolUse("end_call"))];
  const baseline = await claude.agentTurn(store.getCall("call_gqp1_5"), SUBSTANTIAL);
  assert.equal(baseline.endCall, true);
});

test("GQ-P1-19: mehrrundiger Turn - Abbruch nach Runde 1 verhindert Runde 2, stopReason=superseded, keine Geld-Achse", async () => {
  bodies = [];
  const controller = new AbortController();
  queue = [replyThenAbort(controller, text("Ich schaue nach."), toolUse("erfundenes_werkzeug"))];
  const turn = await claude.agentTurn(store.getCall("call_gqp1_6"), SUBSTANTIAL, {
    abortSignal: controller.signal,
  });

  assert.equal(bodies.length, 1, "keine zweite Modellrunde - echte Token-Ersparnis ab Runde 2");
  assert.equal(turn.stopReason, "superseded");
  assert.equal(budgetGate.isBudgetAxis(turn.stopReason), false, "keine Geld-Achse - der Shim-Notaus bleibt unberuehrt");
  assert.equal(turn.superseded, true);
});
