// GQ-P2 (Gespraechsqualitaet, Phase 2): die Offen-Frist des In-Call-Consults.
//
// Gegenstand sind die Abnahmen der Phase:
//   1) eine Antwort nach ~10 s wird angenommen und landet im HINTERGRUND (+ Gegenbeispiel
//      nach Ablauf der Offen-Frist);
//   2) fail-closed: abgelaufene ODER fehlende Frist lehnt ab, Consult #0 (Klingelzeit)
//      stirbt dagegen nie an der Uhr;
//   3) zwei Turns ohne Antwort toeten die Rueckfrage NICHT mehr (W2-Gegenbeweis);
//   4) kein Ueberbrueckungstext behauptet eine fehlende Faehigkeit;
//   5) die Offen-Frist traegt zwei volle Poll-Zyklen (Herleitung festgenagelt).
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Namensanfang - sonst
// landen sie still im Gates-Lauf (package.json config.i18nCatalogPattern), wo Rot erlaubt
// ist (Lehre catalog-id-prefix-misroutes-tests). Praefix ist "GQ-P2-<n>:".
//
// Naht wie test/al-p14-in-call-consult.test.js: lokaler node:http-Anthropic-Mock,
// DATA_DIR + Flags VOR dem ersten config-Import, danach dynamischer Import. Kein
// Server-Spawn, kein Netz, kein Sleep (P12/R, T9) - Fristen werden ueber askedAt/
// answeredAt kuenstlich verschoben.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const QUESTION = "Darf ich den Termin auch auf Freitag legen?";
const SUBSTANTIAL = "Ja, Donnerstag passt gut";
const CONSULT = "get_consult";

