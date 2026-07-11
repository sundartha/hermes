// Phase stab-p7: Empty-Turn-Guard (a) + content-basierter suppressEndCall (b) + gebundener
// Bootstrap (c). Im Outbound-Pfad darf ein end_call NIEMALS wegen einer spurious/leeren
// Anrufer-Aeusserung freigegeben werden (R2-Regression), aber nach maxEmptyTurns unbeantworteten
// Agent-Turns MUSS der Guard end_call freigeben (R4-Deadlock-Schutz). Dabei bleibt die
// Anthropic-messages-Kette bei jedem Leer-Turn gueltig (endet mit einem role:user-Eintrag) -
// der Erst-Turn-Bootstrap feuert genau EINMAL, stille Folge-Turns nutzen einen neutralen Marker.
//
// Eigene Datei (ueberschneidet keine parallele Phase). Rein in-process (l3-Muster wie
// l3-prompt-caching/turn-fallback-locale): ANTHROPIC_BASE_URL + DATA_DIR vor dem ersten
// config-Import, dann dynamischer Import. Der lokale HTTP-Mock erfasst JEDEN Request-Body
// und liefert die per Test gesetzte nextResponse. MAX_EMPTY_TURNS="2" (kuerzeste testbare
// Schwelle, unabhaengig vom Prod-Default 3, F.I.R.S.T.), CALLER_SUBSTANCE_MIN_LEN="2"
// (Prod-Default).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";

// Spiegeln die privaten Prod-Konstanten aus src/claude.js (dort bewusst nicht exportiert -
// reine Turn-Steuerung, kein oeffentlicher API-Vertrag). Byte-identischer Erwartungswert,
// analog zum EPHEMERAL-Literal in l3-prompt-caching.test.js.
const OUTBOUND_OPENING_BOOTSTRAP = "[Der Angerufene hat abgenommen. Beginne das Gespraech.]";
const SILENT_TURN_MARKER = "[Es kam keine Antwort.]";

// per Test/Turn gesetzte Mock-Antwort.
let nextResponse;
// erfasst JEDEN Request-Body dieses Test-Prozesses (TG-3 liest daraus die messages-Form).
let requests = [];

// Tool-freie Text-Antwort: der Tool-Loop bricht nach EINEM Roundtrip ab (akkumuliert
// genau eine agent-Zeile im Transkript, kein end_call).
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

// Text + end_call-tool_use in EINER Antwort: deckt sowohl den unterdrueckten (suppressEndCall)
// als auch den freigegebenen Zweig ab (beide brechen den Tool-Loop ueber "speech" vorhanden).
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

let server;
let store, agentTurn;

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
  // stab-p7: kuerzeste testbare Schwelle (unabhaengig vom Prod-Default 3, F.I.R.S.T.).
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
        seedCall({ id: "call_tg4", direction: "outbound" }),
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

// ---------- TG-1 (b): spurious/leere Anrufer-Werte heben den Schutz NICHT auf ----------

const EMPTY_CALLER_CASES = [
  { label: "leerer String (Shim)", value: "", callId: "call_tg1_0" },
  { label: "nur Whitespace", value: "   ", callId: "call_tg1_1" },
  { label: "Kurz-Fragment", value: ".", callId: "call_tg1_2" },
  { label: "null (Budget-Engine)", value: null, callId: "call_tg1_3" },
];

for (const { label, value, callId } of EMPTY_CALLER_CASES) {
  test(`TG-1 (b) spurious caller-Wert "${label}" gibt end_call nicht frei und landet nicht im Transkript`, async () => {
    const call = store.getCall(callId);
    nextResponse = endCallMessage("Ich lege jetzt auf.");
    const result = await agentTurn(call, value);
    assert.equal(result.endCall, false);
    const callerLines = store.getCall(callId).transcript.filter((t) => t.role === "caller");
    assert.equal(callerLines.length, 0, "spurious Wert darf nicht ins Transkript wandern");
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

// ---------- TG-2 (a): einzelner Leer-Turn haelt zurueck, N konsekutive schliessen ab ----------

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

// ---------- TG-3 (c): Bootstrap genau einmal, Folge-Leer-Turns nutzen den neutralen Marker ----------

test("TG-3 (c) Bootstrap feuert einmalig; stille Folge-Turns nutzen SILENT_TURN_MARKER, Kette bleibt gueltig", async () => {
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

  const lastMessageOf = (body) => body.messages[body.messages.length - 1];

  assert.equal(lastMessageOf(capturedBodies[0]).role, "user");
  assert.equal(lastMessageOf(capturedBodies[0]).content, OUTBOUND_OPENING_BOOTSTRAP);

  for (const body of [capturedBodies[1], capturedBodies[2]]) {
    assert.equal(lastMessageOf(body).role, "user");
    assert.equal(lastMessageOf(body).content, SILENT_TURN_MARKER);
  }

  // Contract-Invariante: JEDES erfasste messages-Array endet mit role:user (API-Gueltigkeit).
  for (const body of capturedBodies) {
    assert.equal(lastMessageOf(body).role, "user");
  }

  // Der Bootstrap-Text erscheint ueber ALLE Requests genau einmal (keine Re-Injektion).
  const bootstrapOccurrences = capturedBodies.filter((body) =>
    body.messages.some((m) => m.content === OUTBOUND_OPENING_BOOTSTRAP),
  ).length;
  assert.equal(bootstrapOccurrences, 1);
});

// ---------- TG-4: Regression fuer substanzielle Aeusserungen (beide Aufrufer) ----------

test("TG-4 Regression: substanzielle caller-Aeusserung verhaelt sich wie vor stab-p7", async () => {
  const call = store.getCall("call_tg4");
  nextResponse = endCallMessage("Alles klar, ich lege auf.");
  const result = await agentTurn(call, "Ja, Donnerstag passt");
  assert.equal(result.endCall, true);
  const callerLines = store.getCall("call_tg4").transcript.filter((t) => t.role === "caller");
  assert.equal(callerLines.length, 1);
  assert.equal(callerLines[0].text, "Ja, Donnerstag passt");
});
