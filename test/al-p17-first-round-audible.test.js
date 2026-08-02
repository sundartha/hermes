// AL-P17: die ERSTE Modellrunde hoerbar machen. AL-D2 hat gemessen, dass in 18 von 21
// Live-Turns gar kein Werkzeug gefeuert wird - ein solcher Turn ist EINE Modellrunde,
// deren Text die fertige Antwort ist, und genau dort war der Satz-Chunker (AL-P7) still,
// weil look_up an keiner Frische-Bedingung haengt und damit immer im angebotenen
// Werkzeugsatz liegt (AL-D1-2).
//
// Diese Datei pinnt die drei Aenderungen der Phase samt ihrer Korrektheitsbedingung:
//   E1  streamSinkFor armiert, wenn JEDES angebotene Werkzeug STROM-SICHER ist
//       (Allowlist; ein unbekanntes Werkzeug schaltet das Streamen ab, G27)
//   E1b der Satz-Chunker setzt sein fuehrendes Trennzeichen auch im ERSTEN Fragment,
//       wenn eine fruehere Runde desselben Turns schon gesprochen hat
//   E2  die Bruecke (AL-P7b) schweigt, wenn der Rundentext schon auf dem Draht liegt
//   E3  der deterministische Consult-Fueller entfaellt genau dann (Owner O-D1-B)
//
// Gefahren wird der SHIM (POST mit stream:true, wie Telnyx live) gegen den ECHTEN
// agentTurn und einen lokalen Anthropic-Mock - dieselbe Naht wie
// test/al-d2-thinking-signal-diagnostics.test.js, gemeinsame Fixtures aus
// test/anthropic-sse-fixtures.js, Shim-Fakes aus test/telnyx-shim-harness.js. Kein
// Server-Spawn, kein pglite, kein Netz nach draussen (P12/R): look_up wird durchgaengig
// OHNE query gefeuert, die Suche stirbt vor Kontingent, Gebuehr und Egress.
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Namensanfang - sonst
// landen sie still im Gates-Lauf (package.json config.i18nCatalogPattern), wo Rot erlaubt
// ist (Lehre catalog-id-prefix-misroutes-tests). Praefix ist "AL-P17-<n>:".
//
// WICHTIG zur Import-Ordnung: test/telnyx-shim-harness.js und test/config-namespaces-helper.js
// importieren src/config.js STATISCH und duerfen deshalb erst NACH dem process.env-Setup
// dynamisch geladen werden (Lehre test-base-env-drift).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { captureConsole, seedCall, seedState, tempDataDir } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { text, toolUse, reply, makeJsonMessage, makeWriteSse } from "./anthropic-sse-fixtures.js";

const OWNER = "Jonas Beispiel";

// Gespraechs-Fixtures. Alle Saetze sind satzfertig - shapeForSpeech ist darauf die
// Identitaet, die Erwartungen bleiben damit woertlich lesbar.
const SUBSTANTIAL = "Ja, Donnerstag passt gut"; // hebt suppressEndCall auf
const ERSTER_SATZ = "Guten Tag, hier ist Hermes.";
const ZWEITER_SATZ = "Wie kann ich Ihnen heute weiterhelfen?";
const ZWEI_SAETZE = `${ERSTER_SATZ} ${ZWEITER_SATZ}`;
const BRUECKE = "Einen Moment, das schaue ich nach.";
const ANTWORT = "Donnerstag um neun Uhr passt.";
const CONSULT_ANKUENDIGUNG = "Ich frage kurz nach.";
const CONSULT_FRAGE = "Passt Donnerstag um neun Uhr?";

const LOOK_UP = "look_up";
const GET_CONSULT = "get_consult";
const END_CALL = "end_call";
const TAKE_MESSAGE = "take_message";
// Ein Werkzeug, das es nicht gibt und nie geben wird - der Traeger des fail-closed-Beweises.
const UNBEKANNTES_WERKZEUG = "zeitreise_buchen";
const LOOKUP_EGRESS_BLOCKED_LINE = "[lookup] verworfen grund=egress";
const TURN_OK_MARKER = "[telnyx-shim] turn_ok";

