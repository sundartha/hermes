// Unit-Tests fuer den Telnyx Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, Phase P1;
// Auth-Rework Phase telnyx-fix-live-schema-auth): reine Fake-basierte Tests (kein
// Netz/Spawn) gegen makeTelnyxLlmShim. Deckt die Invarianten C1-C4 + Empty-Secret-
// Trap + Korrelation (E1) + D8 (Fehler-Durchreichung) ab. Muster fuer fakeRes vgl.
// request-tenant-unit.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTelnyxLlmShim, callControlIdFromForwardedMetadata } from "../src/telnyx-llm-shim.js";
import { localeFor } from "../src/i18n/locales.js";
import { LlmUnavailableError } from "../src/llm.js";
import { fakeTelnyxShimConfig } from "./helpers.js";

const SSE_DATA_PREFIX = "data: ";
const VALID_AUTH = "Bearer shim-secret"; // matcht fakeTelnyxShimConfig()-Default

// Minimaler Express-res-Fake: erfasst Status, gesetzte Header, geschriebene SSE-
// Chunks und einen etwaigen JSON-Fehler-Body. headersSent kippt erst bei einem
// tatsaechlichen Schreibvorgang (write/end/json) - wie im echten Express.
function fakeRes() {
  return {
    statusCode: null,
    headers: {},
    chunks: [],
    body: null,
    ended: false,
    headersSent: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    write(s) {
      this.headersSent = true;
      this.chunks.push(s);
    },
    end() {
      this.headersSent = true;
      this.ended = true;
      return this;
    },
    json(b) {
      this.headersSent = true;
      this.body = b;
      return this;
    },
  };
}

// Fake-Store: nur die vom Shim genutzten Fassaden-Funktionen. getCallByControlId matcht
// NUR den per callControlId adressierte Call (sonst null) - so beweisen Tests, dass eine
// unbekannte/fremde ccid NICHT zufaellig auf den geseedeten Call trifft. getCall wird vom
// Budget-Kill-Pfad (terminateViaCallControl-Fresh-Fetch) gebraucht, auch wenn diese Tests
// selbst keinen voiceControl-Hangup-Pfad injizieren (der Fresh-Fetch laeuft trotzdem).
function fakeStore({ call = null, budgetExceeded = false, globalBudgetExceeded = false } = {}) {
  const getCallByControlIdCalls = [];
  return {
    getCallByControlIdCalls,
    getCallByControlId(ccid) {
      getCallByControlIdCalls.push(ccid);
      return call && call.callControlId === ccid ? call : null;
    },
    getCall(id) {
      return call && call.id === id ? call : null;
    },
    budgetExceeded() {
      return budgetExceeded;
    },
    globalBudgetExceeded() {
      return globalBudgetExceeded;
    },
  };
}

// Spy-agentTurn: zaehlt Aufrufe, merkt sich (call, callerText), liefert ein
// fest verdrahtetes { speech, endCall }-Ergebnis (Default = happy path).
function agentTurnSpy(result = { speech: "Hallo Welt", endCall: false }) {
  const calls = [];
  async function agentTurn(call, callerText) {
    calls.push({ call, callerText });
    return result;
  }
  agentTurn.calls = calls;
  return agentTurn;
}

// Minimaler Call-Fixture: callControlId ist der Korrelations-Schluessel (E1), status
// muss 'active' sein. tenantId/language decken die von agentTurn/localeFor gelesenen
// Felder ab.
function makeCall(overrides = {}) {
  return {
    id: "call_x",
    tenantId: "t_test",
    language: "de",
    callControlId: "cc_x",
    status: "active",
    ...overrides,
  };
}

// No-op-VoiceControl-Stub: dieser Testfile deckt den Hangup-Pfad selbst NICHT ab
// (das macht telnyx-shim-harness.js / telnyx-p6-midcall-budget-kill.test.js mit einem
// echten Spy) - der Budget-Kill-Zweig ruft terminateViaCallControl trotzdem auf, sobald
// der Call eine callControlId traegt, darum braucht jeder Handler hier eine erreichbare
// (aber unbeobachtete) Implementierung.
function noopVoiceControl() {
  return { endCallViaCallControl: async () => {} };
}

// Baut Request + Handler in einem Rutsch (Build-Schritt, P13) - reduziert die
// Wiederholung ueber die Test-Tabelle.
function makeHandler({
  store,
  config = fakeTelnyxShimConfig(),
  agentTurn = agentTurnSpy(),
  localeFor: lf = localeFor,
  metrics,
  voiceControl = noopVoiceControl,
} = {}) {
  const args = { store, config, agentTurn, localeFor: lf, voiceControl };
  if (metrics !== undefined) args.metrics = metrics;
  return makeTelnyxLlmShim(args);
}

// Spy-metrics (P10): erfasst nur logShimTurn-Aufrufe (die einzige vom Shim genutzte
// Metrik-Funktion). Die anderen drei bleiben No-op-Stubs, damit ein injizierter Spy
// als Drop-in fuer den echten metrics-Singleton dient.
function metricsSpy() {
  const shimTurnCalls = [];
  return {
    shimTurnCalls,
    logShimTurn: (payload) => shimTurnCalls.push(payload),
    llmCall() {},
    logTurn() {},
    recordTurnRendered() {},
    logTurnGap() {},
  };
}

// reqWith: baut Headers + Body in einem Rutsch. ccid (falls uebergeben) landet unter
// body.extra_metadata.call_control_id (E1, P2-bestaetigt) - EINE Konstruktionsstelle
// statt an jeder Teststelle wiederholt.
function reqWith({ auth, ccid, body = {} } = {}) {
  const headers = {};
  if (auth !== undefined) headers.authorization = auth;
  const fullBody = ccid !== undefined ? { ...body, extra_metadata: { call_control_id: ccid } } : body;
  return { headers, body: fullBody };
}

