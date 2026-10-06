import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { text, toolUse, reply, makeJsonMessage, makeWriteSse } from "./anthropic-sse-fixtures.js";

const OWNER = "Jonas Beispiel";
const SUBSTANTIAL = "Ja, Donnerstag passt gut";
const ZWEI_SAETZE = "Guten Tag, hier ist Hermes. Wie kann ich Ihnen helfen?";
const CONSULT = "get_consult";
const LOOK_UP = "look_up";
const END_CALL = "end_call";
const TAKE_MESSAGE = "take_message";

const CONSULT_ZERO_LEAD_MS = 60_000;

const jsonMessage = makeJsonMessage("msg_ald1");
const writeSse = makeWriteSse(jsonMessage);

const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

let server;
let queue = [];
let bodies = [];
let store, claude, inCall, research;

function answeredOutbound(id, overrides = {}) {
  const answeredAt = new Date().toISOString();
  return seedCall({ id, direction: "outbound", language: "de", answeredAt, ...overrides });
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      const scripted = queue.shift() || reply(text(UNWANTED_EXTRA_ROUNDTRIP_MARKER));
      if (body.stream === true) return writeSse(res, scripted.blocks);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jsonMessage(scripted.blocks)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-ald1-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  process.env.LOOKUP_ENABLED = "true";
  process.env.EXA_API_KEY = "test-ald1-key";
  const calls = [];
  for (let i = 1; i <= 6; i++) calls.push(answeredOutbound(`call_ald1_${i}`));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
  inCall = await import("../src/consult/in-call.js");
  research = await import("../src/research/in-call.js");
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const sentToolNames = () => bodies[0].tools.map((t) => t.name);

function armPoll(callId) {
  const call = store.getCall(callId);
  call.consultPolledAtMs = Date.now();
  return call;
}

function withAnsweredConsultZero(callId) {
  const call = store.getCall(callId);
  const answeredAtMs = Date.parse(call.answeredAt);
  call.consults = [
    {
      id: "cons_0",
      seq: 0,
      questions: ["Wie heisst der Friseur?"],
      status: "answered",
      askedAt: new Date(answeredAtMs - CONSULT_ZERO_LEAD_MS).toISOString(),
      answeredAt: new Date(answeredAtMs - 1).toISOString(),
      answeredFacts: 1,
    },
  ];
  return call;
}

function exhaustLookup(call) {
  call.lookups = research.LOOKUP_MAX_PER_CALL;
  return call;
}

async function streamedTurn(call, callerText = SUBSTANTIAL) {
  const chunks = [];
  const turn = await claude.agentTurn(call, callerText, {
    onSpeechChunk: (t) => chunks.push(t),
  });
  return { turn, chunks };
}

test("AL-D1-1: ein beantworteter Consult #0 verbraucht das In-Call-Kontingent NICHT", async () => {
  bodies = [];
  queue = [reply(text("Alles klar."))];
  const call = withAnsweredConsultZero(armPoll("call_ald1_1").id);

  await claude.agentTurn(call, SUBSTANTIAL);

  assert.equal(call.consults.length, 1, "Fixture greift nicht: kein Consult #0 am Call");
  assert.ok(
    sentToolNames().includes(CONSULT),
    `Consult #0 darf das Kontingent nicht verbrauchen, tools: ${sentToolNames().join(",")}`,
  );
});

test("AL-D1-2: ein armiertes look_up armiert das Streamen (AL-P17 E1 - vorher Befund B)", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];
  const { turn, chunks } = await streamedTurn(store.getCall("call_ald1_2"));

  assert.ok(turn.offeredToolNames.includes(LOOK_UP), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.ok(!turn.offeredToolNames.includes(CONSULT), "get_consult darf hier nicht mitwirken");
  assert.equal(turn.streamArmedRounds, 1, "AL-P17: genau diese Runde ist jetzt armiert");
  assert.ok(chunks.length > 1, `mehrere Chunks erwartet, waren: ${JSON.stringify(chunks)}`);
  assert.equal(bodies[0].stream, true, "der Streamingpfad wurde wirklich gefahren");
});

test("AL-D1-3: ein armiertes get_consult armiert das Streamen (AL-P17 E1+E3 - vorher Befund B)", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];
  const call = exhaustLookup(armPoll("call_ald1_3"));

  const { turn, chunks } = await streamedTurn(call);

  assert.ok(turn.offeredToolNames.includes(CONSULT), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.ok(!turn.offeredToolNames.includes(LOOK_UP), "look_up darf hier nicht mitwirken");
  assert.equal(turn.streamArmedRounds, 1, "AL-P17: genau diese Runde ist jetzt armiert");
  assert.ok(chunks.length > 1, `mehrere Chunks erwartet, waren: ${JSON.stringify(chunks)}`);
  assert.equal(bodies[0].stream, true, "der Streamingpfad wurde wirklich gefahren");
});

test("AL-D1-4: rein seiteneffekt-basierter Werkzeugsatz streamt wirklich (Positivkontrolle)", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];
  const call = exhaustLookup(store.getCall("call_ald1_4"));

  const { turn, chunks } = await streamedTurn(call);

  assert.deepEqual(turn.offeredToolNames, [END_CALL, TAKE_MESSAGE]);
  assert.equal(turn.streamArmedRounds, 1);
  assert.ok(chunks.length > 1, `mehrere Chunks erwartet, waren: ${JSON.stringify(chunks)}`);
  assert.equal(bodies[0].stream, true, "der Streamingpfad wurde wirklich gefahren");
});

test("AL-D1-5: offeredToolNames ist die Union ueber die Runden und traegt keinen Gespraechstext", async () => {
  bodies = [];
  queue = [reply(toolUse(TAKE_MESSAGE, { message: "Notiz" })), reply(text(ZWEI_SAETZE))];
  const call = exhaustLookup(store.getCall("call_ald1_5"));

  const { turn } = await streamedTurn(call, "Ruf mich morgen zurueck.");

  assert.equal(turn.roundtrips, 2, "zwei Runden, sonst prueft der Fall keine Union");
  assert.equal(
    turn.offeredToolNames.length,
    new Set(turn.offeredToolNames).size,
    "Union: derselbe Name darf trotz zweier Runden nur einmal stehen",
  );
  for (const name of turn.toolNames)
    assert.ok(turn.offeredToolNames.includes(name), `gefeuert, aber nie angeboten: ${name}`);
  for (const name of turn.offeredToolNames) {
    assert.ok(!name.includes("Ruf mich"), "kein Anrufer-Text in den Werkzeugnamen");
    assert.ok(!name.includes("Hermes"), "kein gesprochener Text in den Werkzeugnamen");
  }
});

test("AL-D1-6: consultClientIsPolling haelt an seinen Grenzen (frisch / genau zu alt / fehlend)", () => {
  const now = Date.now();
  const grenze = inCall.CONSULT_POLL_FRESH_MS;

  assert.equal(inCall.consultClientIsPolling({ consultPolledAtMs: now }, now), true);
  assert.equal(inCall.consultClientIsPolling({ consultPolledAtMs: now - grenze }, now), true);
  assert.equal(inCall.consultClientIsPolling({ consultPolledAtMs: now - grenze - 1 }, now), false);
  assert.equal(inCall.consultClientIsPolling({}, now), false, "fehlendes Feld -> fail-closed");
});