// Frist-Argument fuer den Einheitstest: so weit weg, dass Bedingung 3 (roundFitsDeadline)
// garantiert haelt und der Test wirklich Bedingung 2 misst.
const DEADLINE_WEIT_GENUG_MS = 10 ** 9;

const jsonMessage = makeJsonMessage("msg_alp17");
const writeSse = makeWriteSse(jsonMessage);

const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

let server;
let queue = [];
let bodies = [];
let store, claude, localeFor, harness, fakeTelnyxShimConfig;

// Ein abgenommener, aktiver Outbound-Call MIT call_control_id - daran korreliert der Shim.
function answeredOutbound(suffix) {
  return seedCall({
    id: `call_alp17_${suffix}`,
    direction: "outbound",
    language: "de",
    answeredAt: new Date().toISOString(),
    callControlId: `cc_alp17_${suffix}`,
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
  process.env.ANTHROPIC_API_KEY = "test-alp17-key";
  // ZWINGEND an: ohne das Flag waere der E2-Riegeltest (AL-P17-2) ein Vakuum - die
  // Bruecke schwiege ohnehin, und der Riegel bewiese nichts.
  process.env.THINKING_SIGNAL_ENABLED = "true";
  process.env.LOOKUP_ENABLED = "true";
  // Nur fuer die ARMIERUNG von look_up (inCallSearchProvider ist ohne Key fail-closed
  // inaktiv). Gefeuert wird look_up hier ausschliesslich OHNE query-Feld -
  // sanitizeLookupQuery liefert dann null, die Suche stirbt VOR Kontingent, Gebuehr und
  // Egress. Es geht keine Suchanfrage nach draussen.
  process.env.EXA_API_KEY = "test-alp17-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  // Explizit: lookupProviderFor faellt bei der Realtime-Engine aus, und dann waere der
  // live gemessene Werkzeugsatz gar nicht nachgestellt.
  process.env.VOICE_ENGINE = "budget";
  const calls = ["p1", "p2", "p3a", "p3b", "p6"].map(answeredOutbound);
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
// halten, get_consult steht im ANGEBOTENEN Werkzeugsatz. Zusammen mit LOOKUP_ENABLED ist
// das exakt der live gemessene Werkzeugsatz (look_up UND get_consult).
function armConsult(callId) {
  const call = store.getCall(callId);
  call.consultPolledAtMs = Date.now();
  call.answeredAt = new Date().toISOString();
  return call;
}

// Pass-through, KEIN Double: reicht den ECHTEN agentTurn durch und haelt sein Ergebnis
// fest - nur so misst diese Datei die reale Bedingungskette und nicht ein Testskript.
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

// Operate-Schritt (P13): EIN Shim-Request mit offenem Sprechkanal.
async function shimTurn({ call, callerText = SUBSTANTIAL }) {
  const agentTurn = recordingAgentTurn(claude.agentTurn);
  const handler = harness.makeHandler({
    store: harness.fakeStore({ call }),
    config: fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true }),
    agentTurn,
    voiceControl: harness.voiceControlSpy(),
  });
  const res = harness.fakeRes();
  const req = harness.validReq(call, {
    stream: true,
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

// ---------- E1: der Kernbeweis in der dominanten Live-Klasse (18/21) ----------

test("AL-P17-1: Text ohne Werkzeug im LIVE-Werkzeugsatz - der erste fertige Satz geht raus, bevor die Runde fertig ist", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];

  const { res, turn, turnOk } = await shimTurn({ call: armConsult("call_alp17_p1") });

  // Praemisse LAUT: geprueft wird der live gemessene Satz, nicht ein bequemer.
  assert.ok(turn.offeredToolNames.includes(LOOK_UP), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.ok(turn.offeredToolNames.includes(GET_CONSULT), `Fixture greift nicht: ${turn.offeredToolNames}`);
  assert.equal(turn.roundtrips, 1, "genau EINE Modellrunde - ihr Text IST die fertige Antwort");
  assert.equal(turn.streamArmedRounds, 1, "der Kern von E1: diese Runde ist jetzt armiert");
  assert.equal(bodies[0].stream, true, "der Anthropic-Streamingpfad lief WIRKLICH");

  // Die Zusage der Phase als Draht-Reihenfolge: MEHRERE Deltas, das ERSTE ist der erste
  // FERTIGE Satz. Die SSE-Fixture halbiert den Rohtext mitten im ZWEITEN Satz - der
  // Schnitt hinter Satz 1 stammt also nachweislich vom Chunker, nicht von der
  // Delta-Grenze des Anbieters.
  assert.deepEqual(contentPieces(res), [ERSTER_SATZ, ` ${ZWEITER_SATZ}`]);
  assert.ok(contentPieces(res).length > 1);
  assert.equal(contentPieces(res)[0], ERSTER_SATZ);

  // Der Rahmen bleibt spec-konform: EIN Strom, nicht zwei Antworten.
  assert.equal(harness.sseRole(res), "assistant");
  assert.equal(new Set(harness.sseChunks(res).map((c) => c.id)).size, 1);
  assert.equal(harness.sseFinishReason(res), "stop");
  assert.equal(harness.sseEndsWithDone(res), true);
  assert.ok(turnOk.includes('"streamArmedRounds":1'));
});

// ---------- E2 (+E1b): Doppelrede-Riegel ----------

test("AL-P17-2: Text plus look_up - der fuehrende Satz steht GENAU EINMAL auf dem Draht", async () => {
  bodies = [];
  // look_up bewusst OHNE query: die Suche stirbt am Egress-Riegel, look_up bleibt
  // trotzdem in Runde 2 im Werkzeugsatz (deterministisch, kostenlos, kein Netz).
  queue = [reply(text(BRUECKE), toolUse(LOOK_UP)), reply(text(ANTWORT))];

  const { res, lines, turn } = await shimTurn({ call: armConsult("call_alp17_p2") });

  // E1b: zwischen den beiden Runden steht eine Wortgrenze - ohne sie klebte
  // "...schaue ich nach.Donnerstag um neun Uhr passt." auf der Leitung.
  assert.deepEqual(contentPieces(res), [BRUECKE, ` ${ANTWORT}`]);

  // E2: der Satz wurde NICHT zusaetzlich von der Bruecke geschrieben.
  const wire = harness.sseContent(res);
  assert.equal(wire.split(BRUECKE).length - 1, 1, "der Satz steht GENAU EINMAL auf dem Draht");
  assert.ok(wire.indexOf(BRUECKE) < wire.indexOf(ANTWORT));
  assert.equal(turn.thinkingSignalSpoken, false, "die Bruecke schweigt - der Text liegt schon auf der Leitung");
  assert.equal(turn.speechStreamed, true);
  assert.equal(turn.speech, ANTWORT);
  assert.equal(turn.roundtrips, 2);

  // Negativbeweis: keine Suche hat den Prozess verlassen.
  assert.ok(lines.some((l) => l.includes(LOOKUP_EGRESS_BLOCKED_LINE)));
});

// ---------- E3: Consult-Kollision, beide Richtungen ----------

test("AL-P17-3a: angenommenes get_consult MIT gestreamtem Text - der Modellsatz bleibt, kein zweiter Haltesatz", async () => {
  bodies = [];
  queue = [reply(text(CONSULT_ANKUENDIGUNG), toolUse(GET_CONSULT, { question: CONSULT_FRAGE }))];
  const call = armConsult("call_alp17_p3a");

  const { res, turn } = await shimTurn({ call });

  assert.equal(turn.speech, CONSULT_ANKUENDIGUNG, "der Modellsatz bleibt stehen");
  assert.notEqual(turn.speech, localeFor("de").consultFillerSpeech);
  assert.equal(turn.speechStreamed, true);
  assert.deepEqual(contentPieces(res), [CONSULT_ANKUENDIGUNG], "kein ZWEITER Haltesatz");
  assert.equal(turn.roundtrips, 1, "ein angenommenes get_consult beendet den Turn weiterhin sofort");
  // E3 aendert NUR den gesprochenen Satz - die Consult-Mechanik ist unberuehrt.
  assert.equal(store.getCall(call.id).consults.length, 1, "die Rueckfrage wurde trotzdem gestellt");
});

test("AL-P17-3b: angenommenes get_consult OHNE gestreamten Text - der Fueller springt unveraendert ein", async () => {
  bodies = [];
  // Bewusst ueber "Runde ohne fuehrenden Text" abgegrenzt, nicht ueber "kein Draht": so
  // isoliert der Test genau die neue Bedingung (speechStreamed) und nicht den Kanal.
  queue = [reply(toolUse(GET_CONSULT, { question: CONSULT_FRAGE }))];
  const call = armConsult("call_alp17_p3b");

  const { res, turn } = await shimTurn({ call });

  assert.equal(turn.speech, localeFor("de").consultFillerSpeech, "der Fueller springt unveraendert ein");
  assert.equal(turn.speechStreamed, false);
  assert.deepEqual(contentPieces(res), [localeFor("de").consultFillerSpeech]);
  assert.equal(store.getCall(call.id).consults.length, 1);
});

// ---------- E1: fail-closed mit einem erfundenen Werkzeug ----------

// Reiner Einheitstest gegen das exportierte streamSinkFor: ueber agentTurn ist der Fall
// NICHT erreichbar, weil agentTools per Konstruktion nur BEKANNTE Werkzeuge anbieten kann.
test("AL-P17-4: ein unbekanntes Werkzeug im angebotenen Satz schaltet das Streamen ab (Allowlist, G27)", () => {
  const sinkArgs = (tools) => ({
    onSpeechChunk: () => {},
    tools,
    elapsedMs: 0,
    deadlineMs: DEADLINE_WEIT_GENUG_MS,
  });

  assert.equal(
    claude.streamSinkFor(sinkArgs([{ name: END_CALL }, { name: UNBEKANNTES_WERKZEUG }])),
    null,
    "ein unbekanntes Werkzeug im Satz schaltet das Streamen ab (fail-closed, G27)",
  );
  assert.equal(claude.streamSinkFor(sinkArgs([{ name: UNBEKANNTES_WERKZEUG }])), null);

  // Positivkontrolle - ohne sie waere der Negativbefund wertlos. Zugleich die EINZIGE
  // Assertion, die eine Mutation von every auf some faengt (ende-zu-ende ist sie
  // unfangbar, weil kein realer Werkzeugsatz ein unbekanntes Werkzeug enthaelt).
  assert.ok(
    claude.streamSinkFor(
      sinkArgs([{ name: END_CALL }, { name: TAKE_MESSAGE }, { name: LOOK_UP }, { name: GET_CONSULT }]),
    ),
    "der volle bekannte Satz armiert",
  );

  // Bedingung 1 bleibt unveraendert fail-closed.
  assert.equal(
    claude.streamSinkFor({ ...sinkArgs([{ name: LOOK_UP }]), onSpeechChunk: undefined }),
    null,
  );
});

// ---------- Offenlegung: aktive Pruefung, kein Vertrauen ----------

// AL-P17-5 (genau EIN bookTokenUsage je Modellrunde im gestreamten Gutfall) liegt in
// test/al-p7-turn-streaming.test.js: dort leben bookingSnapshot/bookingDelta und
// PAYMENT_ENABLED bereits - eine zweite Ledger-Fixture waere G5/S2-Duplizierung.

test("AL-P17-6: die Offenlegung liegt auf einem ANDEREN Pfad - der Satz-Chunker kann sie nicht zerschneiden", async () => {
  bodies = [];
  queue = [reply(text(ZWEI_SAETZE))];
  const call = armConsult("call_alp17_p6");

  const { res } = await shimTurn({ call });

  // disclosureSentence fliesst ausschliesslich ueber openingText (Call-Control-speak bzw.
  // der TeXML-Render der Budget-Engine) - nie aus agentTurn, nie durch den Satz-Chunker.
  assert.ok(!harness.sseContent(res).includes(claude.disclosureSentence(call)));
  assert.equal(claude.openingText(call).startsWith(claude.disclosureSentence(call)), true);
});