function firstChunkJson(res) {
  return JSON.parse(res.chunks[0].slice(SSE_DATA_PREFIX.length).trim());
}

// === callControlIdFromForwardedMetadata: extra_metadata Single-Trusted-Source =====
// P1b-FIX: die ccid steht LIVE unter body.extra_metadata.call_control_id (P2-bestaetigt,
// call_mrgj8trkypk8). Kein metadata- und kein spoofbarer Top-Level-Fallback mehr
// (Anti-Spoofing). Direkt gegen die exportierte Funktion, ohne Handler-Umweg.

test("callControlId: extra_metadata.call_control_id gesetzt -> liefert ihn", () => {
  const result = callControlIdFromForwardedMetadata({ extra_metadata: { call_control_id: "cc_x" } });
  assert.equal(result, "cc_x");
});

test("callControlId: extra_metadata fehlt -> null", () => {
  const result = callControlIdFromForwardedMetadata({ messages: [] });
  assert.equal(result, null);
});

test("callControlId: extra_metadata vorhanden, aber ohne call_control_id -> null", () => {
  const result = callControlIdFromForwardedMetadata({ extra_metadata: { customer_name: "Max" } });
  assert.equal(result, null);
});

test("callControlId: extra_metadata ist kein Objekt (z.B. String) -> null", () => {
  const result = callControlIdFromForwardedMetadata({ extra_metadata: "kaputt" });
  assert.equal(result, null);
});

test("Anti-Spoof: nur Top-Level body.call_control_id (kein extra_metadata) -> null, kein spoofbarer Fallback", () => {
  const result = callControlIdFromForwardedMetadata({ call_control_id: "cc_top" });
  assert.equal(result, null);
});

test("Alt-Feld tot: nur body.metadata.call_control_id (Legacy-Position) -> null, wird nicht mehr gelesen", () => {
  const result = callControlIdFromForwardedMetadata({ metadata: { call_control_id: "cc_meta" } });
  assert.equal(result, null);
});

test("callControlId: null/{} -> null (fail-closed)", () => {
  assert.equal(callControlIdFromForwardedMetadata({}), null);
  assert.equal(callControlIdFromForwardedMetadata(null), null);
});

// === C1: Flag aus -> 404 =========================================================

test("C1: Flag aus -> 404, kein agentTurn-Aufruf, kein Store-Zugriff", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, config: fakeTelnyxShimConfig({ enabled: false }), agentTurn });
  const res = fakeRes();

  await handler(reqWith(), res);

  assert.equal(res.statusCode, 404);
  assert.equal(agentTurn.calls.length, 0);
  assert.deepEqual(store.getCallByControlIdCalls, [], "Flag-aus-Pfad darf store.getCallByControlId nie aufrufen");
});

// === Auth: kein/falscher Bearer -> 403 ===========================================

