// Unit-Tests fuer den Telnyx Brain-Shim (PLAN-TELNYX-AI-ASSISTANT.md, Phase P1):
// reine Fake-basierte Tests (kein Netz/Spawn) gegen makeTelnyxLlmShim. Deckt die
// R1-Invarianten C1-C5 + D3 (Empty-Token-Falle) + D8 (Fehler-Durchreichung) aus
// tasks/p1-spec.md. Muster fuer fakeRes vgl. request-tenant-unit.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTelnyxLlmShim } from "../src/telnyx-llm-shim.js";
import { localeFor } from "../src/i18n/locales.js";
import { LlmUnavailableError } from "../src/llm.js";

const SSE_DATA_PREFIX = "data: ";

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

// Fake-Store: nur die drei vom Shim genutzten Fassaden-Funktionen. getCall matcht
// NUR die per Token adressierte call.id (sonst null) - so beweisen Tests, dass ein
// unbekannter/fremder callId NICHT zufaellig auf den geseedeten Call trifft.
function fakeStore({ call = null, budgetExceeded = false, globalBudgetExceeded = false } = {}) {
  const getCallCalls = [];
  return {
    getCallCalls,
    getCall(id) {
      getCallCalls.push(id);
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

function fakeConfig({ enabled = true, claudeModel = "claude-haiku-4-5" } = {}) {
  return { telnyxAiAssistantEnabled: enabled, claudeModel };
}

// Minimaler Call-Fixture: aiAssistantToken ist das per-Call-Secret (P4-Scope, hier
// nur gelesen/validiert). tenantId/language decken die von agentTurn/localeFor
// gelesenen Felder ab.
function makeCall(overrides = {}) {
  return {
    id: "call_x",
    tenantId: "t_test",
    language: "de",
    aiAssistantToken: "sec-per-call",
    ...overrides,
  };
}

// Baut Request + Handler in einem Rutsch (Build-Schritt, P13) - reduziert die
// Wiederholung ueber die C1-D8-Tabelle.
function makeHandler({ store, config = fakeConfig(), agentTurn = agentTurnSpy(), localeFor: lf = localeFor } = {}) {
  return makeTelnyxLlmShim({ store, config, agentTurn, localeFor: lf });
}

function reqWith({ auth, body = {} } = {}) {
  const headers = {};
  if (auth !== undefined) headers.authorization = auth;
  return { headers, body };
}

function firstChunkJson(res) {
  return JSON.parse(res.chunks[0].slice(SSE_DATA_PREFIX.length).trim());
}

// === C1: Flag aus -> 404 =========================================================

test("C1: Flag aus -> 404, kein agentTurn-Aufruf, kein Store-Zugriff", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, config: fakeConfig({ enabled: false }), agentTurn });
  const res = fakeRes();

  await handler(reqWith(), res);

  assert.equal(res.statusCode, 404);
  assert.equal(agentTurn.calls.length, 0);
  assert.deepEqual(store.getCallCalls, [], "Flag-aus-Pfad darf store.getCall nie aufrufen");
});

// === C2: Flag an, kein/fremdes Token -> 403 ======================================

