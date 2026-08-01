// AL-D2 (Diagnose): warum hat das Denk-Signal (AL-P7b) in KEINEM der 21 Live-Turns vom
// 2026-08-01 gefeuert? Diese Datei FIXT NICHTS - sie misst, welche der Bedingungen, die
// speakBridge passieren muss, in welcher Turn-Klasse sperrt.
//
// Der Code prueft fail-closed in dieser Reihenfolge (Berichtssprache B1..B7 aus
// tasks/al-d2-spec.md, hier in der TATSAECHLICHEN Pruefreihenfolge):
//   B3  claude.js agentTurn: "if (!toolUses.length) break;" - vor allem anderen
//   B4  claude.js agentTurn: ein angenommenes get_consult steigt aus und spricht selbst
//   B5  claude.js agentTurn: der benannte Ausdruck loopContinues kurzschliesst speakBridge
//   B7  thinking-signal.js makeThinkingSignal: der Einmal-pro-Turn-Riegel (spoken)
//   B1  thinking-signal.js speakBridge: config.voice.thinkingSignalEnabled
//   B2  thinking-signal.js speakBridge: onSpeechChunk - im Shim das "wire"-Objekt
//   B6  thinking-signal.js speakBridge: bridgeSpeechFrom(speech) liefert nicht-leer
//
// Getrieben wird der SHIM (POST auf die Shim-Route mit stream:true, wie Telnyx live) gegen
// den ECHTEN agentTurn und einen lokalen Anthropic-Mock. Zwei Naehte in einer Datei:
// Anthropic-Mock wie test/al-d1-cause-diagnostics.test.js (JSON + echtes SSE), Shim-Fakes
// aus test/telnyx-shim-harness.js. Kein Server-Spawn, kein pglite, kein Netz nach draussen
// (P12/R) - insbesondere verlaesst KEINE Suchanfrage den Prozess (s. look_up unten).
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Namensanfang - sonst
// landen sie still im Gates-Lauf (package.json config.i18nCatalogPattern), wo Rot erlaubt
// ist (Lehre catalog-id-prefix-misroutes-tests). Praefix ist "AL-D2-<n>:".
//
// WICHTIG zur Import-Ordnung: test/telnyx-shim-harness.js und test/config-namespaces-helper.js
// importieren src/config.js STATISCH. Sie duerfen deshalb erst NACH dem process.env-Setup
// dynamisch geladen werden, sonst zieht config.js seinen env-Schnappschuss vor dem
// testeigenen Setup (Lehre test-base-env-drift). Statisch erlaubt ist nur, was config.js
// nicht mitzieht.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { captureConsole, seedCall, seedState, tempDataDir } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";

// Gespraechs-Fixtures. SUBSTANTIAL hebt suppressEndCall auf; BRUECKE ist bewusst kurz
// (34 Zeichen) und satzfertig - shapeForSpeech ist darauf die Identitaet, bridgeSpeechFrom
// liefert also exakt BRUECKE + Trennzeichen.
const SUBSTANTIAL = "Ja, Donnerstag passt gut";
const BRUECKE = "Einen Moment, das schaue ich nach.";
const ANTWORT = "Donnerstag um neun Uhr passt.";
const NUR_TEXT = "Gern, ich richte das aus.";
const NOTIZ_TEXT = "Ich notiere das fuer Jonas.";
const NOTIZ_BITTE = "Ruf mich morgen zurueck.";
const CONSULT_ANKUENDIGUNG = "Ich frage kurz nach.";
const CONSULT_FRAGE = "Passt Donnerstag um neun Uhr?";

const LOOK_UP = "look_up";
const GET_CONSULT = "get_consult";
const TAKE_MESSAGE = "take_message";
const LOOKUP_EGRESS_BLOCKED_LINE = "[lookup] verworfen grund=egress";
const TURN_OK_MARKER = "[telnyx-shim] turn_ok";
const MOCK_USAGE = { input_tokens: 10, output_tokens: 5 };