test("C2a: Flag an, kein Authorization-Header -> 403, kein agentTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ ccid: "cc_x" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

test("C2c: falsches Bearer-Secret -> 403 (safeEqual false), kein agentTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer falsches-secret", ccid: "cc_x" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

// === Empty-Secret-Trap: leeres config-Secret darf NIE autorisieren ===============

test("Empty-Secret-Trap: config.telnyxShimSharedSecret=\"\" + Bearer \"\" -> 403 (safeEqual(\"\",\"\")===true waere sonst die Falle)", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const config = fakeTelnyxShimConfig({ telnyxShimSharedSecret: "" });
  const handler = makeHandler({ store, config, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer ", ccid: "cc_x" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

// === Korrelation (E1): ccid fehlt/unbekannt/inaktiv -> 403 =======================

test("Korrelation: ccid fehlt im Body -> 403, kein agentTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

test("Korrelation: ccid vorhanden, aber getCallByControlId findet keinen Call -> 403", async () => {
  const store = fakeStore({ call: null });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_unbekannt" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

test("Korrelation: ccid vorhanden, Call status!=='active' -> 403 (aufgelegter Call darf keinen Turn mehr ausloesen)", async () => {
  const store = fakeStore({ call: makeCall({ status: "completed" }) });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

// === C3: gueltiger Bearer + ccid -> OpenAI-Fake-Stream-Shape =====================

test("C3: gueltiger Bearer + ccid -> agentTurn 1x mit dem ccid-gebundenen Call, Fake-Stream-Shape", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Hallo Welt", endCall: false });
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(
    reqWith({
      auth: VALID_AUTH,
      ccid: "cc_x",
      body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "Hallo" }] },
    }),
    res,
  );

  assert.equal(agentTurn.calls.length, 1);
  assert.equal(agentTurn.calls[0].call, call, "agentTurn bekommt die lebende Store-Referenz");
  assert.equal(agentTurn.calls[0].callerText, "Hallo");

  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(res.chunks.length, 2, "genau EIN SSE-Chunk + data: [DONE]");
  const chunk = firstChunkJson(res);
  assert.equal(chunk.object, "chat.completion.chunk");
  assert.equal(chunk.model, "gpt-4o-mini");
  assert.equal(chunk.choices[0].delta.content, "Hallo Welt");
  assert.equal(chunk.choices[0].finish_reason, "stop");
  assert.equal(res.chunks[1], "data: [DONE]\n\n");
  assert.equal(res.ended, true);
  assert.ok(!res.chunks.join("").includes("shim-secret"), "kein Secret im SSE-Body");
});

test("C3b: kein req.body.model -> Fallback auf config.claudeModel", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig({ claudeModel: "claude-haiku-4-5" }),
    agentTurn,
  });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.equal(firstChunkJson(res).model, "claude-haiku-4-5");
});

test("Realer Body-Shape (P2-bestaetigt): extra_metadata unter den echten bodyKeys -> Korrelation greift end-to-end", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Hallo Welt", endCall: false });
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(
    reqWith({
      auth: VALID_AUTH,
      body: {
        messages: [{ role: "user", content: "Hallo?" }],
        model: "gpt-4o-mini",
        stream: true,
        stream_options: {},
        temperature: 0.7,
        extra_metadata: { call_control_id: "cc_x", customer_name: "Testkunde" },
      },
    }),
    res,
  );

  assert.equal(agentTurn.calls.length, 1);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(res.chunks.length, 2, "genau EIN SSE-Chunk + data: [DONE]");
  assert.equal(firstChunkJson(res).choices[0].delta.content, "Hallo Welt");
});

// === C4: Budget ueberschritten -> kein Token-Burn ================================

test("C4a: tenant-Budget ueberschritten -> Wind-Down-Completion, KEIN agentTurn-Aufruf", async () => {
  const store = fakeStore({ call: makeCall({ language: "de" }), budgetExceeded: true });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.equal(agentTurn.calls.length, 0, "kein Token-Burn bei ueberschrittenem Budget");
  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").budgetExhaustedHangup);
});

test("C4b: globaler Budget-Notaus ueberschritten -> Wind-Down-Completion, KEIN agentTurn-Aufruf", async () => {
  const store = fakeStore({ call: makeCall(), globalBudgetExceeded: true });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.equal(agentTurn.calls.length, 0);
  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").budgetExhaustedHangup);
});

// === Anti-Spoof: die ccid bindet den Call, NICHT der spoofbare Body-callId ========

test("Anti-Spoof: gespoofter callId/tenantId im Body wird ignoriert - die ccid bindet den Call", async () => {
  const callA = makeCall({ id: "call_A", tenantId: "t_A", callControlId: "cc_A" });
  const store = fakeStore({ call: callA });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(
    reqWith({
      auth: VALID_AUTH,
      ccid: "cc_A",
      body: {
        callId: "call_B", // gespoofter Body-Wert, MUSS ignoriert werden
        tenantId: "t_B",
        messages: [{ role: "user", content: "Ich bin der Angerufene" }],
      },
    }),
    res,
  );

  assert.equal(agentTurn.calls.length, 1);
  assert.equal(agentTurn.calls[0].call.id, "call_A", "ccid bindet den Call, nicht der Body");
  assert.equal(agentTurn.calls[0].call.tenantId, "t_A");
  assert.equal(agentTurn.calls[0].callerText, "Ich bin der Angerufene");
});

test("Anti-Spoof (Handler): passende Top-Level-ccid OHNE extra_metadata resolved NICHT -> 403, kein agentTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, body: { call_control_id: "cc_x" } }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0, "selbst eine passende Top-Level-ccid darf nicht resolven");
});

test("Alt-Feld tot (Handler): ccid nur unter body.metadata (Legacy-Position) -> 403, kein agentTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, body: { metadata: { call_control_id: "cc_x" } } }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0, "die Legacy-Position metadata resolved nicht mehr");
});

// === P5: per-callId-Rate-Limiter (Scope 4, Toll-/Token-Fraud-Bremse) =============

test("P5-Rate: N+1-ter Turn fuer denselben Call im Fenster -> Degradations-Completion OHNE agentTurn-Aufruf", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const config = fakeTelnyxShimConfig({ telnyxShimMaxTurnsPerMin: 2 });
  const handler = makeHandler({ store, config, agentTurn });

  for (let i = 1; i <= 2; i++) {
    const res = fakeRes();
    await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);
    assert.equal(agentTurn.calls.length, i, `Turn ${i} innerhalb des Limits ruft agentTurn`);
  }

  const res3 = fakeRes();
  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res3);
  assert.equal(agentTurn.calls.length, 2, "3. Turn (N+1) ruft agentTurn NICHT (kein Token-Burn)");
  assert.equal(
    firstChunkJson(res3).choices[0].delta.content,
    localeFor("de").llmDegradedSpeech,
    "gueltige Degradations-Completion statt roher Ablehnung",
  );
});

test("P5-Rate: zwei verschiedene Calls (ccids) teilen sich das Fenster NICHT", async () => {
  const callA = makeCall({ id: "call_A", callControlId: "cc_A" });
  const callB = makeCall({ id: "call_B", callControlId: "cc_B" });
  const store = {
    getCallByControlId: (ccid) => [callA, callB].find((c) => c.callControlId === ccid) || null,
    budgetExceeded: () => false,
    globalBudgetExceeded: () => false,
  };
  const agentTurn = agentTurnSpy();
  const config = fakeTelnyxShimConfig({ telnyxShimMaxTurnsPerMin: 1 });
  const handler = makeHandler({ store, config, agentTurn });

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_A" }), fakeRes());
  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_B" }), fakeRes());
  assert.equal(agentTurn.calls.length, 2, "call_A und call_B haben je einen eigenen Zaehler");
});

// === lastUserText: Grenzfaelle (G3/T5) ===========================================

test("lastUserText: kein messages-Array / kein user-Eintrag mit String-Content -> callerText \"\"", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x", body: {} }), res);

  assert.equal(agentTurn.calls[0].callerText, "");
});

