// Unit-Tests fuer die Call-Control-Zustandsmaschine (PLAN-TELNYX-AI-ASSISTANT.md, P4.5):
// makeCallControlIngest mit injizierten Fakes/Spies (kein Netz, kein Server-Spawn,
// F.I.R.S.T.). Deckt Checks 4/5/6 aus tasks/telnyx-p4_5-spec.md: Reihenfolge
// (answered->speak, NIE startAssistant vorher; speak.ended->startAssistant), Disclosure-
// Text-Bindung, Idempotenz-Beitrag der Maschine (zweites hangup -> kein zweites
// endCallRecord), unbekannter callId/Event -> keine Wirkung, kein Crash. Muster fuer
// Fake-Store/Spies vgl. telnyx-llm-shim.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallControlIngest } from "../src/telnyx-call-control-ingest.js";

// Fake-Store: haelt GENAU einen Call (oder keinen), zeichnet markAnswered/endCallRecord
// auf und spiegelt deren Effekt auf das Fixture-Objekt (wie state-ops.js: dieselbe
// Referenz wird mutiert, store.getCall liefert danach den mutierten Stand).
function fakeStore(call) {
  const markAnsweredCalls = [];
  const endCallRecordCalls = [];
  return {
    markAnsweredCalls,
    endCallRecordCalls,
    getCall(id) {
      return call && call.id === id ? call : null;
    },
    markAnswered(id) {
      markAnsweredCalls.push(id);
    },
    endCallRecord(id, status) {
      endCallRecordCalls.push({ id, status });
      if (call && call.id === id) call.status = status;
    },
  };
}

function fakeRes() {
  return {
    statusSent: null,
    sendStatus(code) {
      this.statusSent = code;
      return this;
    },
  };
}

// Spy-VoiceControl: zeichnet speak/startAssistant-Aufrufe auf, ignoriert den provider-
// Parameter nicht (Assert im Aufrufer moeglich), liefert resolvte No-ops.
function fakeVoiceControl() {
  const speakCalls = [];
  const startAssistantCalls = [];
  const providerCalls = [];
  const voiceControl = (provider) => {
    providerCalls.push(provider);
    return {
      async speak(p) {
        speakCalls.push(p);
      },
      async startAssistant(p) {
        startAssistantCalls.push(p);
      },
    };
  };
  return { voiceControl, speakCalls, startAssistantCalls, providerCalls };
}

function answeredBody(callControlId) {
  return { data: { event_type: "call.answered", payload: { call_control_id: callControlId } } };
}
function speakEndedBody(callControlId) {
  return { data: { event_type: "call.speak.ended", payload: { call_control_id: callControlId } } };
}
function speakFailedBody(callControlId) {
  return { data: { event_type: "call.speak.ended", payload: { call_control_id: callControlId, status: "failed" } } };
}
function hangupBody(callControlId) {
  return { data: { event_type: "call.hangup", payload: { call_control_id: callControlId } } };
}

const DISCLOSURE_TEXT = "Guten Tag, hier spricht der KI-Assistent von Jonas Beispiel.";

// OBS-2: console.log+warn fuer die Dauer eines async-Callbacks abfangen (orig sichern,
// ersetzen, im finally restaurieren - F.I.R.S.T., Reihenfolge-unabhaengig). Liefert die Zeilen.
async function captureConsole(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(a.map(String).join(" "));
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return lines;
}

test("answered: Disclosure-Speak gefeuert (Text=disclosureSentence, voiceProfile aus localeFor), startAssistant NICHT (Reihenfolge), markAnswered gerufen", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: answeredBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.deepEqual(vc.providerCalls, ["telnyx"]);
  assert.equal(vc.speakCalls.length, 1);
  assert.deepEqual(vc.speakCalls[0], {
    callControlId: "cc_1",
    text: DISCLOSURE_TEXT,
    voiceProfile: "de_female_neural",
  });
  assert.equal(vc.startAssistantCalls.length, 0, "ai_assistant_start NIE auf answered direkt");
  assert.deepEqual(store.markAnsweredCalls, ["call_1"]);
  assert.equal(finishCallCalls.length, 0);
});

