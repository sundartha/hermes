// AL-D1 (Diagnose): die zwei Live-Befunde des ersten Ende-zu-Ende-Anrufs am Code
// reproduzieren - get_consult feuert nie, und "streamChunks":0 trotz eingeschaltetem
// Token-Streaming. KEIN Fix: diese Datei belegt Ursachen und pinnt das Messinstrument.
//
// Gegenstand sind vier Zusagen:
//   (A) Falsifikation - ein beantworteter Consult #0 (VOR dem Abnehmen gestellt) verbraucht
//       das In-Call-Kontingent NICHT; der "geteilte Zaehler" ist NICHT die Ursache;
//   (B) BEHOBEN durch AL-P17 - bis dahin schaltete ein informationslieferndes Werkzeug im
//       Satz (look_up ODER get_consult) die Streaming-Armierung ab (streamArmedRounds 0,
//       der gemessene Befund B). Seit AL-P17 (E1: Allowlist der STROM-SICHEREN Werkzeuge,
//       E3: der Consult-Fueller ersetzt keinen gesprochenen Text mehr) armieren genau
//       dieselben Fixture-Zustaende. Die beiden Tests bleiben stehen und wandern vom
//       Ursachen-Pin zum Behoben-Pin; der historische Messwert steht in
//       tasks/al-d1-report.md und tasks/al-p17-diagnose.md;
//   (C) Positivkontrolle - ein rein seiteneffekt-basierter Satz streamt wirklich (ohne sie
//       waere (B) auch bei komplett totem Streaming gruen);
//   (D) das Instrument selbst - offeredToolNames ist die Union ueber die Runden und
//       PII-frei, consultClientIsPolling haelt an seinen Grenzen.
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Namensanfang - sonst
// landen sie still im Gates-Lauf (package.json config.i18nCatalogPattern), wo Rot erlaubt
// ist (Lehre catalog-id-prefix-misroutes-tests). Praefix ist "AL-D1-<n>:".
//
// Naht wie test/al-p7-turn-streaming.test.js: lokaler node:http-Anthropic-Mock mit ECHTEM
// Anthropic-SSE, Flags + DATA_DIR VOR dem ersten config-Import, danach dynamischer Import.
// Kein Server-Spawn, kein pglite, kein Netz nach draussen (P12/R).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { text, toolUse, reply, makeJsonMessage, makeWriteSse } from "./anthropic-sse-fixtures.js";

const OWNER = "Jonas Beispiel";
const SUBSTANTIAL = "Ja, Donnerstag passt gut"; // hebt suppressEndCall auf
const ZWEI_SAETZE = "Guten Tag, hier ist Hermes. Wie kann ich Ihnen helfen?";
const CONSULT = "get_consult";
const LOOK_UP = "look_up";
const END_CALL = "end_call";
const TAKE_MESSAGE = "take_message";

// Ein Consult #0 entsteht beim WAEHLEN, also vor markAnswered. Der Abstand muss nur
// echt positiv sein - isInCallConsult vergleicht askedAt >= answeredAt.
const CONSULT_ZERO_LEAD_MS = 60_000;

// --- Skript-Bausteine: text/toolUse/reply + Draht-Rendering (JSON + SSE) aus dem
// gemeinsamen Test-Rohstoff test/anthropic-sse-fixtures.js. Eigene Nachrichten-ID.
const jsonMessage = makeJsonMessage("msg_ald1");
const writeSse = makeWriteSse(jsonMessage);

const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

let server;
let queue = [];
let bodies = [];
let store, claude, inCall, research;

// Ein Call, der alle STATISCHEN Registrierungs-Bedingungen erfuellt: outbound, aktiv,
// abgenommen. Poll-Frische und Kontingente setzt jeder Test selbst - genau die sind der
// Gegenstand.
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
  // Nur fuer die ARMIERUNG von look_up (inCallSearchProvider ist ohne Key fail-closed
  // inaktiv). Das Werkzeug wird in keinem Test dieser Datei gefeuert - es geht nie eine
  // Suchanfrage nach draussen.
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