// === D8-D11: agentTurn-Fehler -> wuerdevolle Degradation (P2) ====================

test("D8: agentTurn wirft generischen Error -> gueltige Completion mit turnErrorSpeech, KEIN 502", async () => {
  const store = fakeStore({ call: makeCall() });
  async function throwingAgentTurn() {
    throw new Error("llm kaputt");
  }
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.notEqual(res.statusCode, 502, "kein roher 5xx im Fehlerpfad");
  assert.equal(res.body, null, "kein JSON-Error-Body");
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(res.chunks.length, 2, "genau EIN SSE-Chunk + data: [DONE]");
  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").turnErrorSpeech);
  assert.equal(res.chunks[1], "data: [DONE]\n\n");
  assert.equal(res.ended, true);
});

test("D9: agentTurn wirft LlmUnavailableError -> gueltige Completion mit llmDegradedSpeech (nicht turnErrorSpeech)", async () => {
  const store = fakeStore({ call: makeCall() });
  async function throwingAgentTurn() {
    throw new LlmUnavailableError("circuit-open");
  }
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.notEqual(res.statusCode, 502);
  assert.equal(res.body, null);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(res.ended, true);
  const content = firstChunkJson(res).choices[0].delta.content;
  assert.equal(content, localeFor("de").llmDegradedSpeech);
  assert.notEqual(content, localeFor("de").turnErrorSpeech, "transiente Klasse != generischer Fehler");
});

test("D10: Degradations-Body enthaelt kein Secret - content ist exakt der Locale-String", async () => {
  const store = fakeStore({ call: makeCall() });
  async function throwingAgentTurn() {
    throw new LlmUnavailableError("retries-exhausted");
  }
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  const raw = res.chunks.join("");
  assert.ok(!raw.includes("shim-secret"), "kein Shared-Secret im Degradations-Body");
  assert.ok(!raw.includes("Bearer"), "kein Bearer-Anteil im Degradations-Body");
  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").llmDegradedSpeech);
});

test("D11: nicht-DE Sprache (en) -> englischer Degradations-String (localeFor(call.language) greift)", async () => {
  const store = fakeStore({ call: makeCall({ language: "en" }) });
  async function throwingAgentTurn() {
    throw new Error("boom");
  }
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("en").turnErrorSpeech);
});

// === T1: writeFakeStream wirft NACH einem Teil-Write (headersSent bereits true) ===

// Wie fakeRes(), aber der ZWEITE write()-Aufruf wirft (der erste - der eigentliche
// SSE-Chunk - schlaegt durch und kippt headersSent wie im echten Express). Bildet
// einen Socket nach, der mitten im Happy-Path-writeFakeStream wegbricht (zwischen
// dem Daten-Chunk und "data: [DONE]").
function fakeResFailingOnSecondWrite() {
  const res = fakeRes();
  const originalWrite = res.write.bind(res);
  let writeCalls = 0;
  res.write = (s) => {
    writeCalls += 1;
    if (writeCalls === 1) return originalWrite(s);
    throw new Error("socket kaputt");
  };
  return res;
}

test("T1: writeFakeStream wirft nach dem ersten Write -> Fehlerpfad ruft nur end() (kein zweiter Fake-Stream-Versuch)", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy({ speech: "Hallo Welt", endCall: false });
  const handler = makeHandler({ store, agentTurn });
  const res = fakeResFailingOnSecondWrite();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.equal(res.chunks.length, 1, "nur der erste (fehlgeschlagene) Chunk steht - kein Retry-Chunk");
  assert.equal(res.ended, true, "Fehlerpfad ruft end() statt erneut writeFakeStream aufzurufen");
});

// === P10: Shim-Turn-Latenz-Metrik (Observability, agentTurn-Wanduhr-Dauer) =========

test("P10-Metrik: erfolgreicher Turn -> genau 1 logShimTurn mit callId + numerischer latencyMs", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Hallo Welt", endCall: false });
  const metrics = metricsSpy();
  const handler = makeHandler({ store, agentTurn, metrics });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.equal(metrics.shimTurnCalls.length, 1);
  assert.equal(metrics.shimTurnCalls[0].callId, call.id);
  assert.equal(typeof metrics.shimTurnCalls[0].latencyMs, "number");
  assert.ok(metrics.shimTurnCalls[0].latencyMs >= 0);
});

test("P10-Metrik: Flag aus (404) -> agentTurn nie erreicht -> kein logShimTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const metrics = metricsSpy();
  const handler = makeHandler({
    store,
    config: fakeTelnyxShimConfig({ enabled: false }),
    agentTurn,
    metrics,
  });
  const res = fakeRes();

  await handler(reqWith(), res);

  assert.equal(res.statusCode, 404);
  assert.equal(metrics.shimTurnCalls.length, 0);
});

test("P10-Metrik: fehlende Korrelation (403) -> agentTurn nie erreicht -> kein logShimTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const metrics = metricsSpy();
  const handler = makeHandler({ store, agentTurn, metrics });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(metrics.shimTurnCalls.length, 0);
});

test("P10-Metrik: Budget-Gate ueberschritten -> agentTurn nie erreicht -> kein logShimTurn", async () => {
  const store = fakeStore({ call: makeCall(), budgetExceeded: true });
  const agentTurn = agentTurnSpy();
  const metrics = metricsSpy();
  const handler = makeHandler({ store, agentTurn, metrics });
  const res = fakeRes();

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);

  assert.equal(metrics.shimTurnCalls.length, 0);
});

