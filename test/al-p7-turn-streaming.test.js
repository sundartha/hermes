// AL-P7 (Turn): agentTurn streamt seine Antwort satzweise an einen Abnehmer - aber NUR,
// wenn der Werkzeugsatz der Runde ausschliesslich aus Seiteneffekt-Werkzeugen besteht.
// Gegenstand sind vier Zusagen:
//   (1) Happy Path - mehrere Chunks, und der Turn-Text/das Transkript bleiben exakt das,
//       was der Bestandspfad fuer denselben Rohtext liefert;
//   (2) Armierung - ohne Abnehmer ODER mit einem informationsliefernden Werkzeug im Satz
//       wird NICHT gestreamt (das ist der strukturelle Beweis fuer Abnahmekriterium 3);
//   (3) Geld - je Modellrunde faellt GENAU EINE Buchung, auch wenn der Stream abreisst
//       (dann pessimistisch geschaetzt, nie 0, nie zwei);
//   (4) AL-P4 bleibt intakt - eine Seiteneffekt-Runde beendet den Turn nach EINEM Roundtrip.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang (package.json
// config.i18nCatalogPattern) - Praefix ist "AL-P7-<n>:".
//
// Naht wie test/al-p4-side-effect-tool-loop.test.js: lokaler node:http-Anthropic-Mock,
// hier zusaetzlich mit ECHTEM Anthropic-SSE (der SDK-Streamingpfad laeuft unveraendert).
// Kein Server-Spawn, kein pglite, kein Netz (P12/R).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const SUBSTANTIAL = "Ja, Donnerstag passt gut"; // hebt suppressEndCall auf
const ZWEI_SAETZE = "Guten Tag, hier ist Hermes. Wie kann ich Ihnen helfen?";
// AL-P7: Ausgabe-Deckel einer Runde (claude.js TURN_MAX_TOKENS) - der pessimistische
// Ersatzwert eines abgerissenen Streams.
const TURN_MAX_TOKENS = 300;
const MOCK_USAGE = { input_tokens: 10, output_tokens: 5 };

// --- Skript-Bausteine: EINE Antwort-Beschreibung, zwei Draht-Formen (JSON + SSE) ---
const text = (value) => ({ type: "text", text: value });
const toolUse = (name, input = {}) => ({ type: "tool_use", id: "tu1", name, input });
const reply = (...blocks) => ({ blocks, mode: "ok" });
const brokenAfterFirstDelta = (...blocks) => ({ blocks, mode: "destroy" });

const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

function jsonMessage(blocks) {
  return {
    id: "msg_alp7",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: blocks,
    stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: MOCK_USAGE,
  };
}

function sseEvent(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

// Der Abriss muss NACH dem Flush des ersten Deltas passieren - ein sofortiges destroy()
// verwirft den noch gepufferten Body, der Client saehe dann gar kein Fragment (empirisch
// belegt). Kurze Verzoegerung statt Schlaf im Test selbst (T9 bleibt gewahrt).
const SOCKET_FLUSH_MS = 30;

// Echtes Anthropic-SSE: message_start -> je Block content_block_start/-delta/-stop ->
// message_delta -> message_stop. Text wird in ZWEI Deltas geschickt, damit die Delta-
// Grenze bewusst NICHT auf einer Satzgrenze liegt.
function writeSse(res, { blocks, mode }) {
  res.setHeader("content-type", "text/event-stream");
  sseEvent(res, "message_start", {
    message: { ...jsonMessage([]), content: [], usage: { ...MOCK_USAGE, output_tokens: 1 } },
  });
  let index = 0;
  for (const block of blocks) {
    if (block.type === "text") {
      sseEvent(res, "content_block_start", { index, content_block: { type: "text", text: "" } });
      const half = Math.ceil(block.text.length / 2);
      sseEvent(res, "content_block_delta", {
        index,
        delta: { type: "text_delta", text: block.text.slice(0, half) },
      });
      if (mode === "destroy") return setTimeout(() => res.socket.destroy(), SOCKET_FLUSH_MS);
      sseEvent(res, "content_block_delta", {
        index,
        delta: { type: "text_delta", text: block.text.slice(half) },
      });
    } else {
      sseEvent(res, "content_block_start", { index, content_block: { ...block, input: {} } });
      sseEvent(res, "content_block_delta", {
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input || {}) },
      });
    }
    sseEvent(res, "content_block_stop", { index });
    index += 1;
  }
  sseEvent(res, "message_delta", {
    delta: { stop_reason: jsonMessage(blocks).stop_reason, stop_sequence: null },
    usage: { output_tokens: MOCK_USAGE.output_tokens },
  });
  sseEvent(res, "message_stop", {});
  res.end();
}

