// Unit-Tests fuer P3a (PLAN-TELNYX-AI-ASSISTANT.md, Phase telnyx-p3a): end_call aus dem
// Telnyx Brain-Shim MUSS den Call REAL out-of-band ueber Call-Control beenden (Regel 1) -
// sonst laeuft der Call plus Tokenkosten weiter, obwohl das Modell "Auf Wiederhoeren" sagt.
// Eigenstaendige Fake-Harness (kein Netz/Spawn), gespiegelt von telnyx-llm-shim.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTelnyxLlmShim } from "../src/telnyx-llm-shim.js";
import { localeFor } from "../src/i18n/locales.js";

const SSE_DATA_PREFIX = "data: ";

// Minimaler Express-res-Fake, identisch zum Muster in telnyx-llm-shim.test.js.
function fakeRes() {
  return {
    statusCode: null,
    headers: {},
    chunks: [],
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
  };
}

// Fake-Store: getCall matcht nur den geseedeten Call (Fresh-Fetch-Nachweis via getCallIds).
// finishCall/endCallRecord sind No-op-Spies - dienen als Negativ-Beweis, dass der Shim
// KEIN Settlement selbst ausloest (das bleibt P4.5 onHangup, EINE Quelle, Regel 1).
function fakeStore({ call, budgetExceeded = false, globalBudgetExceeded = false } = {}) {
  const getCallIds = [];
  const settlementCalls = [];
  return {
    getCallIds,
    settlementCalls,
    getCall(id) {
      getCallIds.push(id);
      return call && call.id === id ? call : null;
    },
    budgetExceeded() {
      return budgetExceeded;
    },
    globalBudgetExceeded() {
      return globalBudgetExceeded;
    },
    finishCall(c) {
      settlementCalls.push({ op: "finishCall", call: c });
    },
    endCallRecord(id, status) {
      settlementCalls.push({ op: "endCallRecord", id, status });
    },
  };
}

// Spy-voiceControl: protokolliert (provider, callControlId) je Hangup-Aufruf; optional
// wirft der Hangup selbst (Robustheits-Check E5).
function voiceControlSpy({ throwOnHangup = false } = {}) {
  const calls = [];
  function voiceControl(provider) {
    return {
      async endCallViaCallControl(callControlId) {
        calls.push({ provider, callControlId });
        if (throwOnHangup) throw new Error("call-control kaputt");
      },
    };
  }
  voiceControl.calls = calls;
  return voiceControl;
}

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

function makeCall(overrides = {}) {
  return {
    id: "call_x",
    tenantId: "t_test",
    language: "de",
    provider: "telnyx",
    aiAssistantToken: "sec-per-call",
    callControlId: "cc_1",
    ...overrides,
  };
}

function makeHandler({ store, config = fakeConfig(), agentTurn, voiceControl }) {
  return makeTelnyxLlmShim({ store, config, agentTurn, localeFor, voiceControl });
}

function reqWith({ auth, body = {} } = {}) {
  const headers = {};
  if (auth !== undefined) headers.authorization = auth;
  return { headers, body };
}

function firstChunkJson(res) {
  return JSON.parse(res.chunks[0].slice(SSE_DATA_PREFIX.length).trim());
}

// === E1: end_call feuert Hangup, speech geht ZUERST raus ========================

test("E1: end_call=true + vorhandene callControlId -> speech zuerst, dann echter Call-Control-Hangup", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(res.chunks.length, 2, "genau EIN SSE-Chunk + data: [DONE]");
  assert.equal(firstChunkJson(res).choices[0].delta.content, "Auf Wiederhoeren");
  assert.equal(res.ended, true);

  assert.deepEqual(voiceControl.calls, [{ provider: "telnyx", callControlId: "cc_1" }]);
  assert.deepEqual(
    store.getCallIds,
    ["call_x", "call_x"],
    "Token-Auth-Fetch + frischer Store-Stand vor dem Hangup",
  );
});

// === E2: kein zweiter Store-Write (Settlement bleibt P4.5 onHangup) =============

test("E2: end_call ruft KEIN finishCall/endCallRecord auf - genau EIN Hangup-Call", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Tschuess", endCall: true });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(voiceControl.calls.length, 1);
  assert.deepEqual(store.settlementCalls, [], "Settlement bleibt allein bei P4.5 onHangup");
});

// === E3: fail-safe ohne callControlId (persistiert erst P5) =====================

test("E3: end_call=true OHNE callControlId -> kein Hangup, kein Throw, speech normal", async () => {
  const call = makeCall({ callControlId: undefined });
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Tschuess", endCall: true });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(voiceControl.calls.length, 0, "fail-safe Skip ohne callControlId");
  assert.equal(res.chunks.length, 2, "speech geht trotzdem normal raus");
  assert.equal(res.ended, true);
});

// === E4: endCall=false Gegenprobe (kein Fresh-Fetch, kein Hangup) ===============

test("E4: endCall=false -> kein Hangup-Aufruf, kein Fresh-Fetch nach dem Turn", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Bis dann", endCall: false });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(voiceControl.calls.length, 0);
  assert.deepEqual(store.getCallIds, ["call_x"], "kein zweiter getCall ohne end_call");
  assert.equal(firstChunkJson(res).choices[0].delta.content, "Bis dann");
});

// === E5: Hangup wirft -> Response bleibt intakt (eigener try/catch, Regel-1-Robustheit) ===

test("E5: Call-Control-Hangup wirft -> Handler resolved trotzdem, Response bereits intakt raus", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Auf Wiederhoeren", endCall: true });
  const voiceControl = voiceControlSpy({ throwOnHangup: true });
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(res.chunks.length, 2, "Response wurde vor dem Hangup-Versuch bereits vollstaendig geschrieben");
  assert.equal(res.ended, true);
  assert.equal(voiceControl.calls.length, 1, "Hangup wurde versucht");
});
