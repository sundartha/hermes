// Phase stab-p7: Empty-Turn-Guard (a) + content-basierter suppressEndCall (b) + gebundener
// Bootstrap (c). Im Outbound-Pfad darf ein end_call NIEMALS wegen einer spurious/leeren
// Anrufer-Aeusserung freigegeben werden (R2-Regression), aber nach maxEmptyTurns unbeantworteten
// Agent-Turns MUSS der Guard end_call freigeben (R4-Deadlock-Schutz). Dabei bleibt die
// Anthropic-messages-Kette bei jedem Leer-Turn gueltig (endet mit einem role:user-Eintrag) -
// der Erst-Turn-Bootstrap feuert hoechstens EINMAL (nur beim Shim-Erstkontakt mit wirklich
// leerem Transkript, TG-3a), stille Folge-Turns nutzen einen neutralen Marker. Der Budget-
// Engine-Erstkontakt hat bereits eine vorbesetzte agent-Zeile und sieht den Bootstrap nie
// (TG-3b).
//
// G3/G26-Fix (Review zu phase/stab-p7-fix-rec1-r2): das Transkript-Record-Gate (agentTurn)
// ist RICHTUNGSLOS - JEDE nicht-leere Anrufer-Aeusserung landet im Transkript, unabhaengig
// von isSubstantialCallerText. Der Substanz-Filter gated NUR NOCH die Turn-Steuerung
// (suppressEndCall + unansweredAgentTurns), nicht mehr das Recording (TG-REC-1, TG-1,
// TG-2b unten).
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
const INBOUND_OPENING_BOOTSTRAP = "[Der Anrufer ist in der Leitung. Begruesse ihn.]";
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

// letzte Nachricht eines erfassten Request-Bodys (TG-3a/TG-3b: Contract-Invariante
// role:user am Kettenende, siehe Kommentar oben an der Datei).
function lastMessageOf(body) {
  return body.messages[body.messages.length - 1];
}