let server;
let queue = [];
let bodies = [];
let store, claude;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      const scripted = queue.shift() || reply(text(UNWANTED_EXTRA_ROUNDTRIP_MARKER));
      if (body.stream === true) return writeSse(res, scripted);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jsonMessage(scripted.blocks)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-alp7-key";
  // Der usage_event-Ledger existiert nur im Metering-Pfad - ohne dieses Flag koennte
  // "genau EIN Beleg je Runde" gar nicht gemessen werden.
  process.env.PAYMENT_ENABLED = "true";
  // Fixture fuer die negative Armierung: get_consult ist das informationsliefernde
  // Werkzeug, an dem der Riegel greifen MUSS.
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const answeredAt = new Date().toISOString();
  const calls = [];
  for (let i = 1; i <= 8; i++)
    calls.push(seedCall({ id: `call_alp7_${i}`, direction: "outbound", language: "de", answeredAt }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
});

after(async () => {
  await new Promise((r) => server.close(r));
});

// Build-Operate-Check (P13): ein Turn MIT Abnehmer, die Chunks als Liste.
async function streamedTurn(callId, callerText = SUBSTANTIAL) {
  const chunks = [];
  const turn = await claude.agentTurn(store.getCall(callId), callerText, {
    onSpeechChunk: (t) => chunks.push(t),
  });
  return { turn, chunks };
}

// Live-Budget-Achse (Regel 1) + Beleg-Ledger als EIN Vorher/Nachher-Messpunkt.
function bookingSnapshot() {
  const bucket = store.usageOf(BOOTSTRAP_TENANT_ID);
  const events = store
    .pendingMeterEvents()
    .filter((e) => e.tenantId === BOOTSTRAP_TENANT_ID && e.kind === USAGE_EVENT_KIND.AI_TOKEN);
  return { inputTokens: bucket.inputTokens, outputTokens: bucket.outputTokens, events };
}

function bookingDelta(before) {
  const after = bookingSnapshot();
  return {
    inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    newEvents: after.events.slice(before.events.length),
  };
}

// Frischer Poll + abgenommener Call -> consultAvailableFor haelt, get_consult steht im
// Werkzeugsatz (Zustandsvorbedingung, keine Testlogik).
function armConsult(callId) {
  const call = store.getCall(callId);
  call.consultPolledAtMs = Date.now();
  call.answeredAt = new Date().toISOString();
  return call;
}

test("AL-P7-18: Happy Path - mehrere Chunks, Turn-Text und Transkript identisch zum Bestandspfad", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE)), reply(text(ZWEI_SAETZE))];
  const { turn, chunks } = await streamedTurn("call_alp7_1");
  assert.equal(bodies[0].stream, true, "der Streamingpfad wurde wirklich gefahren");
  assert.ok(chunks.length > 1, `mehrere Chunks erwartet, waren: ${JSON.stringify(chunks)}`);
  assert.equal(turn.speech, ZWEI_SAETZE);
  const transcript = store.getCall("call_alp7_1").transcript;
  assert.equal(transcript[transcript.length - 1].text, turn.speech);

  // Gegenprobe: derselbe Rohtext OHNE Abnehmer ergibt byte-identischen Turn-Text.
  const baseline = await claude.agentTurn(store.getCall("call_alp7_2"), SUBSTANTIAL);
  assert.equal(baseline.speech, turn.speech);
});

