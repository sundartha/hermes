import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall, makeConfigOverrides } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { text, toolUse, reply, makeJsonMessage, makeWriteSse } from "./anthropic-sse-fixtures.js";

const OWNER = "Jonas Beispiel";
const SUBSTANTIAL = "Ja, Donnerstag passt gut";
const BRUECKE_TEXT = "Einen Moment, das habe ich gleich.";
const ANTWORT_TEXT = "Donnerstag um neun passt.";

const jsonMessage = makeJsonMessage("msg_alp7b");
const writeSse = makeWriteSse(jsonMessage);

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
      if (body.stream === true) return writeSse(res, scripted.blocks);
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

test("AL-P7b-8: informationsliefernde Runde - fuehrender Text, dann Antwort, genau einmal, zwei Roundtrips (AL-P17: Sprecher ist der Chunker)", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply(text(ANTWORT_TEXT))];
  armConsult("call_alp7b_1");
  const { turn, chunks } = await bridgedTurn("call_alp7b_1");

  assert.deepEqual(chunks, [BRUECKE_TEXT, ` ${ANTWORT_TEXT}`]);
  assert.equal(chunks.filter((c) => c.trim() === BRUECKE_TEXT).length, 1, "genau einmal");
  assert.equal(turn.speech, ANTWORT_TEXT);
  assert.equal(turn.speechStreamed, true, "AL-P17: auch die Antwort wurde gestreamt");
  assert.equal(turn.thinkingSignalSpoken, false, "E2: die Bruecke schweigt");
  assert.equal(bodies.length, 2, "zwei Modell-Roundtrips");
});

test("AL-P7b-9: eine Seiteneffekt-Runde bekommt KEINE Bruecke (Abnahme 2, kein Dauergeplapper)", async () => {
  bodies = [];
  queue = [reply(text("Ich notiere das fuer Jonas."), toolUse("take_message", { message: "Notiz" }))];
  armConsult("call_alp7b_2");
  const { turn } = await bridgedTurn("call_alp7b_2", "Ruf mich morgen zurueck.");
  assert.equal(turn.thinkingSignalSpoken, false);
});

test("AL-P7b-10: ein angenommenes get_consult bei bereits gestreamtem Text - der Modellsatz bleibt (AL-P17 E3)", async () => {
  bodies = [];
  const ANKUENDIGUNG = "Ich frage kurz nach.";
  queue = [reply(text(ANKUENDIGUNG), toolUse("get_consult", { question: "Passt Donnerstag um neun Uhr?" }))];
  armConsult("call_alp7b_3");
  const { turn, chunks } = await bridgedTurn("call_alp7b_3");

  const { localeFor } = await import("../src/i18n/locales.js");
  assert.equal(turn.speech, ANKUENDIGUNG);
  assert.notEqual(turn.speech, localeFor("de").consultFillerSpeech, "kein ZWEITER Haltesatz");
  assert.equal(turn.speechStreamed, true);
  assert.deepEqual(chunks, [ANKUENDIGUNG]);
  assert.equal(turn.thinkingSignalSpoken, false, "keine zusaetzliche, doppelte Ueberbrueckung");
});

test("AL-P7b-11: Flag aus -> keine Bruecke; der Satz-Chunker haengt NICHT an diesem Flag (AL-P17)", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply(text(ANTWORT_TEXT))];
  armConsult("call_alp7b_4");
  const { turn, chunks } = await withConfigOverrides({ thinkingSignalEnabled: false }, () =>
    bridgedTurn("call_alp7b_4"),
  );

  assert.deepEqual(chunks, [BRUECKE_TEXT, ` ${ANTWORT_TEXT}`]);
  assert.equal(turn.thinkingSignalSpoken, false);
  assert.equal(turn.speech, ANTWORT_TEXT, "Bestandsverhalten: die echte Antwort, unveraendert");
});

test("AL-P7b-12: mehrere weiterlaufende Runden - jeder Rundentext geht genau EINMAL raus, keine Bruecke (AL-P17)", async () => {
  bodies = [];
  const ZWISCHENTEXT = "Noch eine Sekunde.";
  queue = [
    reply(text(BRUECKE_TEXT), toolUse("nachschlagen")),
    reply(text(ZWISCHENTEXT), toolUse("nachschlagen")),
    reply(text(ANTWORT_TEXT)),
  ];
  armConsult("call_alp7b_5");
  const { turn, chunks } = await bridgedTurn("call_alp7b_5");

  assert.deepEqual(chunks, [BRUECKE_TEXT, ` ${ZWISCHENTEXT}`, ` ${ANTWORT_TEXT}`]);
  const leitung = chunks.join("");
  for (const satz of [BRUECKE_TEXT, ZWISCHENTEXT, ANTWORT_TEXT])
    assert.equal(leitung.split(satz).length - 1, 1, `"${satz}" steht nicht genau einmal auf der Leitung`);
  assert.equal(turn.thinkingSignalSpoken, false, "E2: kein Satz geht ein zweites Mal raus");
  assert.equal(turn.speech, ANTWORT_TEXT);
  assert.equal(bodies.length, 3, "drei Modell-Roundtrips");
});

test("AL-P7b-13: liefert die naechste Runde keinen Text, bleibt der gesprochene Rundentext der Turn-Text - kein Doppelsprechen", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply()];
  armConsult("call_alp7b_6");
  const { turn, chunks } = await bridgedTurn("call_alp7b_6");

  assert.equal(chunks.length, 1);
  assert.equal(turn.speech, BRUECKE_TEXT, "der gesprochene Rundentext bleibt der einzige Turn-Text");
  assert.equal(turn.speechStreamed, true, "-> der Aufrufer spricht ihn NICHT erneut");
});

test("AL-P7b-20: langer Rundentext auf dem Streaming-Pfad - Transkript == Leitung, nichts wird still gekappt (AL-P17)", async () => {
  bodies = [];
  const LANGER_RUNDENTEXT =
    "Einen Moment, ich schaue direkt im Kalender nach, ob der Termin am Donnerstag " +
    "um neun Uhr morgens noch frei ist oder ob wir einen anderen Tag zusammen finden muessen.";
  assert.ok(LANGER_RUNDENTEXT.length > 120, "Testvoraussetzung: Fixture muss ueber der Bruecken-Kappe liegen");
  queue = [reply(text(LANGER_RUNDENTEXT), toolUse("nachschlagen")), reply()];
  armConsult("call_alp7b_8");
  const { turn, chunks } = await bridgedTurn("call_alp7b_8");

  assert.equal(turn.speechStreamed, true);
  assert.equal(turn.speech, chunks.join("").trim(), "Transkript == tatsaechlich Gesprochenes");
  assert.equal(turn.speech, LANGER_RUNDENTEXT, "nichts wurde stillschweigend gekappt");
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
