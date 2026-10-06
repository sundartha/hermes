import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";

const OUTBOUND_OPENING_BOOTSTRAP = "[Der Angerufene hat abgenommen. Beginne das Gespraech.]";
const INBOUND_OPENING_BOOTSTRAP = "[Der Anrufer ist in der Leitung. Begruesse ihn.]";
const SILENT_TURN_MARKER = "[Es kam keine Antwort.]";

let nextResponse;
let requests = [];

function textMessage(text) {
  return {
    id: "msg_tg_text",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function endCallMessage(speech) {
  return {
    id: "msg_tg_endcall",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [
      { type: "text", text: speech },
      { type: "tool_use", id: "tu1", name: "end_call", input: {} },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function lastMessageOf(body) {
  return body.messages[body.messages.length - 1];
}

function countBootstrapOccurrences(capturedBodies, bootstrapText) {
  return capturedBodies.filter((body) => body.messages.some((m) => m.content === bootstrapText))
    .length;
}

let server;
let store, agentTurn, shouldSuppressEndCall;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(nextResponse));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-tg-key";
  process.env.MAX_EMPTY_TURNS = "2";
  process.env.CALLER_SUBSTANCE_MIN_LEN = "2";
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [
        seedCall({ id: "call_tg1_0", direction: "outbound" }),
        seedCall({ id: "call_tg1_1", direction: "outbound" }),
        seedCall({ id: "call_tg1_2", direction: "outbound" }),
        seedCall({ id: "call_tg1_3", direction: "outbound" }),
        seedCall({
          id: "call_tg1_r2",
          direction: "outbound",
          transcript: [{ role: "caller", text: "." }],
        }),
        seedCall({
          id: "call_tg1_pos",
          direction: "outbound",
          transcript: [{ role: "caller", text: "Ja bitte" }],
        }),
        seedCall({ id: "call_tg2", direction: "outbound" }),
        seedCall({ id: "call_tg3", direction: "outbound" }),
        seedCall({
          id: "call_tg3_budget",
          direction: "outbound",
          transcript: [{ role: "agent", text: "Guten Tag, hier ist der Assistent von Jonas." }],
        }),
        seedCall({ id: "call_tg3_inbound", direction: "inbound" }),
        seedCall({
          id: "call_tg3_inbound_budget",
          direction: "inbound",
          transcript: [{ role: "agent", text: "Guten Tag, hier ist der Assistent von Jonas." }],
        }),
        seedCall({ id: "call_tg4", direction: "outbound" }),
        seedCall({ id: "call_tg_rec1_inbound", direction: "inbound" }),
        seedCall({ id: "call_tg_rec1_outbound", direction: "outbound" }),
        seedCall({ id: "call_tg_rec1_inbound_empty", direction: "inbound" }),
        seedCall({ id: "call_tg_rec1_inbound_ws", direction: "inbound" }),
        seedCall({ id: "call_tg_rec1_inbound_dot", direction: "inbound" }),
        seedCall({ id: "call_tg_rec1_inbound_null", direction: "inbound" }),
        seedCall({ id: "call_tg2_noise", direction: "outbound" }),
      ],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ({ agentTurn, shouldSuppressEndCall } = await import("../src/claude.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const SPURIOUS_CALLER_CASES = [
  { label: "leerer String (Shim)", value: "", callId: "call_tg1_0", recorded: false },
  { label: "nur Whitespace", value: "   ", callId: "call_tg1_1", recorded: true },
  { label: "Kurz-Fragment (Rauschen)", value: ".", callId: "call_tg1_2", recorded: true },
  { label: "null (Budget-Engine)", value: null, callId: "call_tg1_3", recorded: false },
];

for (const { label, value, callId, recorded } of SPURIOUS_CALLER_CASES) {
  test(`TG-1 (b) spurious caller-Wert "${label}" gibt end_call nicht frei; Recording folgt Boolean(callerText)`, async () => {
    const call = store.getCall(callId);
    nextResponse = endCallMessage("Ich lege jetzt auf.");
    const result = await agentTurn(call, value);
    assert.equal(result.endCall, false, "nicht-substanzieller Wert darf end_call nicht freigeben");
    const callerLines = store.getCall(callId).transcript.filter((t) => t.role === "caller");
    assert.equal(callerLines.length, recorded ? 1 : 0);
  });
}

test("TG-1 (b) R2-Kern: vorbesetzte non-substanzielle caller-Zeile hebt den Schutz nicht auf", async () => {
  const call = store.getCall("call_tg1_r2");
  nextResponse = endCallMessage("Ich lege jetzt auf.");
  const result = await agentTurn(call, null);
  assert.equal(result.endCall, false, "die Legacy-'.'-Zeile darf den Fruehauflege-Schutz nicht aufheben");
});

test("TG-1 (b) Positiv-Kontrolle: substanzielle caller-Zeile gibt end_call frei", async () => {
  const call = store.getCall("call_tg1_pos");
  nextResponse = endCallMessage("Alles klar, bis dann.");
  const result = await agentTurn(call, null);
  assert.equal(result.endCall, true);
});

test("TG-2 (a) einzelner Leer-Turn kein end_call vor der Schwelle; ab maxEmptyTurns wird freigegeben", async () => {
  const callId = "call_tg2";
  const endCalls = [];
  for (let turn = 0; turn < 3; turn++) {
    const call = store.getCall(callId);
    nextResponse = endCallMessage("Ich lege jetzt auf.");
    const result = await agentTurn(call, "");
    endCalls.push(result.endCall);
  }
  assert.deepEqual(endCalls, [false, false, true]);
});

test("TG-2b (Empty-Turn-Guard) aufgezeichnete Rausch-Zeilen setzen den Empty-Turn-Zaehler nicht zurueck", async () => {
  const callId = "call_tg2_noise";
  const endCalls = [];
  for (let turn = 0; turn < 3; turn++) {
    const call = store.getCall(callId);
    nextResponse = endCallMessage("Ich lege jetzt auf.");
    const result = await agentTurn(call, ".");
    endCalls.push(result.endCall);
  }
  assert.deepEqual(
    endCalls,
    [false, false, true],
    "R4-Deadlock-Schutz muss trotz aufgezeichneter Rausch-Zeilen greifen",
  );
  const callerLines = store.getCall(callId).transcript.filter((t) => t.role === "caller");
  assert.equal(callerLines.length, 3, "die Rausch-Zeilen muessen jetzt im Transkript stehen");
});

test("TG-3a (c) Shim-Erstkontakt (Transkript startet leer): Bootstrap feuert einmalig; stille Folge-Turns nutzen SILENT_TURN_MARKER, Kette bleibt gueltig", async () => {
  const callId = "call_tg3";
  requests = [];
  const capturedBodies = [];
  for (let turn = 0; turn < 3; turn++) {
    const call = store.getCall(callId);
    nextResponse = textMessage("Ich warte kurz.");
    const before = requests.length;
    await agentTurn(call, "");
    capturedBodies.push(requests[before]);
  }

  assert.equal(lastMessageOf(capturedBodies[0]).role, "user");
  assert.equal(lastMessageOf(capturedBodies[0]).content, OUTBOUND_OPENING_BOOTSTRAP);

  for (const body of [capturedBodies[1], capturedBodies[2]]) {
    assert.equal(lastMessageOf(body).role, "user");
    assert.equal(lastMessageOf(body).content, SILENT_TURN_MARKER);
  }

  for (const body of capturedBodies) {
    assert.equal(lastMessageOf(body).role, "user");
  }

  assert.equal(countBootstrapOccurrences(capturedBodies, OUTBOUND_OPENING_BOOTSTRAP), 1);
});

test("TG-3b (c) Budget-Engine-Erstkontakt (agent-Zeile bereits vorbesetzt): Bootstrap feuert NIE, bereits der erste stille Turn nutzt SILENT_TURN_MARKER", async () => {
  const callId = "call_tg3_budget";
  requests = [];
  const capturedBodies = [];
  for (let turn = 0; turn < 2; turn++) {
    const call = store.getCall(callId);
    nextResponse = textMessage("Ich warte kurz.");
    const before = requests.length;
    await agentTurn(call, "");
    capturedBodies.push(requests[before]);
  }

  for (const body of capturedBodies) {
    assert.equal(lastMessageOf(body).role, "user");
    assert.equal(lastMessageOf(body).content, SILENT_TURN_MARKER);
  }

  assert.equal(countBootstrapOccurrences(capturedBodies, OUTBOUND_OPENING_BOOTSTRAP), 0);
});

test("TG-3c (c) Shim-Erstkontakt Inbound (Transkript startet leer): Bootstrap feuert einmalig; stille Folge-Turns nutzen SILENT_TURN_MARKER, Kette bleibt gueltig", async () => {
  const callId = "call_tg3_inbound";
  requests = [];
  const capturedBodies = [];
  for (let turn = 0; turn < 3; turn++) {
    const call = store.getCall(callId);
    nextResponse = textMessage("Ich warte kurz.");
    const before = requests.length;
    await agentTurn(call, "");
    capturedBodies.push(requests[before]);
  }

  assert.equal(lastMessageOf(capturedBodies[0]).role, "user");
  assert.equal(lastMessageOf(capturedBodies[0]).content, INBOUND_OPENING_BOOTSTRAP);

  for (const body of [capturedBodies[1], capturedBodies[2]]) {
    assert.equal(lastMessageOf(body).role, "user");
    assert.equal(lastMessageOf(body).content, SILENT_TURN_MARKER);
  }

  for (const body of capturedBodies) {
    assert.equal(lastMessageOf(body).role, "user");
  }

  assert.equal(countBootstrapOccurrences(capturedBodies, INBOUND_OPENING_BOOTSTRAP), 1);
});

test("TG-3d (c) Budget-Engine-Erstkontakt Inbound (agent-Zeile bereits vorbesetzt): Bootstrap feuert NIE, bereits der erste stille Turn nutzt SILENT_TURN_MARKER", async () => {
  const callId = "call_tg3_inbound_budget";
  requests = [];
  const capturedBodies = [];
  for (let turn = 0; turn < 2; turn++) {
    const call = store.getCall(callId);
    nextResponse = textMessage("Ich warte kurz.");
    const before = requests.length;
    await agentTurn(call, "");
    capturedBodies.push(requests[before]);
  }

  for (const body of capturedBodies) {
    assert.equal(lastMessageOf(body).role, "user");
    assert.equal(lastMessageOf(body).content, SILENT_TURN_MARKER);
  }

  assert.equal(countBootstrapOccurrences(capturedBodies, INBOUND_OPENING_BOOTSTRAP), 0);
});

test("TG-4 Regression: substanzielle caller-Aeusserung verhaelt sich wie vor stab-p7", async () => {
  const call = store.getCall("call_tg4");
  nextResponse = endCallMessage("Alles klar, ich lege auf.");
  const result = await agentTurn(call, "Ja, Donnerstag passt");
  assert.equal(result.endCall, true);
  const callerLines = store.getCall("call_tg4").transcript.filter((t) => t.role === "caller");
  assert.equal(callerLines.length, 1);
  assert.equal(callerLines[0].text, "Ja, Donnerstag passt");
});

test("TG-REC-1 Inbound-Regression: echte Kurz-Aeusserung landet unveraendert im Transkript", async () => {
  const callId = "call_tg_rec1_inbound";
  nextResponse = textMessage("Alles klar.");
  const call = store.getCall(callId);
  await agentTurn(call, "5");
  const callerLines = store.getCall(callId).transcript.filter((t) => t.role === "caller");
  assert.equal(callerLines.length, 1);
  assert.equal(callerLines[0].text, "5");
});

test("TG-REC-1 Outbound-Regression (G3/G26): echte Kurz-Aeusserung landet im Transkript UND geht als caller-Turn ans Modell", async () => {
  const callId = "call_tg_rec1_outbound";
  requests = [];
  nextResponse = textMessage("Alles klar.");
  const call = store.getCall(callId);
  const before = requests.length;
  await agentTurn(call, "5");

  const callerLines = store.getCall(callId).transcript.filter((t) => t.role === "caller");
  assert.equal(callerLines.length, 1);
  assert.equal(callerLines[0].text, "5");

  const sentMessage = lastMessageOf(requests[before]);
  assert.equal(sentMessage.role, "user");
  assert.equal(sentMessage.content, "5", "muss der echte caller-Turn sein, nicht SILENT_TURN_MARKER");
});

const INBOUND_RECORD_GATE_CASES = [
  { label: "leerer String (Shim)", value: "", callId: "call_tg_rec1_inbound_empty", recorded: false },
  { label: "nur Whitespace", value: "   ", callId: "call_tg_rec1_inbound_ws", recorded: true },
  { label: "Kurz-Fragment", value: ".", callId: "call_tg_rec1_inbound_dot", recorded: true },
  { label: "null (Budget-Engine)", value: null, callId: "call_tg_rec1_inbound_null", recorded: false },
];

for (const { label, value, callId, recorded } of INBOUND_RECORD_GATE_CASES) {
  test(`TG-REC-1 Inbound-Grenzfall "${label}": Record-Gate folgt richtungslos Boolean(callerText)`, async () => {
    nextResponse = textMessage("Alles klar.");
    const call = store.getCall(callId);
    await agentTurn(call, value);
    const callerLines = store.getCall(callId).transcript.filter((t) => t.role === "caller");
    assert.equal(callerLines.length, recorded ? 1 : 0);
  });
}

test("P3.3: inbound OHNE Anrufer-Zeile unter der Leer-Turn-Schwelle -> true (Symmetrisierung)", () => {
  const call = { direction: "inbound", transcript: [{ role: "agent", text: "Guten Tag." }] };
  assert.equal(shouldSuppressEndCall(call), true);
});

test("P3.3: inbound bei maxEmptyTurns unbeantworteten Agent-Turns -> false (Deadlock-Freigabe)", () => {
  const call = {
    direction: "inbound",
    transcript: [
      { role: "agent", text: "Guten Tag." },
      { role: "agent", text: "Sind Sie noch dran?" },
    ],
  };
  assert.equal(shouldSuppressEndCall(call), false);
});

test("P3.3: inbound MIT (auch nicht-substanzieller) Anrufer-Zeile -> false (TG-REC-1 bleibt)", () => {
  const call = { direction: "inbound", transcript: [{ role: "caller", text: "." }] };
  assert.equal(shouldSuppressEndCall(call), false);
});

test("shouldSuppressEndCall: outbound ohne substanzielle Antwort, unter der Leer-Turn-Schwelle -> true", () => {
  const call = {
    direction: "outbound",
    transcript: [{ role: "agent", text: "Guten Tag." }],
  };
  assert.equal(shouldSuppressEndCall(call), true);
});

test("shouldSuppressEndCall: outbound MIT substanzieller Anrufer-Antwort -> false", () => {
  const call = {
    direction: "outbound",
    transcript: [{ role: "caller", text: "Ja bitte" }],
  };
  assert.equal(shouldSuppressEndCall(call), false);
});

test("shouldSuppressEndCall: outbound bei maxEmptyTurns unbeantworteten Agent-Turns -> false (Deadlock-Freigabe)", () => {
  const call = {
    direction: "outbound",
    transcript: [
      { role: "agent", text: "Hallo?" },
      { role: "agent", text: "Sind Sie noch dran?" },
    ],
  };
  assert.equal(shouldSuppressEndCall(call), false);
});
