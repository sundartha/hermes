// AL-P7b (Turn): agentTurn spricht den Ueberbrueckungssatz genau dann, wenn der Tool-Loop
// nach dieser Runde weiterlaeuft - hoechstens einmal pro Turn, nie bei einer Runde, die
// den Turn ohnehin beendet, nie doppelt mit einem angenommenen get_consult.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang - Praefix ist "AL-P7b-<n>:".
//
// Naht wie test/al-p7-turn-streaming.test.js: lokaler node:http-Anthropic-Mock (echtes
// SSE + JSON), kein Server-Spawn, kein pglite, kein Netz (P12/R). Die Fixtures nutzen
// armConsult (get_consult im ANGEBOTENEN Werkzeugsatz) - bis AL-P17 lieferte streamSinkFor
// dafuer null, und die Bruecke liess sich isoliert beobachten.
//
// AL-P17 (E1): get_consult ist jetzt STROM-SICHER, der Werkzeugsatz dieser Datei armiert
// also durchgehend. Die beiden Mechanismen bleiben gegenseitig exklusiv - den Vorrang hat
// jetzt aber IMMER das Streaming (E2, Doppelrede-Riegel). Deshalb zwei Anpassungen an
// dieser Datei: der Mock bekommt den SSE-Zweig (Infrastruktur, aus dem GETEILTEN
// Test-Rohstoff test/anthropic-sse-fixtures.js - kein zweiter SSE-Renderer, G5), und die
// Tests, deren Sprecher gewechselt hat, tragen ihre Begruendung einzeln am Test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall, makeConfigOverrides } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { text, toolUse, reply, makeJsonMessage, makeWriteSse } from "./anthropic-sse-fixtures.js";

const OWNER = "Jonas Beispiel";
const SUBSTANTIAL = "Ja, Donnerstag passt gut"; // hebt suppressEndCall auf
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

// AL-P17 (E1+E2) hat den SPRECHER getauscht, nicht den Ablauf.
//   Zusage vorher: die Bruecke spricht den fuehrenden Text, danach kommt die echte
//     Antwort - genau einmal, zwei Roundtrips.
//   Zusage jetzt:  derselbe Ablauf, Sprecher ist der Satz-Chunker. Die Bruecke schweigt
//     (E2), sonst stuende der Satz zweimal auf der Leitung.
//   Warum das die Absicht ist: der fuehrende Text einer look_up-/Werkzeug-Runde ist genau
//     der Satz, den die Bruecke ohnehin spraeche - nur geht er jetzt frueher raus
//     (Owner-Entscheidung O-D1-A). Die eigentliche Zusage "genau einmal" wird weiterhin
//     als ZAEHLUNG gepinnt.
test("AL-P7b-8: informationsliefernde Runde - fuehrender Text, dann Antwort, genau einmal, zwei Roundtrips (AL-P17: Sprecher ist der Chunker)", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply(text(ANTWORT_TEXT))];
  armConsult("call_alp7b_1");
  const { turn, chunks } = await bridgedTurn("call_alp7b_1");

  // E1b: die Wortgrenze steht jetzt VORNE am zweiten Fragment statt hinten am ersten.
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
  // armConsult stellt den live gemessenen Werkzeugsatz her (get_consult im ANGEBOTENEN
  // Satz). Seit AL-P17 armiert dieser Satz - die Zusage dieses Tests haengt daran nicht:
  // eine Seiteneffekt-Runde beendet den Turn und bekommt deshalb nie eine Bruecke.
  armConsult("call_alp7b_2");
  const { turn } = await bridgedTurn("call_alp7b_2", "Ruf mich morgen zurueck.");
  assert.equal(turn.thinkingSignalSpoken, false);
});

// AL-P17 (E3, Owner-Entscheidung O-D1-B).
//   Zusage vorher: ein angenommenes get_consult spricht seinen EIGENEN, LLM-freien Fueller.
//   Zusage jetzt:  nur noch, wenn dieser Turn nichts gestreamt hat. Lag der fuehrende Text
//     der Runde schon auf der Leitung, bleibt der Modellsatz stehen - ein zweiter
//     Haltesatz waere die schlechtere Erfahrung.
//   Warum das die Absicht ist: bewusste Owner-Entscheidung; die AL-P14-Zusage "der
//     Haltesatz ist LLM-frei" gilt in GENAU diesem Fall nicht mehr.
//   Kein Doppel-Pin: AL-P17-3a/3b fahren den SHIM-DRAHT (beide Richtungen), dieser Test
//     die TURN-RUECKGABE der Mit-Streaming-Richtung.
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

