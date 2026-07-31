// AL-P7b (Turn): agentTurn spricht den Ueberbrueckungssatz genau dann, wenn der Tool-Loop
// nach dieser Runde weiterlaeuft - hoechstens einmal pro Turn, nie bei einer Runde, die
// den Turn ohnehin beendet, nie doppelt mit einem angenommenen get_consult.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang - Praefix ist "AL-P7b-<n>:".
//
// Naht wie test/al-p7-turn-streaming.test.js: lokaler node:http-Anthropic-Mock (echtes
// SSE + JSON), kein Server-Spawn, kein pglite, kein Netz (P12/R). Die Fixtures nutzen
// armConsult (get_consult im ANGEBOTENEN Werkzeugsatz), damit streamSinkFor (AL-P7) fuer
// diese Runde null liefert - sonst wuerde der Runden-Text schon ueber den Satz-Chunker
// gestreamt, und die Bruecke liesse sich nicht isoliert beobachten (die beiden Mechanismen
// sind bewusst gegenseitig exklusiv: entweder die Runde streamt satzweise, oder sie bekommt
// eine nachtraegliche Bruecke - niemals beides).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall, makeConfigOverrides } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const SUBSTANTIAL = "Ja, Donnerstag passt gut"; // hebt suppressEndCall auf
const BRUECKE_TEXT = "Einen Moment, das habe ich gleich.";
const ANTWORT_TEXT = "Donnerstag um neun passt.";
const MOCK_USAGE = { input_tokens: 10, output_tokens: 5 };

const text = (value) => ({ type: "text", text: value });
const toolUse = (name, input = {}) => ({ type: "tool_use", id: "tu1", name, input });
const reply = (...blocks) => ({ blocks });

function jsonMessage(blocks) {
  return {
    id: "msg_alp7b",
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
let store, claude, config, withConfigOverrides;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      const scripted = queue.shift() || reply(text("UNGEWOLLTER-ZUSATZ-ROUNDTRIP"));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jsonMessage(scripted.blocks)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-alp7b-key";
  process.env.PAYMENT_ENABLED = "true";
  process.env.THINKING_SIGNAL_ENABLED = "true";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const answeredAt = new Date().toISOString();
  const calls = [];
  for (let i = 1; i <= 8; i++)
    calls.push(seedCall({ id: `call_alp7b_${i}`, direction: "outbound", language: "de", answeredAt }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  ({ config } = await import("../src/config.js"));
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
  ({ withConfigOverrides } = makeConfigOverrides(config));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

// Frischer Poll + abgenommener Call -> consultAvailableFor haelt, get_consult steht im
// ANGEBOTENEN Werkzeugsatz (Zustandsvorbedingung, keine Testlogik). Muster
// al-p7-turn-streaming.test.js armConsult.
function armConsult(callId) {
  const call = store.getCall(callId);
  call.consultPolledAtMs = Date.now();
  call.answeredAt = new Date().toISOString();
  return call;
}

async function bridgedTurn(callId, callerText = SUBSTANTIAL) {
  const chunks = [];
  const turn = await claude.agentTurn(store.getCall(callId), callerText, {
    onSpeechChunk: (t) => chunks.push(t),
  });
  return { turn, chunks };
}

function bookingSnapshot() {
  const bucket = store.usageOf(BOOTSTRAP_TENANT_ID);
  const events = store
    .pendingMeterEvents()
    .filter((e) => e.tenantId === BOOTSTRAP_TENANT_ID && e.kind === USAGE_EVENT_KIND.AI_TOKEN);
  return { inputTokens: bucket.inputTokens, outputTokens: bucket.outputTokens, events };
}

test("AL-P7b-8: informationsliefernde Runde bruecken, danach die echte Antwort - genau einmal, zwei Roundtrips", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply(text(ANTWORT_TEXT))];
  armConsult("call_alp7b_1");
  const { turn, chunks } = await bridgedTurn("call_alp7b_1");

  assert.deepEqual(chunks, [`${BRUECKE_TEXT} `], "genau EIN Chunk: die Bruecke, mit Trennzeichen");
  assert.equal(turn.speech, ANTWORT_TEXT);
  assert.equal(turn.speechStreamed, false, "die Antwort selbst wurde nicht gestreamt");
  assert.equal(turn.thinkingSignalSpoken, true);
  assert.equal(bodies.length, 2, "zwei Modell-Roundtrips");
});

test("AL-P7b-9: eine Seiteneffekt-Runde bekommt KEINE Bruecke (Abnahme 2, kein Dauergeplapper)", async () => {
  bodies = [];
  queue = [reply(text("Ich notiere das fuer Jonas."), toolUse("take_message", { message: "Notiz" }))];
  // armConsult haelt den Test-Mock einheitlich auf JSON (kein SSE-Anthropic-Mock in dieser
  // Datei): get_consult im ANGEBOTENEN Werkzeugsatz laesst streamSinkFor (AL-P7) null
  // liefern, unabhaengig davon, dass die Runde SELBST ein Seiteneffekt-Werkzeug waehlt.
  armConsult("call_alp7b_2");
  const { turn } = await bridgedTurn("call_alp7b_2", "Ruf mich morgen zurueck.");
  assert.equal(turn.thinkingSignalSpoken, false);
});

test("AL-P7b-10: ein angenommenes get_consult bruecken NICHT selbst - es spricht seinen eigenen Fueller", async () => {
  bodies = [];
  queue = [reply(text("Ich frage kurz nach."), toolUse("get_consult", { question: "Passt Donnerstag um neun Uhr?" }))];
  armConsult("call_alp7b_3");
  const { turn } = await bridgedTurn("call_alp7b_3");

  const { localeFor } = await import("../src/i18n/locales.js");
  assert.equal(turn.speech, localeFor("de").consultFillerSpeech);
  assert.equal(turn.speechStreamed, false);
  assert.equal(turn.thinkingSignalSpoken, false, "keine zusaetzliche, doppelte Ueberbrueckung");
});

test("AL-P7b-11: Flag aus -> byte-identisches Bestandsverhalten, keine Bruecke, kein Chunk", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply(text(ANTWORT_TEXT))];
  armConsult("call_alp7b_4");
  const { turn, chunks } = await withConfigOverrides({ thinkingSignalEnabled: false }, () =>
    bridgedTurn("call_alp7b_4"),
  );

  assert.deepEqual(chunks, []);
  assert.equal(turn.thinkingSignalSpoken, false);
  assert.equal(turn.speech, ANTWORT_TEXT, "Bestandsverhalten: die echte Antwort, unveraendert");
});