// Die tools-Liste, die der Turn tatsaechlich an Anthropic geschickt hat.
const sentToolNames = () => bodies[0].tools.map((t) => t.name);

// --- Build-Schritt (P13): Zustandsvorbedingungen, keine Testlogik ---

// Ein wartender MCP-Client (frischer Poll) - Faktor 6 von consultAvailableFor.
function armPoll(callId) {
  const call = store.getCall(callId);
  call.consultPolledAtMs = Date.now();
  return call;
}

// Consult #0: VOR dem Abnehmen gestellt und laengst beantwortet. Genau der Datensatz,
// von dem die Spec vermutet, er verbrauche das In-Call-Kontingent.
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

// Erschoepftes Nachschlag-Kontingent -> look_up faellt aus dem Werkzeugsatz. Noetig fuer
// jeden Fall, der den Werkzeugsatz auf die reinen Seiteneffekt-Werkzeuge reduzieren will.
function exhaustLookup(call) {
  call.lookups = research.LOOKUP_MAX_PER_CALL;
  return call;
}

// Operate-Schritt (P13): ein Turn MIT Abnehmer, die Chunks als Liste.
async function streamedTurn(call, callerText = SUBSTANTIAL) {
  const chunks = [];
  const turn = await claude.agentTurn(call, callerText, {
    onSpeechChunk: (t) => chunks.push(t),
  });
  return { turn, chunks };
}

// ---------- A: Falsifikation des naheliegendsten Verdachts (H-A4) ----------

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

// ---------- B: derselbe Fixture-Zustand, seit AL-P17 behoben ----------

// AL-D1 hat hier Befund B gemessen (streamArmedRounds === 0); AL-P17 hat es behoben.
//   Zusage vorher: look_up im angebotenen Satz sperrt das Streamen.
//   Zusage jetzt:  look_up ist strom-sicher (Owner-Entscheidung O-D1-A: der fuehrende Text
//     einer look_up-Runde ist genau der Satz, den das Denk-Signal ohnehin spraeche) und
//     armiert - derselbe Fixture-Zustand, gedrehter Messwert.
//   Warum das die Absicht ist: genau dieser Wert IST die Phase AL-P17. Der Test wird nicht
//     geloescht, er wandert vom Ursachen-Pin zum Behoben-Pin.
test("AL-D1-2: ein armiertes look_up armiert das Streamen (AL-P17 E1 - vorher Befund B)", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];
  // Kein frischer Poll -> get_consult ist NICHT im Satz; look_up ist der alleinige
  // informationsliefernde Kandidat.
  const { turn, chunks } = await streamedTurn(store.getCall("call_ald1_2"));

  assert.ok(turn.offeredToolNames.includes(LOOK_UP), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.ok(!turn.offeredToolNames.includes(CONSULT), "get_consult darf hier nicht mitwirken");
  assert.equal(turn.streamArmedRounds, 1, "AL-P17: genau diese Runde ist jetzt armiert");
  assert.ok(chunks.length > 1, `mehrere Chunks erwartet, waren: ${JSON.stringify(chunks)}`);
  assert.equal(bodies[0].stream, true, "der Streamingpfad wurde wirklich gefahren");
});

// Wie AL-D1-2, mit einem zusaetzlichen Grund fuer die Zulassung:
//   Zusage vorher: get_consult im angebotenen Satz sperrt das Streamen.
//   Zusage jetzt:  get_consult ist strom-sicher, weil E3 (Owner-Entscheidung O-D1-B) den
//     deterministischen Fueller genau dann entfallen laesst, wenn bereits gestreamt wurde.
//     Ohne E3 waere diese Aufnahme falsch - die beiden Aenderungen gehoeren zusammen.
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

// ---------- C: Positivkontrolle ----------

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

// ---------- D: das Instrument selbst ----------

test("AL-D1-5: offeredToolNames ist die Union ueber die Runden und traegt keinen Gespraechstext", async () => {
  bodies = [];
  // Runde 0: Werkzeug OHNE Text -> der Loop laeuft weiter. Runde 1: der Antworttext.
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