test("speak.ended MIT call.assistantId -> startAssistant gefeuert mit callControlId+assistantId", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0, "speak.ended loest kein erneutes Speak aus");
  assert.equal(vc.startAssistantCalls.length, 1);
  assert.deepEqual(vc.startAssistantCalls[0], { callControlId: "cc_1", assistantId: "asst_77" });
});

test("speak.ended OHNE call.assistantId -> fail-safe skip, kein startAssistant, kein Crash", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" }; // keine assistantId
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakEndedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.startAssistantCalls.length, 0);
});

// Regressionstest (Regel 2): eine fehlgeschlagene Offenlegung (Azure-NTTS-Stoerung,
// payload.status="failed") darf ai_assistant_start NIE ausloesen - selbst wenn
// call.assistantId GESETZT ist. Ohne diesen Fix haette die Zustandsmaschine hier
// startAssistant gefeuert, obwohl die Pflicht-Offenlegung nie zu hoeren war.
test("speak.ended MIT status='failed' UND gesetzter assistantId -> startAssistant bleibt aus (fail-safe skip)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_1" }, body: speakFailedBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.startAssistantCalls.length, 0, "kein Assistant-Start ohne gehoerte Offenlegung");
});

test("hangup: finishCall gerufen, endCallRecord nur bei status active; zweites hangup NICHT erneut endCallRecord (Idempotenz-Beitrag der Maschine)", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });

  const res1 = fakeRes();
  await handler({ query: { callId: "call_1" }, body: hangupBody("cc_1") }, res1);
  assert.equal(res1.statusSent, 200);
  assert.equal(store.endCallRecordCalls.length, 1);
  assert.deepEqual(store.endCallRecordCalls[0], { id: "call_1", status: "completed" });
  assert.equal(finishCallCalls.length, 1);
  assert.equal(finishCallCalls[0], call, "finishCall bekommt die frisch geholte Call-Referenz");
  assert.equal(call.status, "completed", "Maschine flippt den Status VOR finishCall (Muster /voice/status)");

  const res2 = fakeRes();
  await handler({ query: { callId: "call_1" }, body: hangupBody("cc_1") }, res2);
  assert.equal(res2.statusSent, 200);
  assert.equal(store.endCallRecordCalls.length, 1, "kein zweites endCallRecord (status nicht mehr active)");
  assert.equal(finishCallCalls.length, 2, "finishCall wird erneut gerufen, dessen EIGENE billedAt-Idempotenz greift (route-Test)");
});

test("unbekannter callId -> 200 ohne Wirkung, kein Crash", async () => {
  const store = fakeStore(null);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  await handler({ query: { callId: "call_unknown" }, body: hangupBody("cc_1") }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  assert.equal(finishCallCalls.length, 0);
  assert.equal(store.endCallRecordCalls.length, 0);
});

test("unbekanntes Event (z.B. call.speak.started) -> 200 ohne Wirkung, kein Crash", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const finishCallCalls = [];
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async (c) => finishCallCalls.push(c),
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const res = fakeRes();
  const body = { data: { event_type: "call.speak.started", payload: { call_control_id: "cc_1" } } };
  await handler({ query: { callId: "call_1" }, body }, res);

  assert.equal(res.statusSent, 200);
  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  assert.equal(finishCallCalls.length, 0);
});

// OBS-2 Test 1 (DoD-Kern, Anti-Klemme): call.speak.ended mit status="succeeded" (NICHT
// "completed") klassifiziert trotzdem zu SPEAK_ENDED (siehe call-control-events.js: der
// Status wird fuer die Ended-Klassifikation nicht geprueft) und feuert startAssistant. Der
// Roh-Log darf den echten Status NICHT auf eine completed/failed-Allowlist klemmen - sonst
// verschluckt die Beobachtung genau den Token, den P1a-FIX braucht.
test("OBS-2: call.speak.ended mit status=succeeded -> Roh-Log zeigt event_type+status UNGEKLEMMT", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const body = {
    data: { event_type: "call.speak.ended", payload: { call_control_id: "cc_1", status: "succeeded" } },
  };
  const lines = await captureConsole(() => handler({ query: { callId: "call_1" }, body }, fakeRes()));

  assert.equal(vc.startAssistantCalls.length, 1, "SPEAK_ENDED klassifiziert trotz Nicht-completed-Status");
  const rawLine = lines.find((l) => l.includes("event empfangen"));
  assert.ok(rawLine, "Roh-Log-Zeile fehlt");
  assert.match(rawLine, /event_type=call\.speak\.ended/);
  assert.match(rawLine, /status=succeeded/);
});