// Zwei Fixtures fuer den PII-Negativbeweis der turn_ok-Zeile. Bewusst so gewaehlt, dass
// sie in keinem Feldnamen und keiner Code-Konstante vorkommen koennen.
const GEHEIMER_SATZ = "Ananas-Windrad-Quittung siebzehn.";
const GEHEIMER_ANRUFERTEXT = "Kastanienbaum-Fahrplan zwanzig.";

// --- Skript-Bausteine: EINE Antwort-Beschreibung, zwei Draht-Formen (JSON + SSE) ---
// Wortgleich uebernommen aus test/al-d1-cause-diagnostics.test.js: Testfixture-Rohstoff,
// kein Produktivcode. Eine Extraktion in test/helpers.js ist NICHT Teil dieser Phase
// (helpers.js importiert config.js bewusst nicht, und der Rohstoff wuerde ihn ueber den
// Anthropic-Mock nicht mitziehen - der Umbau bleibt trotzdem eine eigene Entscheidung).
const text = (value) => ({ type: "text", text: value });
const toolUse = (name, input = {}) => ({ type: "tool_use", id: "tu1", name, input });
const reply = (...blocks) => ({ blocks });

const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

function jsonMessage(blocks) {
  return {
    id: "msg_ald2",
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

// Echtes Anthropic-SSE: message_start -> je Block content_block_start/-delta/-stop ->
// message_delta -> message_stop. Text kommt in ZWEI Deltas, deren Grenze bewusst NICHT
// auf einer Satzgrenze liegt.
function writeSse(res, blocks) {
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
let store, claude, localeFor, harness, fakeTelnyxShimConfig;

// Ein abgenommener, aktiver Outbound-Call MIT call_control_id - daran korreliert der
// Shim (fakeStore.getCallByControlId). Poll-Frische setzt armConsult je Fall selbst.
function answeredOutbound(suffix) {
  return seedCall({
    id: `call_ald2_${suffix}`,
    direction: "outbound",
    language: "de",
    answeredAt: new Date().toISOString(),
    callControlId: `cc_ald2_${suffix}`,
  });
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
  process.env.ANTHROPIC_API_KEY = "test-ald2-key";
  // B1 ist AN: jeder Negativ-Befund dieser Datei gilt TROTZ eingeschaltetem Flag.
  process.env.THINKING_SIGNAL_ENABLED = "true";
  process.env.LOOKUP_ENABLED = "true";
  // Nur fuer die ARMIERUNG von look_up (inCallSearchProvider ist ohne Key fail-closed
  // inaktiv). Gefeuert wird look_up in dieser Datei ausschliesslich OHNE query-Feld -
  // sanitizeLookupQuery liefert dann null, und die Suche wird VOR Kontingent, Gebuehr und
  // Egress verworfen. Es geht keine Suchanfrage nach draussen.
  process.env.EXA_API_KEY = "test-ald2-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  // Explizit: lookupProviderFor faellt bei der Realtime-Engine aus, und dann waere der
  // live gemessene Werkzeugsatz gar nicht nachgestellt.
  process.env.VOICE_ENGINE = "budget";
  const calls = ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"].map(answeredOutbound);
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
  ({ localeFor } = await import("../src/i18n/locales.js"));
  harness = await import("./telnyx-shim-harness.js");
  ({ fakeTelnyxShimConfig } = await import("./config-namespaces-helper.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

// --- Build-Schritt (P13): Zustandsvorbedingungen, keine Testlogik ---

// Frischer Poll + frisches Abnehmen -> consultAvailableFor UND consultFitsBillingMinute
// halten, get_consult steht im ANGEBOTENEN Werkzeugsatz (Muster al-p7b-turn-bridge.js).
function armConsult(callId) {
  const call = store.getCall(callId);
  call.consultPolledAtMs = Date.now();
  call.answeredAt = new Date().toISOString();
  return call;
}

// Pass-through, KEIN Double: reicht den ECHTEN agentTurn durch und haelt sein Ergebnis
// fest. Nur so misst diese Datei die reale Bedingungskette und nicht ein Testskript.
function recordingAgentTurn(real) {
  const turns = [];
  async function agentTurn(call, callerText, options) {
    const turn = await real(call, callerText, options);
    turns.push(turn);
    return turn;
  }
  agentTurn.turns = turns;
  return agentTurn;
}

// --- Operate-Schritt (P13): EIN Shim-Request gegen den echten agentTurn ---
// tokenStreaming steuert B2 (das wire-Objekt), bodyStream den zweiten Disjunkt derselben
// Bedingung (req.body.stream).
async function shimTurn({ call, tokenStreaming = true, bodyStream = true, callerText = SUBSTANTIAL }) {
  const agentTurn = recordingAgentTurn(claude.agentTurn);
  const handler = harness.makeHandler({
    store: harness.fakeStore({ call }),
    config: fakeTelnyxShimConfig({ telnyxShimTokenStreaming: tokenStreaming }),
    agentTurn,
    voiceControl: harness.voiceControlSpy(),
  });
  const res = harness.fakeRes();
  const req = harness.validReq(call, {
    stream: bodyStream,
    messages: [{ role: "user", content: callerText }],
  });
  const lines = await captureConsole(() => handler(req, res));
  return {
    res,
    lines,
    turn: agentTurn.turns[0],
    turnOk: lines.find((l) => l.includes(TURN_OK_MARKER)),
  };
}

// Die content-Deltas des SSE-Stroms in SCHREIBREIHENFOLGE - fakeRes.write pusht in
// res.chunks, das Array IST der Draht.
const contentPieces = (res) =>
  harness
    .sseChunks(res)
    .map((c) => c.choices[0].delta.content)
    .filter((t) => typeof t === "string");

// ---------- K1: Text ohne Werkzeug - der dominante Live-Fall (18/21) ----------

test("AL-D2-1: K1 Text ohne Werkzeug - B3 sperrt, und BEIDE Streaming-Faehigkeiten sind still", async () => {
  bodies = [];
  queue = [reply(text(NUR_TEXT))];

  const { res, turn, turnOk } = await shimTurn({ call: store.getCall("call_ald2_k1") });

  assert.ok(turn.offeredToolNames.includes(LOOK_UP), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.equal(turn.thinkingSignalSpoken, false, "B3 sperrt: die Runde lieferte kein tool_use");
  assert.equal(turn.roundtrips, 1, "genau EINE Modellrunde - ihr Text IST die fertige Antwort");
  assert.equal(turn.streamArmedRounds, 0, "AL-P7 ist in derselben Klasse ebenfalls still");
  assert.equal(bodies.length, 1);
  assert.notEqual(bodies[0].stream, true, "der Bestandspfad (kein Anthropic-Streaming) lief");
  assert.deepEqual(contentPieces(res), [NUR_TEXT], "der Anrufer hoert genau EINEN Block, am Ende");
  assert.ok(turnOk.includes('"thinkingSignal":false'));
  assert.ok(turnOk.includes('"streamArmedRounds":0'));
});

// ---------- K2: take_message plus Text (3/21) ----------

test("AL-D2-2: K2 take_message plus Text - B5 sperrt (sideEffectOnlyRound bei vorhandenem speech)", async () => {
  bodies = [];
  queue = [reply(text(NOTIZ_TEXT), toolUse(TAKE_MESSAGE, { message: "Rueckruf" }))];

  const { res, turn } = await shimTurn({
    call: store.getCall("call_ald2_k2"),
    callerText: NOTIZ_BITTE,
  });

  assert.ok(turn.offeredToolNames.includes(TAKE_MESSAGE), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.equal(turn.thinkingSignalSpoken, false);
  assert.deepEqual(turn.toolNames, [TAKE_MESSAGE]);
  assert.equal(turn.roundtrips, 1, "der Ausstieg griff (loopContinues=false), nicht B6");
  assert.equal(bodies.length, 1);
  assert.equal(contentPieces(res).length, 1);
});

// ---------- K3: POSITIVKONTROLLE - ohne sie waeren alle Negativ-Befunde wertlos ----------

test("AL-D2-3: K3 look_up MIT fuehrendem Text - die Bruecke feuert und liegt auf dem Draht VOR der Antwort", async () => {
  bodies = [];
  // look_up bewusst OHNE query-Feld: sanitizeLookupQuery liefert null, die Suche wird
  // VOR Kontingent, Gebuehr und Egress verworfen -> deterministisch, kostenlos, und
  // look_up bleibt auch in Runde 2 im Werkzeugsatz.
  queue = [reply(text(BRUECKE), toolUse(LOOK_UP)), reply(text(ANTWORT))];

  const { res, lines, turn, turnOk } = await shimTurn({ call: armConsult("call_ald2_k3") });

  assert.ok(turn.offeredToolNames.includes(LOOK_UP), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.ok(turn.offeredToolNames.includes(GET_CONSULT), "der live gemessene Werkzeugsatz");

  // 1) Es wurde ueberhaupt gebrueckt - sonst waeren K1/K2/K4/K5 auch bei totem Signal gruen.
  assert.equal(turn.thinkingSignalSpoken, true);
  assert.ok(turnOk.includes('"thinkingSignal":true'));
  assert.ok(turnOk.includes('"speechWireOpen":true'));

  // 2) DIE Reihenfolge auf dem Draht: genau zwei content-Deltas, Bruecke an Position 0.
  assert.deepEqual(contentPieces(res), [`${BRUECKE} `, ANTWORT]);

  // 3) Zusaetzlich als Ordnung formuliert, damit ein spaeterer Chunk-Umbau hier auffaellt.
  const wire = harness.sseContent(res);
  assert.ok(wire.indexOf(BRUECKE) >= 0 && wire.indexOf(BRUECKE) < wire.indexOf(ANTWORT));

  // 4) role-Delta zuerst, EIN Envelope, sauberer Abschluss - der Strom ist wirklich EINER.
  assert.equal(harness.sseRole(res), "assistant");
  assert.equal(new Set(harness.sseChunks(res).map((c) => c.id)).size, 1);
  assert.equal(harness.sseFinishReason(res), "stop");
  assert.equal(harness.sseEndsWithDone(res), true);

  // 5) Zwei Modellrunden, keine Sonder-Route.
  assert.equal(bodies.length, 2);
  assert.equal(turn.roundtrips, 2);

  // 6) Negativbeweis: keine Suche hat den Prozess verlassen.
  assert.ok(lines.some((l) => l.includes(LOOKUP_EGRESS_BLOCKED_LINE)));
});

// ---------- K4: look_up OHNE fuehrenden Text - der Befund mit Zukunft ----------

test("AL-D2-4: K4 look_up ohne fuehrenden Text - B6 sperrt, der Anrufer hoert die Wartezeit als Stille", async () => {
  bodies = [];
  queue = [reply(toolUse(LOOK_UP)), reply(text(ANTWORT))];

  const { res, lines, turn, turnOk } = await shimTurn({ call: armConsult("call_ald2_k4") });

  assert.ok(turn.offeredToolNames.includes(LOOK_UP), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.equal(turn.thinkingSignalSpoken, false, "B6: bridgeSpeechFrom('') liefert leer");
  assert.equal(turn.roundtrips, 2, "der Loop lief weiter - B5 hat NICHT gesperrt");
  assert.deepEqual(contentPieces(res), [ANTWORT], "waehrend der ganzen Werkzeug-Wartezeit: nichts");
  assert.ok(turnOk.includes('"thinkingSignal":false'));
  assert.ok(lines.some((l) => l.includes(LOOKUP_EGRESS_BLOCKED_LINE)));
});

// ---------- K5: wie K3, aber ohne Sprechkanal ----------

test("AL-D2-5: K5 derselbe Modellverlauf ohne Wire - B2 sperrt, speechWireOpen macht es sichtbar", async () => {
  bodies = [];
  // Identische queue wie K3: der EINZIGE Unterschied ist der Kanal.
  queue = [reply(text(BRUECKE), toolUse(LOOK_UP)), reply(text(ANTWORT))];

  const { res, turn, turnOk } = await shimTurn({
    call: armConsult("call_ald2_k5"),
    tokenStreaming: false,
  });

  assert.ok(turn.offeredToolNames.includes(LOOK_UP), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.equal(turn.thinkingSignalSpoken, false);
  assert.equal(turn.streamArmedRounds, 0, "ohne Kanal ist auch AL-P7 strukturell still");
  assert.deepEqual(contentPieces(res), [ANTWORT]);
  assert.ok(turnOk.includes('"speechWireOpen":false'));
  assert.ok(turnOk.includes('"thinkingSignal":false'));
});

// ---------- K6: angenommenes get_consult - B4 sperrt, und zwar korrekt ----------

test("AL-D2-6: K6 angenommenes get_consult - B4 sperrt korrekt, der Fueller spricht statt der Bruecke", async () => {
  bodies = [];
  queue = [reply(text(CONSULT_ANKUENDIGUNG), toolUse(GET_CONSULT, { question: CONSULT_FRAGE }))];

  const { res, turn, turnOk } = await shimTurn({ call: armConsult("call_ald2_k6") });

  assert.ok(turn.offeredToolNames.includes(GET_CONSULT), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.equal(turn.thinkingSignalSpoken, false, "keine doppelte Ueberbrueckung");
  assert.equal(turn.speech, localeFor("de").consultFillerSpeech, "ein ANDERER Sprecher, nicht Stille");
  assert.equal(turn.speechStreamed, false);
  assert.deepEqual(contentPieces(res), [localeFor("de").consultFillerSpeech]);
  assert.equal(bodies.length, 1, "ein angenommenes get_consult beendet den Turn sofort");
  assert.ok(turnOk.includes('"thinkingSignal":false'));
  assert.ok(turnOk.includes('"speechEmpty":false'));
});

// ---------- Die zwei Pin-Tests fuer das neue Boolean (kein Anthropic-Mock noetig) ----------

// EIN Shim-Lauf gegen einen agentTurn-Spy - die turn_ok-Zeile ist der Gegenstand.
async function spiedTurnOk({ call, tokenStreaming, bodyStream }) {
  const handler = harness.makeHandler({
    store: harness.fakeStore({ call }),
    config: fakeTelnyxShimConfig({ telnyxShimTokenStreaming: tokenStreaming }),
    agentTurn: harness.agentTurnSpy({ speech: GEHEIMER_SATZ, endCall: false }),
    voiceControl: harness.voiceControlSpy(),
  });
  const req = harness.validReq(call, {
    stream: bodyStream,
    messages: [{ role: "user", content: GEHEIMER_ANRUFERTEXT }],
  });
  const lines = await captureConsole(() => handler(req, harness.fakeRes()));
  const turnOk = lines.filter((l) => l.includes(TURN_OK_MARKER));
  assert.equal(turnOk.length, 1, "genau eine turn_ok-Zeile erwartet");
  return turnOk[0];
}

test("AL-D2-7: speechWireOpen:true bei offenem Kanal - und die Zeile traegt keinen Gespraechsinhalt", async () => {
  const line = await spiedTurnOk({
    call: store.getCall("call_ald2_k7"),
    tokenStreaming: true,
    bodyStream: true,
  });

  assert.ok(line.includes('"speechWireOpen":true'), "das Boolean muss stehen");
  assert.ok(!line.includes(GEHEIMER_SATZ), "der gesprochene Text darf nie in der Zeile landen");
  assert.ok(!line.includes(GEHEIMER_ANRUFERTEXT), "der Anrufer-Text darf nie in der Zeile landen");
});

test("AL-D2-8: stream:false im Body -> speechWireOpen:false, obwohl das Flag an ist", async () => {
  const line = await spiedTurnOk({
    call: store.getCall("call_ald2_k8"),
    tokenStreaming: true,
    bodyStream: false,
  });

  assert.ok(line.includes('"speechWireOpen":false'), "beide Disjunkte der wire-Bedingung sind gepinnt");
});