test("D8b: Fehler-Log traegt NUR err.name, kein Secret", async () => {
  const store = fakeStore({ call: makeCall() });
  async function throwingAgentTurn() {
    throw new Error("llm kaputt");
  }
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn });
  const res = fakeRes();

  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try {
    await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res);
  } finally {
    console.error = originalError;
  }

  assert.ok(logged.some((l) => l.includes("[telnyx-shim]")));
  assert.ok(!logged.join("\n").includes("shim-secret"), "Log darf das Secret nie enthalten");
});

// === OBS-1: Observability Shim-Gates (unconditional, PII-freie Diagnose-Zeilen) ===
// Jede stumme 403-/Degradations-Flaeche im Shim hinterlaesst jetzt eine strukturierte
// Log-Zeile mit distinktem Grund-Token (reason), NUR Booleans/Zaehler/interne IDs/
// Feld-NAMEN - nie Header-/Secret-/Transkript-WERTE. Erfasst alle drei Console-Kanaele,
// restauriert immer (F.I.R.S.T.).
async function withConsoleCapture(run) {
  const lines = [];
  const orig = { warn: console.warn, log: console.log, error: console.error };
  const grab = (...a) => lines.push(a.map(String).join(" "));
  console.warn = grab;
  console.log = grab;
  console.error = grab;
  try {
    await run();
  } finally {
    Object.assign(console, orig);
  }
  return lines;
}

const GATE_LINE_MARKER = "[telnyx-shim] gate";
const TURN_OK_LINE_MARKER = "[telnyx-shim] turn_ok";
const gateLines = (lines) => lines.filter((l) => l.includes(GATE_LINE_MARKER));
const turnOkLines = (lines) => lines.filter((l) => l.includes(TURN_OK_LINE_MARKER));

test("OBS-1 auth: fehlender Header -> genau 1 gate reason=auth {hasHeader:false,secretConfigured:true}, weiter 403", async () => {
  const store = fakeStore({ call: makeCall() });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ ccid: "cc_x" }), res));

  assert.equal(res.statusCode, 403);
  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"auth"'));
  assert.ok(gates[0].includes('"hasHeader":false'));
  assert.ok(gates[0].includes('"secretConfigured":true'));
});

test("OBS-1 auth: falsches Secret -> gate reason=auth {hasHeader:true}, Secret-Wert NICHT im Log", async () => {
  const store = fakeStore({ call: makeCall() });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() =>
    handler(reqWith({ auth: "Bearer falsches-geheim-XYZ", ccid: "cc_x" }), res),
  );

  assert.equal(res.statusCode, 403);
  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"auth"'));
  assert.ok(gates[0].includes('"hasHeader":true'));
  const joined = lines.join("\n");
  assert.ok(!joined.includes("shim-secret"), "config-Default-Secret darf nie im Log auftauchen");
  assert.ok(!joined.includes("falsches-geheim-XYZ"), "gesendeter Bearer-Wert darf nie im Log auftauchen");
});

test("OBS-1 auth: leeres config-Secret -> gate {secretConfigured:false}", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimSharedSecret: "" });
  const handler = makeHandler({ store, config, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: "Bearer ", ccid: "cc_x" }), res));

  assert.equal(res.statusCode, 403);
  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"auth"'));
  assert.ok(gates[0].includes('"secretConfigured":false'));
});

test("OBS-1 no_ccid: gate reason=no_ccid traegt bodyKeys+metadataKeys, aber KEINE Werte", async () => {
  const store = fakeStore({ call: makeCall() });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() });
  const res = fakeRes();
  const body = {
    messages: [{ role: "user", content: "GEHEIM_TRANSCRIPT_42" }],
    metadata: { some_secret_field: "SECRET_VALUE_XYZ" },
  };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, body }), res));

  assert.equal(res.statusCode, 403);
  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"no_ccid"'));
  assert.ok(gates[0].includes("messages"), "Feld-NAME messages muss auftauchen (bodyKeys)");
  assert.ok(gates[0].includes("metadata"), "Feld-NAME metadata muss auftauchen (bodyKeys)");
  assert.ok(gates[0].includes("some_secret_field"), "Feld-NAME muss auftauchen (metadataKeys)");
  assert.ok(!gates[0].includes("GEHEIM_TRANSCRIPT_42"), "Transkript-WERT darf nie im Log auftauchen");
  assert.ok(!gates[0].includes("SECRET_VALUE_XYZ"), "Metadata-WERT darf nie im Log auftauchen");
});

test("OBS-1 no_ccid mit extra_metadata: gate traegt extraMetadataKeys (Feld-NAMEN), NIE die E.164-WERTE", async () => {
  const store = fakeStore({ call: makeCall() });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() });
  const res = fakeRes();
  const body = {
    extra_metadata: { customer_name: "Max", telnyx_end_user_target: "+491700000000" },
  };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, body }), res));

  assert.equal(res.statusCode, 403);
  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"no_ccid"'));
  assert.ok(gates[0].includes("customer_name"), "Feld-NAME muss auftauchen (extraMetadataKeys)");
  assert.ok(gates[0].includes("telnyx_end_user_target"), "Feld-NAME muss auftauchen (extraMetadataKeys)");
  assert.ok(!gates[0].includes("+491700000000"), "E.164-WERT darf nie im Log auftauchen");
  assert.ok(!gates[0].includes("Max"), "Namens-WERT darf nie im Log auftauchen");
});

test("OBS-1 call_unresolved: unbekannte ccid -> gate {found:false,status:null}", async () => {
  const store = fakeStore({ call: null });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() =>
    handler(reqWith({ auth: VALID_AUTH, ccid: "cc_unbekannt" }), res),
  );

  assert.equal(res.statusCode, 403);
  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"call_unresolved"'));
  assert.ok(gates[0].includes('"found":false'));
  assert.ok(gates[0].includes('"status":null'));
});

