// AL-P14 (PLAN-ASSISTANT-LEAP, Phase 14): get_consult IM Gespraech, nicht-blockierend.
//
// Gegenstand sind fuenf Zusagen:
//   (A) Registrierung - das Werkzeug existiert NUR fuer Outbound-Calls mit frischem
//       Client-Poll und scharfen Flags (Richtungs-Gate = der Sicherheitskern);
//   (B) Ausfuehrung - Annahme kostet EINEN Roundtrip, Ablehnung ist deterministisch und
//       verbraucht das Kontingent nicht;
//   (C) Paraphrase-Riegel - woertliche Zitate verlassen den Server nicht;
//   (D) Wartezeit/Fallback - hoechstens EIN Halte-Satz, danach der Mandats-Fallback,
//       und der Anruf laeuft in JEDEM Fall weiter;
//   (E) reine Einheiten (Grenzfaelle) ohne Mock-Server.
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Namensanfang - sonst
// landen sie still im Gates-Lauf (package.json config.i18nCatalogPattern), wo Rot erlaubt
// ist (Lehre catalog-id-prefix-misroutes-tests). Praefix ist "AL-P14-<n>:".
//
// Naht wie test/al-p4-side-effect-tool-loop.test.js: lokaler node:http-Anthropic-Mock,
// ANTHROPIC_BASE_URL + DATA_DIR + die drei Flags VOR dem ersten config-Import, danach
// dynamischer Import von src/store.js / src/claude.js. Kein Server-Spawn, kein pglite,
// kein Netz (P12/R).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { anthropicToolsOnWire } from "./anthropic-wire-fixtures.js";

const OWNER = "Jonas Beispiel";
// Hebt suppressEndCall auf (isSubstantialCallerText) - ohne substanzielle Anrufer-Zeile
// wuerde der end_call-Zweig unterdrueckt und AL-P14-11 pruefte den falschen Pfad.
const SUBSTANTIAL = "Ja, Donnerstag passt gut";
const CONSULT = "get_consult";
const QUESTION = "Darf ich den Termin auch auf Freitag legen?";