function message(content, stopReason) {
  return {
    id: "msg_gqp2",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}
const textOnly = (text) => message([{ type: "text", text }], "end_turn");
const toolCall = (name, input, id = "tu1") => ({ type: "tool_use", id, name, input });
const withTools = (text, ...uses) => message([{ type: "text", text }, ...uses], "tool_use");

let server;
let queue = [];
let bodies = [];
let store, ops, defaults, claude, inCall, delivery, config, LOCALES, SUPPORTED_LANGUAGES;
let callSeq = 0;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queue.shift() || textOnly("UNGEWOLLTER-ZUSATZ-ROUNDTRIP")));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-gqp2-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const calls = [];
  for (let i = 1; i <= 30; i++) {
    calls.push(seedCall({ id: `call_gqp2_${i}`, direction: "outbound", answeredAt: null }));
  }
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls,
    }),
  );
  ({ config } = await import("../src/config.js"));
  store = await import("../src/store.js");
  ops = await import("../src/store/state-ops.js");
  defaults = await import("../src/store/defaults.js");
  claude = await import("../src/claude.js");
  inCall = await import("../src/consult/in-call.js");
  delivery = await import("../src/consult/delivery.js");
  ({ LOCALES, SUPPORTED_LANGUAGES } = await import("../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

// Naechster freier vorgesaete Call. Nimmt einen Datensatz aus dem Pool statt neue
// anzulegen (createCall braucht ein Outbound-Gate, das hier nicht Gegenstand ist).
function nextCall() {
  callSeq += 1;
  return store.getCall(`call_gqp2_${callSeq}`);
}

// Ein Call, dessen Consult #0-Klassifikation stabil ist: answeredAt liegt WEIT vor jedem
// askedAt, das die Tests kuenstlich setzen (bis zu CONSULT_OPEN_MAX_MS = 300000 ms
// zurueck) - jeder danach emittierte Consult bleibt zweifelsfrei ein In-Call-Consult.
function inCallReadyCall() {
  const call = nextCall();
  call.answeredAt = new Date(Date.now() - 600_000).toISOString();
  return call;
}

// Ein Call, der ALLE Registrierungs-Bedingungen fuer decideConsultRequest erfuellt:
// frischer Poll + Anker nahe der Minutengrenze null (consultFitsBillingMinute haelt).
function turnReadyCall() {
  const call = nextCall();
  call.answeredAt = new Date().toISOString();
  call.consultPolledAtMs = Date.now();
  return call;
}

// Ops-Tests brauchen "active" nur waehrend der answerConsult-Pruefung (Regel 1: der
// Guthaben-Gate liest LIVE laufende Calls). Ohne diesen Abschluss wuerde jeder mit einer
// alten answeredAt bestueckte Testcall dem Tenant Live-Minuten anrechnen und die
// naechsten Turn-Tests am Budget-Gate scheitern lassen (KEIN Testartefakt eines echten
// Anrufs). Reiner Testaufraeumer, kein Produktionscode.
function endCall(call) {
  call.status = "ended";
  return call;
}

// ---------- 1: Annahme innerhalb der Offen-Frist + Gegenbeispiel danach ----------

test("GQ-P2-1: eine Antwort nach ~10 s wird angenommen und landet im HINTERGRUND", () => {
  const call = inCallReadyCall();
  store.emitConsult(call.id, [QUESTION]);
  const stored = store.getCall(call.id);
  stored.consults[0].askedAt = new Date(Date.now() - 10_000).toISOString();
  const eventId = stored.consults[0].id;
  const { outcome, mergedFacts } = inCall.acceptConsultAnswer(stored, {
    eventId,
    facts: ["Freitag passt auch"],
  });
  assert.equal(outcome, defaults.CONSULT_ANSWER.ACCEPTED);
  assert.ok(mergedFacts >= 1);
  assert.match(claude.systemPrompt(store.getCall(call.id)), /Freitag passt auch/);

  // Gegenbeispiel: derselbe Aufruf, aber die Offen-Frist ist laengst um.
  const call2 = inCallReadyCall();
  store.emitConsult(call2.id, [QUESTION]);
  const stored2 = store.getCall(call2.id);
  stored2.consults[0].askedAt = new Date(Date.now() - inCall.CONSULT_OPEN_MS - 1).toISOString();
  const eventId2 = stored2.consults[0].id;
  const before = JSON.stringify(stored2.context?.key_facts || []);
  const rejected = inCall.acceptConsultAnswer(stored2, { eventId: eventId2, facts: ["Zu spaet"] });
  assert.equal(rejected.outcome, defaults.CONSULT_ANSWER.DEADLINE_PASSED);
  assert.equal(rejected.mergedFacts, 0);
  assert.equal(JSON.stringify(store.getCall(call2.id).context?.key_facts || []), before);
  endCall(store.getCall(call.id));
  endCall(store.getCall(call2.id));
});

// ---------- 2: fail-closed - abgelaufen ODER fehlende Frist, Consult #0 stirbt nie ----------

test("GQ-P2-2: nach Ablauf der Offen-Frist bleibt die Antwort draussen (fail-closed)", () => {
  const call = inCallReadyCall();
  store.emitConsult(call.id, [QUESTION]);
  const stored = store.getCall(call.id);
  stored.consults[0].askedAt = new Date(Date.now() - inCall.CONSULT_OPEN_MS - 1).toISOString();
  const res = inCall.acceptConsultAnswer(stored, {
    eventId: stored.consults[0].id,
    facts: ["X"],
  });
  assert.equal(res.outcome, defaults.CONSULT_ANSWER.DEADLINE_PASSED);

  // fehlende Frist ist fail-closed, nicht fail-open: kein openMs -> Ablehnung.
  const call2 = inCallReadyCall();
  store.emitConsult(call2.id, [QUESTION]);
  const stored2 = store.getCall(call2.id);
  const res2 = store.answerConsult(stored2.id, {
    eventId: stored2.consults[0].id,
    facts: ["Y"],
    nowMs: Date.now(),
    openMs: undefined,
  });
  assert.equal(res2.outcome, defaults.CONSULT_ANSWER.DEADLINE_PASSED);

  // Gegenbeispiel: Consult #0 (Klingelzeit) - askedAt VOR answeredAt, also KEIN
  // In-Call-Consult. Er stirbt nie an der Uhr, selbst mit absurd kleinem openMs.
  const call3 = nextCall();
  const askedBeforePickup = new Date(Date.now() - 3_600_000).toISOString();
  store.emitConsult(call3.id, [QUESTION]);
  const stored3 = store.getCall(call3.id);
  stored3.consults[0].askedAt = askedBeforePickup;
  stored3.answeredAt = new Date().toISOString(); // Abnahme NACH der Rueckfrage
  const res3 = store.answerConsult(stored3.id, {
    eventId: stored3.consults[0].id,
    facts: ["Ring-Time-Antwort"],
    nowMs: Date.now(),
    openMs: 1,
  });
  assert.equal(res3.outcome, defaults.CONSULT_ANSWER.ACCEPTED);
  endCall(store.getCall(call.id));
  endCall(store.getCall(call2.id));
  endCall(store.getCall(call3.id));
});

// ---------- 3: zwei Turns ohne Antwort toeten die Rueckfrage NICHT ----------

test("GQ-P2-3: zwei Turns ohne Antwort toeten die Rueckfrage NICHT (Gegenbeweis zu W2)", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = turnReadyCall();
  const t1 = await claude.agentTurn(call, SUBSTANTIAL);
  assert.equal(t1.speech, LOCALES.de.consultFillerSpeech);

  bodies = [];
  queue = [textOnly("UNGEWOLLTER-ZUSATZ-ROUNDTRIP")];
  const t2 = await claude.agentTurn(call, "Hallo?");
  assert.equal(bodies.length, 0, "HOLD ist LLM-frei");
  assert.equal(t2.speech, LOCALES.de.consultHoldSpeech);

  bodies = [];
  queue = [textOnly("Ich entscheide vorlaeufig.")];
  const t3 = await claude.agentTurn(call, "Sind Sie noch da?");
  assert.equal(bodies.length, 1, "normaler LLM-Turn, PENDING blockiert nichts");
  assert.equal(t3.speech, "Ich entscheide vorlaeufig.");
  assert.equal(store.getCall(call.id).consults[0].status, defaults.CONSULT_STATUS.OPEN);
  const pendingMarked = bodies[0].messages.at(-1).content;
  assert.ok(pendingMarked.endsWith(LOCALES.de.prompt.turnControl.consultPending));

  bodies = [];
  queue = [textOnly("Weiter im Text.")];
  const t4 = await claude.agentTurn(call, "Also?");
  assert.equal(store.getCall(call.id).consults[0].status, defaults.CONSULT_STATUS.OPEN);
  const noSecondMarker = bodies[0].messages.at(-1).content;
  assert.ok(!noSecondMarker.includes(LOCALES.de.prompt.turnControl.consultPending));
  assert.equal(t4.speech, "Weiter im Text.");

  // die Rueckfrage lebt noch - eine Antwort wird angenommen.
  const accepted = inCall.acceptConsultAnswer(store.getCall(call.id), {
    eventId: store.getCall(call.id).consults[0].id,
    facts: ["Freitag ist ok"],
  });
  assert.equal(accepted.outcome, defaults.CONSULT_ANSWER.ACCEPTED);

  // Gegenbeispiel: dieselbe Turn-Folge, aber askedAt liegt vor der Offen-Frist.
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call2 = turnReadyCall();
  await claude.agentTurn(call2, SUBSTANTIAL);
  const stored2 = store.getCall(call2.id);
  // askedAt UND answeredAt gemeinsam zurueckversetzen (askedAt bleibt >= answeredAt,
  // sonst faellt der Consult aus der In-Call-Klassifikation, Muster AL-P14-19).
  const askedAtMs2 = Date.now() - inCall.CONSULT_OPEN_MS - 1;
  stored2.answeredAt = new Date(askedAtMs2 - 1000).toISOString();
  stored2.consults[0].askedAt = new Date(askedAtMs2).toISOString();
  bodies = [];
  queue = [textOnly("Fallback greift.")];
  await claude.agentTurn(call2, "Und?");
  assert.equal(store.getCall(call2.id).consults[0].status, defaults.CONSULT_STATUS.TIMED_OUT);
  const timeoutMarked = bodies[0].messages.at(-1).content;
  assert.ok(timeoutMarked.endsWith(LOCALES.de.prompt.turnControl.consultTimeout));
  const rejected = inCall.acceptConsultAnswer(store.getCall(call2.id), {
    eventId: store.getCall(call2.id).consults[0].id,
    facts: ["Zu spaet"],
  });
  assert.equal(rejected.outcome, defaults.CONSULT_ANSWER.ALREADY_ANSWERED);
});

// ---------- 4: kein Ueberbrueckungstext behauptet eine fehlende Faehigkeit ----------

// Muster bench-must-reproduce-defect: die Denylist muss auf einem Negativ-Literal treffen
// koennen, sonst kann dieser Test nie rot werden.
const FALSE_CAPABILITY_DENYLIST =
  /kein[e]? (Funktion|Möglichkeit)|not able to|no (function|way) to|aucune (fonction|possibilité)/i;

test("GQ-P2-4: kein Ueberbrueckungstext behauptet eine fehlende Faehigkeit", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const tc = LOCALES[lang].prompt.turnControl;
    assert.doesNotMatch(
      tc.consultPending,
      FALSE_CAPABILITY_DENYLIST,
      `${lang}: consultPending behauptet eine fehlende Faehigkeit`,
    );
    assert.doesNotMatch(
      tc.consultTimeout,
      FALSE_CAPABILITY_DENYLIST,
      `${lang}: consultTimeout behauptet eine fehlende Faehigkeit`,
    );
  }
  // Gegenprobe: die Denylist ist nicht leer - sie kann tatsaechlich treffen.
  assert.match(
    "Ich habe leider keine Funktion, um das zu konsultieren.",
    FALSE_CAPABILITY_DENYLIST,
  );
});

// ---------- 5: die Offen-Frist traegt zwei volle Poll-Zyklen ----------

test("GQ-P2-5: die Offen-Frist traegt zwei volle Poll-Zyklen", () => {
  assert.ok(
    config.tenancy.consultOpenMs >= 2 * delivery.CONSULT_POLL_HOLD_MS,
    "consultOpenMs deckt zwei Long-Poll-Zyklen nicht ab",
  );
  assert.ok(
    config.tenancy.consultOpenMs > inCall.CONSULT_WAIT_MS,
    "Offen-Frist muss laenger sein als die Warte-Frist",
  );
  // Gegenbeispiel: die Beziehung ist NICHT zufaellig erfuellt - eine vertauschte Annahme
  // (Warten laenger als Sterben) waere strukturell falsch.
  assert.ok(!(inCall.CONSULT_WAIT_MS >= config.tenancy.consultOpenMs));
});