test("OBS-1 call_unresolved: inaktiver Call -> gate {found:true,status:\"completed\"}, ccid nicht im Log", async () => {
  const store = fakeStore({ call: makeCall({ status: "completed" }) });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res));

  assert.equal(res.statusCode, 403);
  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"call_unresolved"'));
  assert.ok(gates[0].includes('"found":true'));
  assert.ok(gates[0].includes('"status":"completed"'));
  assert.ok(!gates[0].includes("cc_x"), "die ccid selbst darf nicht im Log auftauchen");
});

test("OBS-1 rate_limited: N+1-Turn -> gate reason=rate_limited {callId}", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimMaxTurnsPerMin: 1 });
  const handler = makeHandler({ store, config, agentTurn: agentTurnSpy() });

  await handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), fakeRes()); // 1. Turn verbraucht das Fenster
  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), fakeRes()));

  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"rate_limited"'));
  assert.ok(gates[0].includes('"callId":"call_x"'));
});

test("OBS-1 budget_tenant: tenant-Cap -> gate reason=budget_tenant {callId,tenantId}", async () => {
  const store = fakeStore({ call: makeCall(), budgetExceeded: true });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res));

  const gates = gateLines(lines);
  assert.equal(gates.length, 1, "kein Hangup-Log daneben, da callControlId gesetzt ist");
  assert.ok(gates[0].includes('"reason":"budget_tenant"'));
  assert.ok(gates[0].includes('"callId":"call_x"'));
  assert.ok(gates[0].includes('"tenantId":"t_test"'));
});

test("OBS-1 budget_global: nur globaler Notaus -> gate reason=budget_global", async () => {
  const store = fakeStore({ call: makeCall(), globalBudgetExceeded: true });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res));

  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"budget_global"'));
});

test("OBS-1 turn_ok: Erfolg loggt unconditional (kein injizierter metrics-Spy) genau 1 turn_ok mit callId+numerischer latencyMs", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Hallo Welt", endCall: false });
  const handler = makeHandler({ store, agentTurn }); // KEIN metrics-Arg -> defaultMetrics (metricsEnabled aus)
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res));

  const turnOk = turnOkLines(lines);
  assert.equal(turnOk.length, 1);
  assert.ok(turnOk[0].includes('"callId":"call_x"'));
  assert.match(turnOk[0], /"latencyMs":\d/);
  assert.ok(!turnOk[0].includes("Hallo Welt"), "der Turn-Speech-Inhalt gehoert nie in die turn_ok-Zeile");
});

test("OBS-1 turn_ok feuert NICHT im Fehler-/Gate-Pfad", async () => {
  const store = fakeStore({ call: makeCall() });
  async function throwingAgentTurn() {
    throw new Error("llm kaputt");
  }
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res));

  assert.equal(turnOkLines(lines).length, 0);
});

test("OBS-1 vendor_402: agentTurn wirft err mit status 402 -> gate reason=vendor_402 {callId}, PII-frei, weiter gueltige Degradation", async () => {
  const store = fakeStore({ call: makeCall() });
  async function throwingAgentTurn() {
    throw Object.assign(new Error("payment required"), { status: 402 });
  }
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn });
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res));

  const gates = gateLines(lines);
  assert.equal(gates.length, 1);
  assert.ok(gates[0].includes('"reason":"vendor_402"'));
  assert.ok(gates[0].includes('"callId":"call_x"'));
  assert.equal(res.chunks.length, 2, "trotz Vendor-402 eine gueltige Degradations-Completion (kein Abbruch)");
  assert.ok(!lines.join("\n").includes("shim-secret"), "kein Secret im Log");
});

test("OBS-1 Regel-4 Master: kein Gate-Log leakt Secret/Transkript ueber die Gate-Matrix (auth/no_ccid/budget)", async () => {
  const SENTINEL_SECRET = "SENTINEL_SECRET_9f3391a";
  const SENTINEL_TRANSCRIPT = "SENTINEL_TRANSCRIPT_ich-bin-privat";
  const SENTINEL_PHONE = "+491700000000";
  const sentinelAuth = `Bearer ${SENTINEL_SECRET}`;
  const config = fakeTelnyxShimConfig({ telnyxShimSharedSecret: SENTINEL_SECRET });
  const sentinelBody = {
    messages: [{ role: "user", content: SENTINEL_TRANSCRIPT }],
    metadata: { caller_number: SENTINEL_PHONE },
  };
  const scenarios = [
    {
      store: fakeStore({ call: makeCall() }),
      req: reqWith({ auth: "Bearer falsches-secret", ccid: "cc_x", body: sentinelBody }),
    },
    { store: fakeStore({ call: makeCall() }), req: reqWith({ auth: sentinelAuth, body: sentinelBody }) },
    {
      store: fakeStore({ call: makeCall(), budgetExceeded: true }),
      req: reqWith({ auth: sentinelAuth, ccid: "cc_x", body: sentinelBody }),
    },
  ];

  const allLines = [];
  for (const scenario of scenarios) {
    const handler = makeHandler({ store: scenario.store, config, agentTurn: agentTurnSpy() });
    const lines = await withConsoleCapture(() => handler(scenario.req, fakeRes()));
    allLines.push(...lines);
  }

  const joined = allLines.join("\n");
  assert.ok(!joined.includes(SENTINEL_SECRET), "Secret darf in keiner Gate-Zeile der Matrix auftauchen");
  assert.ok(!joined.includes(SENTINEL_TRANSCRIPT), "Transkript-Wert darf in keiner Gate-Zeile auftauchen");
  assert.ok(!joined.includes(SENTINEL_PHONE), "Telefonnummer darf in keiner Gate-Zeile auftauchen");
});