// AL-P17 (E1) hat die Reichweite dieses Tests praezisiert.
//   Zusage vorher: Flag aus -> keine Bruecke, KEIN Chunk.
//   Zusage jetzt:  THINKING_SIGNAL_ENABLED gated die BRUECKE, nicht den Satz-Chunker.
//     Die beiden Aussagen des Tests, die dem Flag gelten (thinkingSignalSpoken === false,
//     speech === ANTWORT_TEXT), bleiben woertlich; die Chunk-Erwartung wird auf die
//     Streaming-Fassung gezogen.
//   Warum das die Absicht ist: das Token-Streaming hat seinen eigenen Rueckweg
//     (TELNYX_SHIM_TOKEN_STREAMING); es an das Denk-Signal-Flag zu binden waere eine
//     zweite, nirgends dokumentierte Kopplung. Der byte-identische Flag-aus-Vergleich fuer
//     den PROMPT liegt in al-p7b-prompt.test.js und bleibt unberuehrt.
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

// AL-P17 (E1+E2).
//   Zusage vorher: ueber drei weiterlaufende Runden faellt genau EINE Bruecke.
//   Zusage jetzt:  NULL Bruecken - jede der drei Runden streamt ihren eigenen Text.
//   Warum das die Absicht ist: die tragende Zusage war "kein Dauergeplapper", also "kein
//     Satz geht doppelt raus". Sie bleibt und wird schaerfer gepinnt: jeder Rundentext
//     steht GENAU EINMAL auf der Leitung, in Reihenfolge, und die Bruecke schweigt.
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

// Assertions unveraendert; nur Name und Kommentar folgen dem AL-P17-Sprecherwechsel
// (Sprecher ist der Satz-Chunker, nicht mehr die Bruecke). Die Zusage - der bereits
// gesprochene fuehrende Text bleibt der Turn-Text und wird NICHT erneut gesprochen - ist
// dieselbe und wird mit denselben drei Assertions gepinnt.
test("AL-P7b-13: liefert die naechste Runde keinen Text, bleibt der gesprochene Rundentext der Turn-Text - kein Doppelsprechen", async () => {
  bodies = [];
  queue = [reply(text(BRUECKE_TEXT), toolUse("nachschlagen")), reply()];
  armConsult("call_alp7b_6");
  const { turn, chunks } = await bridgedTurn("call_alp7b_6");

  assert.equal(chunks.length, 1);
  assert.equal(turn.speech, BRUECKE_TEXT, "der gesprochene Rundentext bleibt der einzige Turn-Text");
  assert.equal(turn.speechStreamed, true, "-> der Aufrufer spricht ihn NICHT erneut");
});

// AL-P17 (E1+E2) hat den Sprecher gewechselt, und damit gilt die Kappung hier nicht mehr.
//   Zusage vorher: bei Kappung durch THINKING_SIGNAL_MAX_CHARS ist turn.speech die
//     GEKAPPTE Leitungsfassung, nie der volle Rundentext.
//   Zusage jetzt:  die 120-Zeichen-Kappung gehoert NUR der Bruecke (ihr Einheitstest
//     al-p7b-thinking-signal.test.js pinnt sie unveraendert). Auf dem Streaming-Pfad wird
//     der Rundentext VOLLSTAENDIG gesprochen - es gibt nichts zu kappen.
//   Warum das die Absicht ist: die Kappe ist eine Notbremse gegen eine zu LANGE
//     Ueberbrueckung, nicht gegen eine lange Antwort. Die Kernaussage des
//     Korrektheits-Fixes - TRANSKRIPT == LEITUNG - bleibt und wird direkt als Gleichung
//     gegen die tatsaechlich geschriebenen Chunks gepinnt.
test("AL-P7b-20: langer Rundentext auf dem Streaming-Pfad - Transkript == Leitung, nichts wird still gekappt (AL-P17)", async () => {
  bodies = [];
  // 167 Zeichen, deutlich ueber THINKING_SIGNAL_MAX_CHARS (120) - ein anderes Fixture als
  // BRUECKE_TEXT (34 Zeichen), sonst belegt der Test nichts (Repo-Lehre "gleiche
  // Fixture-Werte testen nichts").
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