test("AL-P7b-12: mehrere weiterlaufende Runden - genau EINE Bruecke ueber den ganzen Turn", async () => {
  bodies = [];
  queue = [
    reply(text(BRUECKE_TEXT), toolUse("nachschlagen")),
    reply(text("Noch eine Sekunde."), toolUse("nachschlagen")),
    reply(text(ANTWORT_TEXT)),
  ];
  armConsult("call_alp7b_5");
  const { turn, chunks } = await bridgedTurn("call_alp7b_5");

  assert.equal(chunks.length, 1, `genau EIN Chunk erwartet, waren: ${JSON.stringify(chunks)}`);
  assert.equal(turn.thinkingSignalSpoken, true);
  assert.equal(turn.speech, ANTWORT_TEXT);
  assert.equal(bodies.length, 3, "drei Modell-Roundtrips");
});

test("AL-P7b-13: liefert die naechste Runde keinen Text, bleibt die Bruecke der Turn-Text - kein Doppelsprechen", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply()];
  armConsult("call_alp7b_6");
  const { turn, chunks } = await bridgedTurn("call_alp7b_6");

  assert.equal(chunks.length, 1);
  assert.equal(turn.speech, BRUECKE_TEXT, "der Brueckentext bleibt der einzige Turn-Text");
  assert.equal(turn.speechStreamed, true, "-> der Aufrufer spricht ihn NICHT erneut");
});

test("AL-P7b-20: Rundentext ueber THINKING_SIGNAL_MAX_CHARS - turn.speech ist die GEKAPPTE Leitungs-Fassung, nie der volle Rundentext (Korrektheits-Fix Runde 1)", async () => {
  bodies = [];
  // 167 Zeichen, deutlich ueber THINKING_SIGNAL_MAX_CHARS (120) - ein anderes Fixture als
  // BRUECKE_TEXT (34 Zeichen), sonst greift die Kappung nie und der Test belegt nichts
  // (Repo-Lehre "gleiche Fixture-Werte testen nichts").
  const LANGER_RUNDENTEXT =
    "Einen Moment, ich schaue direkt im Kalender nach, ob der Termin am Donnerstag " +
    "um neun Uhr morgens noch frei ist oder ob wir einen anderen Tag zusammen finden muessen.";
  assert.ok(LANGER_RUNDENTEXT.length > 120, "Testvoraussetzung: Fixture muss ueber der Kappe liegen");
  queue = [reply(text(LANGER_RUNDENTEXT), toolUse("nachschlagen")), reply()];
  armConsult("call_alp7b_8");
  const { turn, chunks } = await bridgedTurn("call_alp7b_8");

  assert.equal(chunks.length, 1);
  const gesprochenerText = chunks[0].trimEnd();
  assert.ok(gesprochenerText.length < LANGER_RUNDENTEXT.length, "auf der Leitung steht die gekappte Fassung");
  assert.equal(turn.speechStreamed, true);
  // Die Kernaussage des Fixes: turn.speech (Transkript/Summary/SMS) MUSS mit der Leitung
  // uebereinstimmen - NICHT der volle, nie gesprochene Rundentext.
  assert.equal(turn.speech, gesprochenerText, "Transkript == tatsaechlich Gesprochenes");
  assert.notEqual(turn.speech, LANGER_RUNDENTEXT, "der volle Rundentext wurde NIE vollstaendig gesprochen");
});

test("AL-P7b-14: die Bruecke erzeugt KEINEN zusaetzlichen Modell-Aufruf und KEINE zusaetzliche Buchung", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply(text(ANTWORT_TEXT))];
  armConsult("call_alp7b_7");
  const before = bookingSnapshot();
  await bridgedTurn("call_alp7b_7");
  const after = bookingSnapshot();
  assert.equal(after.events.length - before.events.length, 2, "genau ein Beleg je Runde, zwei Runden");
});