// === OBS-FLAG: default-off Shape-Debug-Dump (keys-only, keine Gate-Aenderung) =======
const SHAPE_LINE_MARKER = "[telnyx-shim] shape";
const shapeLines = (lines) => lines.filter((l) => l.includes(SHAPE_LINE_MARKER));

test("OBS-FLAG an: authentifizierter Turn -> genau 1 shape-Zeile {ccidInMetadata:true,ccidTopLevel:false} + Top-Level-bodyKeys, KEINE Werte/Innenfeldnamen", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true });
  const handler = makeHandler({ store, config, agentTurn: agentTurnSpy() });
  const res = fakeRes();
  const body = {
    messages: [{ role: "user", content: "GEHEIM_TRANSCRIPT_42" }],
    metadata: { call_control_id: "cc_x", caller_number: "+491700000000" },
  };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, body }), res));

  const shapes = shapeLines(lines);
  assert.equal(shapes.length, 1);
  assert.ok(shapes[0].includes('"ccidInMetadata":true'));
  assert.ok(shapes[0].includes('"ccidTopLevel":false'));
  assert.ok(shapes[0].includes("messages"), "Top-Level-Feldname (bodyKeys)");
  assert.ok(shapes[0].includes("metadata"), "Top-Level-Feldname (bodyKeys)");
  assert.ok(!shapes[0].includes("GEHEIM_TRANSCRIPT_42"), "kein Transkript-Wert");
  assert.ok(!shapes[0].includes("+491700000000"), "keine Telefonnummer");
  assert.ok(!shapes[0].includes("caller_number"), "keine metadata-Innenfeldnamen (nur Top-Level)");
});

test("OBS-FLAG an: ccid NUR top-level (kein metadata-Wrapper) -> shape-Zeile {ccidInMetadata:false,ccidTopLevel:true} (Review-Blocker T5/G3)", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true });
  const handler = makeHandler({ store, config, agentTurn: agentTurnSpy() });
  const res = fakeRes();
  const body = { call_control_id: "cc_x", messages: [{ role: "user", content: "Hallo" }] };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, body }), res));

  const shapes = shapeLines(lines);
  assert.equal(shapes.length, 1);
  assert.ok(shapes[0].includes('"ccidInMetadata":false'));
  assert.ok(shapes[0].includes('"ccidTopLevel":true'));
});

test("OBS-FLAG default aus: KEINE shape-Zeile (byte-identisch), Turn laeuft normal durch", async () => {
  const store = fakeStore({ call: makeCall() });
  const handler = makeHandler({ store, agentTurn: agentTurnSpy() }); // Default -> telnyxShimDebugShape false
  const res = fakeRes();

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x" }), res));

  assert.equal(shapeLines(lines).length, 0, "Default-off emittiert keine shape-Zeile");
  assert.equal(res.chunks.length, 2, "Turn unveraendert (EIN Chunk + [DONE])");
});

test("OBS-FLAG an + fehlende ccid: shape-Zeile {ccidInMetadata:false,ccidTopLevel:false} NEBEN dem no_ccid-Gate; Gate-Verhalten byte-identisch (403)", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true });
  const handler = makeHandler({ store, config, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() =>
    handler(reqWith({ auth: VALID_AUTH, body: { messages: [] } }), res),
  );

  assert.equal(res.statusCode, 403, "fehlende ccid -> weiterhin 403 (keine Gate-Aenderung)");
  const shapes = shapeLines(lines);
  assert.equal(shapes.length, 1);
  assert.ok(shapes[0].includes('"ccidInMetadata":false'));
  assert.ok(shapes[0].includes('"ccidTopLevel":false'));
  assert.equal(gateLines(lines).length, 1, "das no_ccid-Gate feuert unveraendert");
});

test("OBS-FLAG an + falsches Bearer: KEINE shape-Zeile (Dump erst nach der Auth), nur das auth-Gate", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true });
  const handler = makeHandler({ store, config, agentTurn: agentTurnSpy() });
  const res = fakeRes();

  const lines = await withConsoleCapture(() =>
    handler(reqWith({ auth: "Bearer falsch", ccid: "cc_x" }), res),
  );

  assert.equal(res.statusCode, 403);
  assert.equal(shapeLines(lines).length, 0, "Shape-Dump laeuft erst NACH dem Bearer-Gate");
  assert.equal(gateLines(lines).length, 1, "nur das auth-Gate");
});

// === P5: messages-Shape + speechEmpty-Diskriminator (default-off, hinter Bearer) =====
// Eigenes distinktes Feld (speechEmpty) trennt diese Zeile von forwardMetadataShape (die
// ebenfalls kind="shape" traegt, aber kein speechEmpty hat) - siehe shapeLines oben.
const turnShapeLines = (lines) => lines.filter((l) => l.includes('"speechEmpty"'));