test("AL-P7-19: ohne Abnehmer wird nicht gestreamt (Bestandspfad, stream nicht im Request)", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];
  const turn = await claude.agentTurn(store.getCall("call_alp7_3"), SUBSTANTIAL);
  assert.notEqual(bodies[0].stream, true, "kein Abnehmer -> llm.complete-Pfad");
  assert.equal(turn.speech, ZWEI_SAETZE);
});

test("AL-P7-20: ein informationslieferndes Werkzeug im Satz verbietet das Streamen (Abnahme 3)", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];
  const call = armConsult("call_alp7_4");
  const chunks = [];
  await claude.agentTurn(call, SUBSTANTIAL, { onSpeechChunk: (t) => chunks.push(t) });
  const toolNames = bodies[0].tools.map((t) => t.name);
  assert.ok(toolNames.includes("get_consult"), `Fixture greift nicht, tools: ${toolNames}`);
  assert.notEqual(bodies[0].stream, true, "informationslieferndes Werkzeug -> kein Streaming");
  assert.deepEqual(chunks, []);
});

test("AL-P7-21: Seiteneffekt-Runde streamt UND beendet den Turn nach einem Roundtrip (AL-P4 intakt)", async () => {
  bodies = [];
  queue = [reply(text("Ich gebe das an Jonas weiter."), toolUse("take_message", { message: "Notiz" }))];
  const { turn, chunks } = await streamedTurn("call_alp7_5", "Ruf mich morgen zurueck.");
  assert.equal(bodies.length, 1, "genau ein Modell-Roundtrip");
  assert.equal(turn.roundtrips, 1);
  assert.deepEqual(turn.toolNames, ["take_message"]);
  assert.deepEqual(chunks, ["Ich gebe das an Jonas weiter."]);
  assert.equal(turn.speech, "Ich gebe das an Jonas weiter.");
});

test("AL-P7-22: der Gutfall bucht GENAU EINEN Beleg je Runde mit dem echten usage", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];
  const before = bookingSnapshot();
  await streamedTurn("call_alp7_6");
  const delta = bookingDelta(before);
  assert.equal(delta.newEvents.length, 1, "genau ein usage_event");
  assert.equal(delta.inputTokens, MOCK_USAGE.input_tokens);
  assert.equal(delta.outputTokens, MOCK_USAGE.output_tokens);
});

test("AL-P7-23: ein abgerissener Stream bucht GENAU EINEN pessimistischen Beleg (nie 0, nie zwei)", async () => {
  bodies = [];
  queue = [brokenAfterFirstDelta(text(ZWEI_SAETZE))];
  const before = bookingSnapshot();
  const chunks = [];
  await assert.rejects(() =>
    claude.agentTurn(store.getCall("call_alp7_7"), SUBSTANTIAL, {
      onSpeechChunk: (t) => chunks.push(t),
    }),
  );
  const delta = bookingDelta(before);
  assert.equal(delta.newEvents.length, 1, "genau ein usage_event, auch im Abrissfall");
  assert.ok(delta.inputTokens > 0, "Input-Schaetzung aus der Prompt-Laenge, nie 0");
  assert.equal(delta.outputTokens, TURN_MAX_TOKENS, "Output fail-closed auf den Runden-Deckel");
});

test("AL-P7-24: ein abgerissener Stream reicht den Fehler an den Aufrufer durch (Degradation bleibt dessen Sache)", async () => {
  bodies = [];
  queue = [brokenAfterFirstDelta(text(ZWEI_SAETZE))];
  await assert.rejects(
    () => claude.agentTurn(store.getCall("call_alp7_8"), SUBSTANTIAL, { onSpeechChunk: () => {} }),
    (err) => {
      assert.equal(err.name, "LlmUnavailableError", `unerwarteter Fehlertyp: ${err?.name}`);
      return true;
    },
  );
});