// OBS-2 Test 2: unbekanntes Event (call.playback.ended) -> Roh-Log zeigt den echten
// event_type+status, keine Aktion wird ausgeloest (byte-identisches Klassifikationsverhalten).
test("OBS-2: unbekanntes Event call.playback.ended -> Roh-Log zeigt Token, keine Aktion", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const body = {
    data: { event_type: "call.playback.ended", payload: { call_control_id: "cc_1", status: "finished" } },
  };
  const lines = await captureConsole(() => handler({ query: { callId: "call_1" }, body }, fakeRes()));

  assert.equal(vc.speakCalls.length, 0);
  assert.equal(vc.startAssistantCalls.length, 0);
  const rawLine = lines.find((l) => l.includes("event empfangen"));
  assert.ok(rawLine, "Roh-Log-Zeile fehlt");
  assert.match(rawLine, /event_type=call\.playback\.ended/);
  assert.match(rawLine, /status=finished/);
});

// OBS-2 Test 3 (unknown_call, PII): der rohe (Caller-kontrollierte) Query-Wert darf NIE
// im Log landen (Regel 4) - nur der Grund-Token. Genau eine Zeile (kein zusaetzlicher
// Roh-Log, da der Dispatch bei unbekanntem callId vorher returnt).
test("OBS-2: unbekannter callId -> Log traegt reason=unknown_call, NIE den rohen Query-Wert", async () => {
  const store = fakeStore(null);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const leakyCallId = "callId_leaky_9999";
  const lines = await captureConsole(() =>
    handler({ query: { callId: leakyCallId }, body: hangupBody("cc_1") }, fakeRes()),
  );

  assert.equal(lines.length, 1, "genau eine Log-Zeile bei unbekanntem callId");
  assert.match(lines[0], /reason=unknown_call/);
  assert.ok(!lines[0].includes(leakyCallId), "roher Query-Wert darf NICHT im Log stehen");
});

// OBS-2 Test 4 (Kette + PII): answered -> speak.ended -> hangup erzeugt drei Erfolgs-Logs
// mit der internen call.id; die ccid ("cc_secret") darf in KEINER Ingest-Log-Zeile stehen
// (Regel 4 - Ingest-Logs tragen call.id, nicht die ccid).
test("OBS-2: answered->speak.ended->hangup -> drei Erfolgs-Logs, ccid-Wert nirgends geloggt", async () => {
  const call = { id: "call_1", status: "active", provider: "telnyx", language: "de", assistantId: "asst_77" };
  const store = fakeStore(call);
  const vc = fakeVoiceControl();
  const handler = makeCallControlIngest({
    store,
    voiceControl: vc.voiceControl,
    finishCall: async () => {},
    disclosureSentence: () => DISCLOSURE_TEXT,
    localeFor: () => ({ voiceProfile: "de_female_neural" }),
  });
  const ccid = "cc_secret";
  const lines = await captureConsole(async () => {
    await handler({ query: { callId: "call_1" }, body: answeredBody(ccid) }, fakeRes());
    await handler({ query: { callId: "call_1" }, body: speakEndedBody(ccid) }, fakeRes());
    await handler({ query: { callId: "call_1" }, body: hangupBody(ccid) }, fakeRes());
  });

  assert.ok(lines.some((l) => l.includes("answered (call=call_1) -> Disclosure-Speak")));
  assert.ok(lines.some((l) => l.includes("speak.ended (call=call_1) -> ai_assistant_start")));
  assert.ok(lines.some((l) => l.includes("hangup (call=call_1) -> Settlement")));
  assert.ok(!lines.some((l) => l.includes(ccid)), "ccid-Wert darf in keiner Ingest-Log-Zeile stehen");
});