test("P5-1: erfolgreicher Turn -> genau 1 turn-shape-Zeile mit exakten Feldern, KEIN Nachrichtentext (PII)", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true });
  const agentTurn = agentTurnSpy({ speech: "Antwort", endCall: false });
  const handler = makeHandler({ store, config, agentTurn });
  const res = fakeRes();
  const body = {
    messages: [
      { role: "system", content: "Systemprompt" },
      { role: "user", content: "erste" },
      { role: "assistant", content: "Zwischenantwort" },
      { role: "user", content: "Zweite Frage" },
    ],
  };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x", body }), res));

  const turnShapes = turnShapeLines(lines);
  assert.equal(turnShapes.length, 1);
  const line = turnShapes[0];
  assert.ok(line.includes('"messagesCount":4'));
  assert.ok(line.includes('"system":1'));
  assert.ok(line.includes('"user":2'));
  assert.ok(line.includes('"assistant":1'));
  assert.ok(line.includes('"other":0'));
  assert.ok(line.includes('"lastUserContentType":"string"'));
  assert.ok(line.includes('"lastUserLength":12'));
  assert.ok(line.includes('"lastUserTextPresent":true'));
  assert.ok(line.includes('"speechEmpty":false'));
  assert.ok(!line.includes("Zweite Frage"), "kein Nachrichtentext (PII)");
  assert.ok(!line.includes("erste"), "kein Nachrichtentext (PII)");
  assert.ok(!line.includes("Antwort"), "kein Turn-Speech-Inhalt (PII)");
});

test("P5-2: agentTurn liefert leeren Speech (Anomalie) -> speechEmpty:true", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true });
  const agentTurn = agentTurnSpy({ speech: "", endCall: false });
  const handler = makeHandler({ store, config, agentTurn });
  const res = fakeRes();
  const body = { messages: [{ role: "user", content: "Hallo" }] };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x", body }), res));

  const line = turnShapeLines(lines)[0];
  assert.ok(line, "turn-shape-Zeile muss existieren");
  assert.ok(line.includes('"speechEmpty":true'));
});

test("P5-3: Array-Content bei der letzten user-Message -> contentType=array, lastUserTextPresent=false, KEIN Value-Leak", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true });
  const agentTurn = agentTurnSpy({ speech: "Antwort", endCall: false });
  const handler = makeHandler({ store, config, agentTurn });
  const res = fakeRes();
  const body = {
    messages: [
      { role: "system", content: "Systemprompt" },
      {
        role: "user",
        content: [
          { type: "text", text: "GEHEIM" },
          { type: "text", text: "noch mehr" },
        ],
      },
    ],
  };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x", body }), res));

  const line = turnShapeLines(lines)[0];
  assert.ok(line);
  assert.ok(line.includes('"lastUserContentType":"array"'));
  assert.ok(line.includes('"lastUserLength":2'));
  assert.ok(line.includes('"lastUserTextPresent":false'));
  assert.ok(!line.includes("GEHEIM"), "kein Array-Content-Wert (PII)");
});

test("P5-4: keine user-Message im Payload -> contentType=missing, lastUserLength=0, lastUserTextPresent=false", async () => {
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true });
  const agentTurn = agentTurnSpy({ speech: "Antwort", endCall: false });
  const handler = makeHandler({ store, config, agentTurn });
  const res = fakeRes();
  const body = { messages: [{ role: "system", content: "Systemprompt" }] };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x", body }), res));

  const line = turnShapeLines(lines)[0];
  assert.ok(line);
  assert.ok(line.includes('"messagesCount":1'));
  assert.ok(line.includes('"lastUserContentType":"missing"'));
  assert.ok(line.includes('"lastUserLength":0'));
  assert.ok(line.includes('"lastUserTextPresent":false'));
});

test("P5-5: Flag aus -> KEINE turn-shape-Zeile, Turn unveraendert (byte-identisch)", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy({ speech: "Antwort", endCall: false });
  const handler = makeHandler({ store, agentTurn }); // Default-Config -> telnyxShimDebugShape false
  const res = fakeRes();
  const body = { messages: [{ role: "user", content: "Hallo" }] };

  const lines = await withConsoleCapture(() => handler(reqWith({ auth: VALID_AUTH, ccid: "cc_x", body }), res));

  assert.equal(turnShapeLines(lines).length, 0, "Default-off emittiert keine turn-shape-Zeile");
  assert.equal(res.chunks.length, 2, "Turn unveraendert (EIN Chunk + [DONE])");
});

test("P5-6 (SAFE-1 dynamische Erweiterung): Sentinel-Transkript/E.164/Secret landen NICHT in der turn-shape-Zeile", async () => {
  const SENTINEL_SECRET = "SENTINEL_SECRET_p5_9f3391a";
  const SENTINEL_TRANSCRIPT = "SENTINEL_TRANSCRIPT_p5_ich-bin-privat";
  const SENTINEL_PHONE = "+491700000099";
  const store = fakeStore({ call: makeCall() });
  const config = fakeTelnyxShimConfig({ telnyxShimDebugShape: true, telnyxShimSharedSecret: SENTINEL_SECRET });
  const agentTurn = agentTurnSpy({ speech: "Antwort", endCall: false });
  const handler = makeHandler({ store, config, agentTurn });
  const res = fakeRes();
  const body = {
    messages: [
      { role: "user", content: SENTINEL_TRANSCRIPT },
      { role: "user", content: `${SENTINEL_TRANSCRIPT} ${SENTINEL_PHONE}` },
    ],
  };

  const lines = await withConsoleCapture(() =>
    handler(reqWith({ auth: `Bearer ${SENTINEL_SECRET}`, ccid: "cc_x", body }), res),
  );

  const turnShapes = turnShapeLines(lines);
  assert.equal(turnShapes.length, 1, "turn-shape-Zeile existiert (nicht vacuous)");
  const line = turnShapes[0];
  assert.ok(!line.includes(SENTINEL_TRANSCRIPT), "kein Transkript-Wert");
  assert.ok(!line.includes(SENTINEL_PHONE), "keine E.164");
  assert.ok(!line.includes(SENTINEL_SECRET), "kein Secret");
});