test("C2a: Flag an, kein Authorization-Header -> 403, kein agentTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith(), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

test("C2b: gueltiges Token-Format, unbekannter callId (store.getCall -> null) -> 403", async () => {
  const store = fakeStore({ call: null });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_unknown:sec" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

test("C2c: bekannter callId, falsches Secret -> 403 (safeEqual false), kein agentTurn", async () => {
  const store = fakeStore({ call: makeCall({ aiAssistantToken: "richtiges-secret" }) });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:falsches-secret" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

// === D3: Empty-Token-Falle explizit geschlossen ==================================

test("D3a: leeres Secret im Token (\"Bearer call_x:\") -> 403, kein agentTurn", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

test("D3b: Call OHNE aiAssistantToken, Secret literal \"undefined\" -> 403 (Empty-Token-Guard)", async () => {
  // safeEqual(String(undefined), ...) wuerde sonst gegen den Literal-String "undefined"
  // vergleichen - der Guard "!stored" muss VOR safeEqual greifen.
  const store = fakeStore({ call: makeCall({ aiAssistantToken: undefined }) });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:undefined" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

test("D3c: Call mit aiAssistantToken=\"\" (leerer String), Secret \"\" -> 403 (safeEqual(\"\",\"\")===true waere sonst die Falle)", async () => {
  const store = fakeStore({ call: makeCall({ aiAssistantToken: "" }) });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:" }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(agentTurn.calls.length, 0);
});

// === C3: gueltiges Token -> OpenAI-Fake-Stream-Shape =============================

test("C3: gueltiges Token -> agentTurn 1x mit dem token-gebundenen Call, Fake-Stream-Shape", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Hallo Welt", endCall: false });
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(
    reqWith({
      auth: "Bearer call_x:sec-per-call",
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
  assert.ok(!res.chunks.join("").includes("sec-per-call"), "kein Token im SSE-Body");
});

test("C3b: kein req.body.model -> Fallback auf config.claudeModel", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, config: fakeConfig({ claudeModel: "claude-haiku-4-5" }), agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(firstChunkJson(res).model, "claude-haiku-4-5");
});

// === C4: Budget ueberschritten -> kein Token-Burn ================================

test("C4a: tenant-Budget ueberschritten -> Wind-Down-Completion, KEIN agentTurn-Aufruf", async () => {
  const store = fakeStore({ call: makeCall({ language: "de" }), budgetExceeded: true });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(agentTurn.calls.length, 0, "kein Token-Burn bei ueberschrittenem Budget");
  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").budgetExhaustedHangup);
});

test("C4b: globaler Budget-Notaus ueberschritten -> Wind-Down-Completion, KEIN agentTurn-Aufruf", async () => {
  const store = fakeStore({ call: makeCall(), globalBudgetExceeded: true });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(agentTurn.calls.length, 0);
  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").budgetExhaustedHangup);
});

// === C5: callId aus Token, nicht Body ============================================

test("C5: gespoofter callId/tenantId im Body wird ignoriert - Token bindet den Call", async () => {
  const callA = makeCall({ id: "call_A", tenantId: "t_A", aiAssistantToken: "sec-A" });
  const store = fakeStore({ call: callA });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(
    reqWith({
      auth: "Bearer call_A:sec-A",
      body: {
        callId: "call_B", // gespoofter Body-Wert, MUSS ignoriert werden
        tenantId: "t_B",
        messages: [{ role: "user", content: "Ich bin der Angerufene" }],
      },
    }),
    res,
  );

  assert.equal(agentTurn.calls.length, 1);
  assert.equal(agentTurn.calls[0].call.id, "call_A", "Token bindet den Call, nicht der Body");
  assert.equal(agentTurn.calls[0].call.tenantId, "t_A");
  assert.equal(agentTurn.calls[0].callerText, "Ich bin der Angerufene");
});

// === lastUserText: Grenzfaelle (G3/T5) ===========================================

test("lastUserText: kein messages-Array / kein user-Eintrag mit String-Content -> callerText \"\"", async () => {
  const store = fakeStore({ call: makeCall() });
  const agentTurn = agentTurnSpy();
  const handler = makeHandler({ store, agentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call", body: {} }), res);

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

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

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

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.notEqual(res.statusCode, 502);
  assert.equal(res.body, null);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(res.ended, true);
  const content = firstChunkJson(res).choices[0].delta.content;
  assert.equal(content, localeFor("de").llmDegradedSpeech);
  assert.notEqual(content, localeFor("de").turnErrorSpeech, "transiente Klasse != generischer Fehler");
});

test("D10: Degradations-Body enthaelt kein Secret - content ist exakt der Locale-String", async () => {
  const store = fakeStore({ call: makeCall({ aiAssistantToken: "sec-per-call" }) });
  async function throwingAgentTurn() {
    throw new LlmUnavailableError("retries-exhausted");
  }
  const handler = makeHandler({ store, agentTurn: throwingAgentTurn });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  const raw = res.chunks.join("");
  assert.ok(!raw.includes("sec-per-call"), "kein per-Call-Secret im Degradations-Body");
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

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

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

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(res.chunks.length, 1, "nur der erste (fehlgeschlagene) Chunk steht - kein Retry-Chunk");
  assert.equal(res.ended, true, "Fehlerpfad ruft end() statt erneut writeFakeStream aufzurufen");
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
    await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);
  } finally {
    console.error = originalError;
  }

  assert.ok(logged.some((l) => l.includes("[telnyx-shim]")));
  assert.ok(!logged.join("\n").includes("sec-per-call"), "Log darf das Secret nie enthalten");
});