function message(content, stopReason) {
  return {
    id: "msg_alp14",
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
// Ein Tool-Aufruf mit frei waehlbarem input - get_consult braucht { question }.
const toolCall = (name, input, id = "tu1") => ({ type: "tool_use", id, name, input });
const withTools = (text, ...uses) =>
  message([{ type: "text", text }, ...uses], "tool_use");

// Faellt die queue leer, antwortet der Mock mit einem MARKIERTEN Fallbacktext - ein
// ungewollter Zusatz-Roundtrip faellt damit in bodies.length UND im speech auf.
const UNWANTED_EXTRA_ROUNDTRIP_MARKER = "UNGEWOLLTER-ZUSATZ-ROUNDTRIP";

let server;
let queue = [];
let bodies = [];

let store, ops, claude, LOCALES, inCall, question, defaults, speechShape;

// Ein Call, der ALLE Registrierungs-Bedingungen erfuellt: Outbound, aktiv, abgenommen.
// Der frische Poll wird pro Test gesetzt (das ist der Gegenstand mehrerer Faelle).
function answeredOutbound(id, overrides = {}) {
  const answeredAt = new Date().toISOString();
  return seedCall({ id, direction: "outbound", language: "de", answeredAt, ...overrides });
}

// Frischer Poll + Uhr-Anker so, dass consultFitsBillingMinute haelt (Sekunde 0 der
// laufenden Minute). Beides sind Zustandsvorbedingungen, keine Testlogik.
function armCall(callId) {
  const call = store.getCall(callId);
  call.consultPolledAtMs = Date.now();
  call.answeredAt = new Date().toISOString();
  return call;
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queue.shift() || textOnly(UNWANTED_EXTRA_ROUNDTRIP_MARKER)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-alp14-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const calls = [];
  for (let i = 1; i <= 22; i++) calls.push(answeredOutbound(`call_alp14_${i}`));
  calls.push(answeredOutbound("call_alp14_inbound", { direction: "inbound" }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  ops = await import("../src/store/state-ops.js");
  defaults = await import("../src/store/defaults.js");
  claude = await import("../src/claude.js");
  inCall = await import("../src/consult/in-call.js");
  question = await import("../src/consult/question.js");
  speechShape = await import("../src/speech-shape.js");
  ({ LOCALES } = await import("../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

// Die tools-Liste, die der Turn tatsaechlich an Anthropic geschickt hat.
const sentToolNames = () => bodies[0].tools.map((t) => t.name);

// ---------- A: Registrierung (Richtungs-Gate) ----------

test("AL-P14-1: Outbound + frischer Poll + Flags an -> get_consult steht im Werkzeugsatz", async () => {
  bodies = [];
  queue = [textOnly("Alles klar.")];
  const call = armCall("call_alp14_1");
  await claude.agentTurn(call, SUBSTANTIAL);
  assert.ok(sentToolNames().includes(CONSULT), `tools: ${sentToolNames().join(",")}`);
});

test("AL-P14-2: Inbound bekommt das Werkzeug NIE und ein dennoch gefeuertes get_consult wird abgelehnt", async () => {
  bodies = [];
  queue = [
    withTools("Moment.", toolCall(CONSULT, { question: QUESTION })),
    textOnly("Ich notiere das."),
  ];
  const call = armCall("call_alp14_inbound");
  await claude.agentTurn(call, SUBSTANTIAL);
  assert.ok(!sentToolNames().includes(CONSULT), "inbound darf das Werkzeug nicht sehen");
  assert.equal(store.getCall("call_alp14_inbound").consults, null, "kein Consult-Datensatz");
  const toolResult = bodies[1].messages.at(-1).content[0];
  assert.equal(toolResult.content, LOCALES.de.prompt.turnControl.consultDeclined);
});

test("AL-P14-3: ohne jeden Client-Poll fehlt das Werkzeug", async () => {
  bodies = [];
  queue = [textOnly("Alles klar.")];
  const call = store.getCall("call_alp14_3");
  call.consultPolledAtMs = 0;
  await claude.agentTurn(call, SUBSTANTIAL);
  assert.ok(!sentToolNames().includes(CONSULT));
});

test("AL-P14-4: ein zu alter Poll zaehlt nicht mehr", async () => {
  bodies = [];
  queue = [textOnly("Alles klar.")];
  const call = armCall("call_alp14_4");
  call.consultPolledAtMs = Date.now() - inCall.CONSULT_POLL_FRESH_MS - 1;
  await claude.agentTurn(call, SUBSTANTIAL);
  assert.ok(!sentToolNames().includes(CONSULT));
});

test("AL-P14-5: allowConsult=false im Profil schliesst das Werkzeug aus (AL-P13-Gate greift durch)", async () => {
  bodies = [];
  queue = [textOnly("Alles klar.")];
  const call = armCall("call_alp14_5");
  const foreign = "tenant_ohne_recht"; // DEFAULT_PROFILE -> allowConsult=false
  const originalTenant = call.tenantId;
  call.tenantId = foreign;
  try {
    await claude.agentTurn(call, SUBSTANTIAL);
  } finally {
    call.tenantId = originalTenant;
  }
  assert.ok(!sentToolNames().includes(CONSULT));
});

test("AL-P14-6: ohne erfuellte Bedingung geht der Werkzeugsatz BYTE-IDENTISCH zum Bestand raus", async () => {
  // In-Process ist der config-Snapshot fix (ein Prozess, ein Snapshot) - der AUS-Pfad
  // wird deshalb ueber eine andere nicht erfuellte Bedingung erreicht. Der Zweig ist
  // derselbe: agentTools liefert dann UNVERAENDERT toolDefs.
  bodies = [];
  queue = [textOnly("Alles klar.")];
  const call = store.getCall("call_alp14_6");
  call.consultPolledAtMs = 0;
  assert.equal(inCall.consultAvailableFor(call), false);
  await claude.agentTurn(call, SUBSTANTIAL);
  // Erwartung = Bestands-toolDefs in Anthropic-Draht-Form mit dem cache_control-Marker
  // am LETZTEN Eintrag (L3).
  const expected = anthropicToolsOnWire(claude.toolDefs("de"));
  assert.equal(JSON.stringify(bodies[0].tools), JSON.stringify(expected));
});

// ---------- B: Ausfuehrung ----------

test("AL-P14-7: Annahme erzeugt EINEN offenen Consult und spricht den Fueller nach einem Roundtrip", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = armCall("call_alp14_7");
  const turn = await claude.agentTurn(call, SUBSTANTIAL);
  assert.equal(bodies.length, 1, "genau ein llm.complete-Aufruf");
  assert.equal(turn.roundtrips, 1);
  assert.equal(turn.endCall, false);
  assert.equal(turn.speech, LOCALES.de.consultFillerSpeech);
  const consults = store.getCall("call_alp14_7").consults;
  assert.equal(consults.length, 1);
  assert.equal(consults[0].status, defaults.CONSULT_STATUS.OPEN);
  assert.deepEqual(consults[0].questions, [QUESTION]);
});

test("AL-P14-8: Fueller und Halte-Satz ueberleben shapeForSpeech unveraendert", () => {
  for (const lang of ["de", "fr", "en"]) {
    assert.equal(
      speechShape.shapeForSpeech(LOCALES[lang].consultFillerSpeech),
      LOCALES[lang].consultFillerSpeech,
      `${lang}: consultFillerSpeech wird umformatiert`,
    );
    assert.equal(
      speechShape.shapeForSpeech(LOCALES[lang].consultHoldSpeech),
      LOCALES[lang].consultHoldSpeech,
      `${lang}: consultHoldSpeech wird umformatiert`,
    );
  }
});

test("AL-P14-9: das Kontingent ist 1 - die zweite Rueckfrage desselben Calls wird abgelehnt", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = armCall("call_alp14_9");
  await claude.agentTurn(call, SUBSTANTIAL);
  assert.equal(store.getCall("call_alp14_9").consults.length, 1);
  // Antwort einspeisen, damit der offene Consult nicht den Halte-Turn ausloest.
  inCall.acceptConsultAnswer(call, { eventId: "c0", facts: ["Freitag geht auch"] });
  bodies = [];
  queue = [
    withTools("", toolCall(CONSULT, { question: "Und darf es auch spaeter sein?" })),
    textOnly("Ich entscheide das selbst."),
  ];
  const turn = await claude.agentTurn(call, "Und wie ist es am Freitag?");
  assert.equal(store.getCall("call_alp14_9").consults.length, 1, "kein zweiter Datensatz");
  assert.equal(turn.speech, "Ich entscheide das selbst.");
});

test("AL-P14-10: die Zeitfenster-Regel lehnt deterministisch ab, der Turn friert NICHT ein", async () => {
  bodies = [];
  queue = [
    withTools("", toolCall(CONSULT, { question: QUESTION })),
    textOnly("Dann machen wir es so."),
  ];
  const call = armCall("call_alp14_10");
  // Anker so setzen, dass die laufende Abrechnungsminute fast voll ist.
  call.answeredAt = new Date(Date.now() - 59_000).toISOString();
  const turn = await claude.agentTurn(call, SUBSTANTIAL);
  assert.equal(store.getCall("call_alp14_10").consults, null, "kein Datensatz");
  const toolResult = bodies[1].messages.at(-1).content[0];
  assert.equal(toolResult.content, LOCALES.de.prompt.turnControl.consultDeclined);
  assert.equal(turn.speech, "Dann machen wir es so.");
});

test("AL-P14-11: end_call in derselben Runde schlaegt die Rueckfrage, der end_call-Zweig bleibt unveraendert", async () => {
  bodies = [];
  queue = [
    withTools(
      "Danke, bis dann.",
      toolCall(CONSULT, { question: QUESTION }, "tuA"),
      toolCall("end_call", {}, "tuB"),
    ),
  ];
  const call = armCall("call_alp14_11");
  const turn = await claude.agentTurn(call, SUBSTANTIAL);
  assert.equal(turn.endCall, true);
  assert.equal(store.getCall("call_alp14_11").consults, null, "kein Datensatz");
});

test("AL-P14-11b: ein take_message derselben Runde geht NICHT verloren - die Rueckfrage weicht", async () => {
  // Ein angenommener Consult beendet den Turn sofort; jedes weitere Werkzeug der Runde
  // wuerde dabei verschluckt. Die Alleinstellungs-Regel verhindert genau diesen
  // stillen Datenverlust.
  bodies = [];
  queue = [
    withTools(
      "Ich notiere das.",
      toolCall(CONSULT, { question: QUESTION }, "tuA"),
      toolCall("take_message", { message: "Rueckruf gewuenscht" }, "tuB"),
    ),
    textOnly("Alles klar."),
  ];
  const call = armCall("call_alp14_8");
  await claude.agentTurn(call, SUBSTANTIAL);
  assert.equal(store.getCall("call_alp14_8").consults, null, "kein Consult-Datensatz");
  assert.equal(store.getCall("call_alp14_8").actionItemIds.length, 1, "Nachricht verloren");
});

test("AL-P14-12: execTool kennt get_consult NICHT (der zweite Riegel)", () => {
  const call = store.getCall("call_alp14_12");
  assert.equal(
    claude.execTool(call, CONSULT, { question: QUESTION }),
    LOCALES.de.prompt.turnControl.unknownTool,
  );
});

// ---------- C: Paraphrase-Riegel ----------

test("AL-P14-13: Anfuehrungszeichen und die zitierte Spanne werden entfernt", () => {
  const cleaned = question.sanitizeConsultQuestion(
    'Er sagt "wir haben nur noch Freitag frei" - passt das?',
    [],
  );
  assert.ok(cleaned);
  assert.ok(!/["'„“”«»‚‘’]/.test(cleaned), `Anfuehrungszeichen uebrig: ${cleaned}`);
  assert.ok(!cleaned.includes("nur noch Freitag frei"), `Zitat uebrig: ${cleaned}`);
});

test("AL-P14-14: eine woertlich wiederholte Wortfolge des Anrufers wird abgelehnt", () => {
  const transcript = [
    { role: "agent", text: "Wann haetten Sie denn Zeit?" },
    { role: "caller", text: "Wir haben diese Woche nur noch am Freitag einen Platz frei." },
  ];
  const verbatim = "Frage: wir haben diese Woche nur noch am Freitag einen Platz frei?";
  assert.equal(question.sanitizeConsultQuestion(verbatim, transcript), null);
  // Gegenprobe: dieselbe Sache in eigenen Worten passiert.
  assert.ok(question.sanitizeConsultQuestion("Ist Freitag akzeptabel?", transcript));
});

test("AL-P14-15: eine zu lange Frage wird an der Wortgrenze gekappt", () => {
  const long = `${"Wort ".repeat(80)}Ende`;
  const cleaned = question.sanitizeConsultQuestion(long, []);
  assert.ok(cleaned.length <= question.CONSULT_QUESTION_MAX_CHARS);
  assert.ok(!cleaned.endsWith("Wor"), "mitten im Wort gekappt");
  assert.ok(cleaned.endsWith("Wort"), `unerwartetes Ende: ${cleaned}`);
});

test("AL-P14-16: leere und nicht-String-Fragen werden abgelehnt", () => {
  for (const bad of ["", "   ", '""', null, undefined, 42, { question: "x" }]) {
    assert.equal(question.sanitizeConsultQuestion(bad, []), null, `nicht abgelehnt: ${bad}`);
  }
});

// ---------- D: Wartezeit, Fallback, Idle ----------

test("AL-P14-17: der erste Turn innerhalb der Frist spricht LLM-frei den Halte-Satz", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = armCall("call_alp14_17");
  await claude.agentTurn(call, SUBSTANTIAL);
  bodies = [];
  queue = [textOnly(UNWANTED_EXTRA_ROUNDTRIP_MARKER)];
  const turn = await claude.agentTurn(call, "Hallo?");
  assert.equal(bodies.length, 0, "kein llm.complete im Halte-Turn");
  assert.equal(turn.speech, LOCALES.de.consultHoldSpeech);
  assert.equal(turn.roundtrips, 0);
  assert.equal(store.getCall("call_alp14_17").consults[0].status, defaults.CONSULT_STATUS.OPEN);
});

test("AL-P14-18: der ZWEITE Turn innerhalb der Offen-Frist laesst die Rueckfrage LEBEN und traegt den Pending-Hinweis", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = armCall("call_alp14_18");
  await claude.agentTurn(call, SUBSTANTIAL);
  await claude.agentTurn(call, "Hallo?"); // HOLD
  bodies = [];
  queue = [textOnly("Dann nehme ich Freitag.")];
  const turn = await claude.agentTurn(call, "Sind Sie noch da?");
  assert.equal(bodies.length, 1, "normaler LLM-Turn");
  assert.equal(turn.speech, "Dann nehme ich Freitag.");
  assert.equal(
    store.getCall("call_alp14_18").consults[0].status,
    defaults.CONSULT_STATUS.OPEN,
    "die Rueckfrage lebt weiter, W2-Gegenbeweis",
  );
  const lastUser = bodies[0].messages.at(-1);
  assert.equal(lastUser.role, "user");
  assert.ok(
    lastUser.content.endsWith(LOCALES.de.prompt.turnControl.consultPending),
    `Pending-Hinweis fehlt: ${lastUser.content}`,
  );
});

test("AL-P14-19: nach Ablauf der Offen-Frist kommt der Fallback-Marker GENAU EINMAL", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = armCall("call_alp14_19");
  await claude.agentTurn(call, SUBSTANTIAL);
  // Frist kuenstlich ablaufen lassen, ohne zu warten (kein Sleep im Test, T9). answeredAt
  // wandert mit, sonst faellt der Consult aus der In-Call-Klassifikation (askedAt >= answeredAt).
  const askedAtMs = Date.now() - inCall.CONSULT_OPEN_MS - 1;
  const stored = store.getCall("call_alp14_19");
  stored.answeredAt = new Date(askedAtMs - 1000).toISOString();
  stored.consults[0].askedAt = new Date(askedAtMs).toISOString();
  bodies = [];
  queue = [textOnly("Freitag passt."), textOnly("Bis dann.")];
  await claude.agentTurn(call, "Und?");
  const marked = bodies[0].messages.at(-1).content;
  assert.ok(marked.includes(LOCALES.de.prompt.turnControl.consultTimeout));
  assert.equal(store.getCall("call_alp14_19").consults[0].status, defaults.CONSULT_STATUS.TIMED_OUT);
  bodies = [];
  await claude.agentTurn(call, "Noch etwas?");
  const after = bodies[0].messages.at(-1).content;
  assert.ok(
    !after.includes(LOCALES.de.prompt.turnControl.consultTimeout),
    `Marker ein zweites Mal: ${after}`,
  );
});

test("AL-P14-20: eine eingetroffene Antwort erzeugt weder Halte-Turn noch Fallback und steht im HINTERGRUND", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = armCall("call_alp14_20");
  await claude.agentTurn(call, SUBSTANTIAL);
  inCall.acceptConsultAnswer(call, { eventId: "c0", facts: ["Freitag ist in Ordnung"] });
  bodies = [];
  queue = [textOnly("Dann nehmen wir Freitag.")];
  const turn = await claude.agentTurn(call, "Und?");
  assert.equal(turn.speech, "Dann nehmen wir Freitag.");
  assert.ok(
    !bodies[0].messages.at(-1).content.includes(LOCALES.de.prompt.turnControl.consultTimeout),
  );
  assert.match(claude.systemPrompt(store.getCall("call_alp14_20")), /Freitag ist in Ordnung/);
});

test("AL-P14-21: ohne jede Antwort laeuft der Call ueber drei Turns normal weiter", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = armCall("call_alp14_21");
  const first = await claude.agentTurn(call, SUBSTANTIAL);
  assert.equal(first.endCall, false);
  assert.ok(first.speech);
  for (const line of ["Hallo?", "Sind Sie noch da?", "Also?"]) {
    bodies = [];
    queue = [textOnly("Ich melde mich gleich.")];
    const turn = await claude.agentTurn(call, line);
    assert.equal(turn.endCall, false, `${line}: Call wurde beendet`);
    assert.ok(turn.speech, `${line}: stummer Turn`);
  }
  assert.equal(store.getCall("call_alp14_21").status, "active");
});

test("AL-P14-22: eine erschoepfte Budget-Achse schlaegt den Halte-Satz (Regel 1 hat Vorrang)", async () => {
  bodies = [];
  queue = [withTools("", toolCall(CONSULT, { question: QUESTION }))];
  const call = armCall("call_alp14_22");
  await claude.agentTurn(call, SUBSTANTIAL);
  // Tenant-Kostendecke auf den bereits gebuchten Verbrauch setzen (>= sperrt) ->
  // roundStopReason greift VOR dem Halte-Ausstieg.
  const capCents = store.usageOf(BOOTSTRAP_TENANT_ID).costCents;
  store.setTenantBudget(BOOTSTRAP_TENANT_ID, { budgetCents: capCents, hardCapCents: capCents });
  bodies = [];
  queue = [textOnly(UNWANTED_EXTRA_ROUNDTRIP_MARKER)];
  const turn = await claude.agentTurn(call, "Hallo?");
  assert.equal(bodies.length, 0, "kein llm.complete bei erschoepfter Achse");
  assert.ok(turn.stopReason, "stopReason fehlt");
  assert.notEqual(turn.speech, LOCALES.de.consultHoldSpeech, "Halte-Satz trotz Geld-Stopp");
});

// ---------- E: reine Einheiten ----------

test("AL-P14-23: isInCallConsult unterscheidet Consult #0 von der Rueckfrage im Gespraech", () => {
  const answeredAt = "2026-07-31T10:00:05.000Z";
  const call = { answeredAt };
  assert.equal(ops.isInCallConsult(call, { askedAt: "2026-07-31T10:00:00.000Z" }), false);
  assert.equal(ops.isInCallConsult(call, { askedAt: answeredAt }), true);
  assert.equal(ops.isInCallConsult(call, { askedAt: "2026-07-31T10:00:30.000Z" }), true);
  assert.equal(
    ops.isInCallConsult({ answeredAt: null }, { askedAt: "2026-07-31T10:00:30.000Z" }),
    false,
  );
});

test("AL-P14-24: consultFitsBillingMinute haelt nur, wenn die Frist in die laufende Minute passt", () => {
  const nowMs = Date.parse("2026-07-31T10:00:00.000Z");
  const at = (offsetMs) => ({ answeredAt: new Date(nowMs - offsetMs).toISOString() });
  assert.equal(inCall.consultFitsBillingMinute(at(1000), nowMs), true);
  assert.equal(inCall.consultFitsBillingMinute(at(59_000), nowMs), false);
  assert.equal(inCall.consultFitsBillingMinute({ answeredAt: null, startedAt: null }, nowMs), false);
  // Uhr-Ruecksprung: der Anker liegt in der Zukunft -> fail-closed.
  assert.equal(inCall.consultFitsBillingMinute(at(-5000), nowMs), false);
});