// zaehlt, in wie vielen erfassten Requests ein bestimmter Bootstrap-Text vorkommt
// (TG-3a/TG-3c: Re-Injektions-Check - genau einmal; TG-3b/TG-3d: darf nie erscheinen).
// Ueber den Bootstrap-Text parametrisiert (S2/DRY) - eine Funktion fuer Outbound- UND
// Inbound-Variante statt einer Kopie mit vertauschter Konstante.
function countBootstrapOccurrences(capturedBodies, bootstrapText) {
  return capturedBodies.filter((body) => body.messages.some((m) => m.content === bootstrapText))
    .length;
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
        // TG-3b: Budget-Engine-Erstkontakt - server.js schreibt die Opening-Zeile IMMER
        // synchron per addTranscript() (/voice/outbound), BEVOR der erste /voice/turn ->
        // agentTurn-Aufruf stattfindet. Diese vorbesetzte agent-Zeile bildet genau das ab.
        seedCall({
          id: "call_tg3_budget",
          direction: "outbound",
          transcript: [{ role: "agent", text: "Guten Tag, hier ist der Assistent von Jonas." }],
        }),
        // TG-3c: Telnyx-LLM-Shim-Erstkontakt fuer INBOUND (Review-Blocker Runde 3) - dort
        // schreibt niemand eine agent-Zeile ins Transkript (analog zu call_tg3, nur inbound).
        seedCall({ id: "call_tg3_inbound", direction: "inbound" }),
        // TG-3d: Budget-Engine-Erstkontakt fuer INBOUND (analog zu call_tg3_budget) -
        // server.js schreibt die Greeting-Zeile bei /voice/incoming IMMER synchron per
        // addTranscript(), BEVOR der erste /voice/turn -> agentTurn-Aufruf stattfindet.
        seedCall({
          id: "call_tg3_inbound_budget",
          direction: "inbound",
          transcript: [{ role: "agent", text: "Guten Tag, hier ist der Assistent von Jonas." }],
        }),
        seedCall({ id: "call_tg4", direction: "outbound" }),
        // TG-REC-1 (Review-Blocker Runde 1 zu stab-p7-turn-guard-fix3): Inbound-Analogtest
        // zu TG-1 - frisches Transkript, damit agentTurn den echten Record-Gate-Pfad durchlaeuft.
        seedCall({ id: "call_tg_rec1_inbound", direction: "inbound" }),
        // G3/G26-Fix: Outbound-Analog zu call_tg_rec1_inbound - beweist, dass eine echte,
        // aber kurze Antwort ("5") jetzt AUCH outbound aufgezeichnet wird und ans Modell geht.
        seedCall({ id: "call_tg_rec1_outbound", direction: "outbound" }),
        // TG-REC-1 (Review-Blocker Runde 2): Grenzbedingungs-Analogtest zu TG-1 (b) -
        // dieselben vier spurious/leeren Werte, aber inbound. Je ein frischer Call.
        seedCall({ id: "call_tg_rec1_inbound_empty", direction: "inbound" }),
        seedCall({ id: "call_tg_rec1_inbound_ws", direction: "inbound" }),
        seedCall({ id: "call_tg_rec1_inbound_dot", direction: "inbound" }),
        seedCall({ id: "call_tg_rec1_inbound_null", direction: "inbound" }),
        // G3/G26-Fix: Empty-Turn-Guard-Analogtest - beweist, dass N aufgezeichnete
        // Rausch-Turns ('.') den R4-Deadlock-Schutz weiterhin ausloesen (Zaehlung entkoppelt
        // vom jetzt vollstaendigen Recording).
        seedCall({ id: "call_tg2_noise", direction: "outbound" }),
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

// G3/G26-Fix (Review zu phase/stab-p7-fix-rec1-r2): das Record-Gate ist jetzt RICHTUNGSLOS
// Boolean(callerText) (siehe Kommentar an agentTurn in src/claude.js) - ob ein Wert ins
// Transkript wandert, folgt seiner Wahrheit (truthy/falsy), nicht mehr seiner Substanz. Die
// Turn-STEUERUNG (end_call-Freigabe) bleibt weiterhin am Substanz-Filter
// (isSubstantialCallerText) haengen - ein Rausch-/Echo-Fragment gibt end_call also weiterhin
// NICHT frei, obwohl es jetzt (anders als vor diesem Fix) im Transkript steht.
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

// G3/G26-Fix: Analogtest zu TG-2, aber mit einer aufgezeichneten Rausch-Zeile (".") statt
// einer truthy-leeren. Beweist die Entkopplung: unansweredAgentTurns() ueberspringt die
// nicht-substanzielle caller-Zeile beim Rueckwaertslauf (zaehlt weiter als "unbeantwortet"),
// obwohl sie jetzt (anders als vor diesem Fix) im Transkript steht - der R4-Deadlock-Schutz
// bleibt intakt UND das Transkript vollstaendig.
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

// ---------- TG-3 (c): gebundener Bootstrap - beide agentTurn-Aufrufer haben einen
// unterschiedlichen Vorzustand (siehe stab-p7-spec.md "Beide Aufrufer... grounden" +
// Kommentar an OUTBOUND_OPENING_BOOTSTRAP in src/claude.js):
// - TG-3a spiegelt den Telnyx-LLM-Shim-Erstkontakt: dort schreibt niemand eine agent-Zeile
//   ins Transkript (die Disclosure/Greeting laeuft ueber einen Call-Control-Speak-Node), der
//   erste agentTurn-Aufruf trifft also auf ein WIRKLICH leeres Transkript -> Bootstrap feuert.
// - TG-3b spiegelt den Budget-Engine-Erstkontakt: server.js schreibt die Greeting-/Opening-
//   Zeile IMMER synchron per addTranscript(), BEVOR /voice/turn -> agentTurn ueberhaupt zum
//   ersten Mal aufgerufen wird -> das Transkript enthaelt ab dem allerersten Aufruf schon
//   eine agent-Zeile, der Bootstrap darf hier NIE erscheinen.
// Die hasAgentLine-Weiche in src/claude.js prueft NUR, ob schon eine agent-Zeile existiert -
// NICHT die Richtung. TG-3c/TG-3d (weiter unten) spiegeln TG-3a/TG-3b deshalb 1:1 fuer
// direction:"inbound", weil derselbe Shim-Erstkontakt auch inbound auftritt
// (telnyx-llm-shim.js loest Calls nur ueber call_control_id auf, nie ueber direction).
// ---------------------------------------------------------------------------------------

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

  // Contract-Invariante: JEDES erfasste messages-Array endet mit role:user (API-Gueltigkeit).
  for (const body of capturedBodies) {
    assert.equal(lastMessageOf(body).role, "user");
  }

  // Der Bootstrap-Text erscheint ueber ALLE Requests genau einmal (keine Re-Injektion).
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

  // Schon der ALLERERSTE Turn (Index 0) nutzt den neutralen Marker, nicht den Bootstrap -
  // genau das widerlegt die urspruengliche TG-3-Annahme, der Bootstrap sei ueber die
  // Budget-Engine im echten Erst-Turn erreichbar.
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

  // Contract-Invariante: JEDES erfasste messages-Array endet mit role:user (API-Gueltigkeit).
  for (const body of capturedBodies) {
    assert.equal(lastMessageOf(body).role, "user");
  }

  // Der Bootstrap-Text erscheint ueber ALLE Requests genau einmal (keine Re-Injektion).
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

  // Schon der ALLERERSTE Turn (Index 0) nutzt den neutralen Marker, nicht den Bootstrap -
  // server.js schreibt die Greeting-Zeile fuer inbound IMMER synchron per addTranscript()
  // (/voice/incoming), BEVOR der erste /voice/turn -> agentTurn-Aufruf stattfindet.
  for (const body of capturedBodies) {
    assert.equal(lastMessageOf(body).role, "user");
    assert.equal(lastMessageOf(body).content, SILENT_TURN_MARKER);
  }

  assert.equal(countBootstrapOccurrences(capturedBodies, INBOUND_OPENING_BOOTSTRAP), 0);
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

// ---------- TG-REC-1: Record-Gate ist RICHTUNGSLOS (G3/G26-Fix, Review zu
// phase/stab-p7-fix-rec1-r2). Byte-identisch zum Master-Stand vor stab-p7 (41ce40b:
// "if (callerText) store.addTranscript(...)") fuer BEIDE Richtungen: JEDE nicht-leere
// Aeusserung landet im Transkript, weil call.transcript direkt vom Dashboard-Live-Transkript,
// DSGVO-Export (exportTenantData) und summarizeCall gelesen wird. Der vormals outbound-only
// Substanz-Filter (isSubstantialCallerText) gatet nur noch die Turn-STEUERUNG (suppressEndCall
// + unansweredAgentTurns), nicht mehr das Recording. ----------

test("TG-REC-1 Inbound-Regression: echte Kurz-Aeusserung landet unveraendert im Transkript", async () => {
  const callId = "call_tg_rec1_inbound";
  // "5" ist kuerzer als CALLER_SUBSTANCE_MIN_LEN=2 (siehe before()) - eine echte, kurze
  // Antwort (z.B. auf "wie viele Gaeste?"), kein Echo-/Rausch-Fragment wie das "." aus TG-1.
  nextResponse = textMessage("Alles klar.");
  const call = store.getCall(callId);
  await agentTurn(call, "5");
  const callerLines = store.getCall(callId).transcript.filter((t) => t.role === "caller");
  assert.equal(callerLines.length, 1);
  assert.equal(callerLines[0].text, "5");
});

// G3/G26-Fix: Outbound-Analog zu TG-REC-1 - vor diesem Fix wurde exakt dieser Fall (echte,
// kurze Antwort unter CALLER_SUBSTANCE_MIN_LEN) outbound verworfen (Datenverlust, weder im
// Transkript noch in den ans Modell gesendeten messages). Jetzt landet "5" im Transkript UND
// geht als echter caller-Turn ans Modell (NICHT als SILENT_TURN_MARKER).
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

// TG-REC-1 (Review-Blocker Runde 2): Grenzbedingungs-Analogtest zu TG-1 (b) - dieselben
// vier spurious/leeren Werte wie SPURIOUS_CALLER_CASES oben, diesmal inbound. Das Record-Gate
// ist RICHTUNGSLOS Boolean(callerText) (byte-identisch zu 41ce40b, G3/G26-Fix) - "." und
// Whitespace landen im Transkript (wie mittlerweile auch outbound, siehe SPURIOUS_CALLER_CASES),
// waehrend leerer String/null wie ueberall unveraendert aussen vor bleiben.
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
