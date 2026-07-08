// P6 (PLAN-TELNYX-AI-ASSISTANT.md, Phase telnyx-p6, Weg iii): Mid-Call-Budget-Kill.
// Regel 1 verlangt BEIDE Kosten-Achsen (Minuten UND Tokens). Vor P6 deckte das
// Budget-Gate im Shim nur die Ansage ab ("Wind-Down-Completion") - der Call selbst
// lief technisch weiter, Tokenkosten liefen mit jedem weiteren Turn mit. Diese Tests
// pinnen: bei Cap-Ueberschreitung geht die Abschluss-Ansage ZUERST raus, DANACH wird
// der Call REAL ueber Call-Control aufgelegt (terminateViaCallControl, derselbe fail-
// safe Helper wie der end_call-Hangup, G5). Eigenstaendige Fake-Harness (kein Netz/
// Spawn), Muster identisch zu telnyx-shim-endcall.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTelnyxLlmShim } from "../src/telnyx-llm-shim.js";
import { localeFor } from "../src/i18n/locales.js";
import { fakeTelnyxShimConfig } from "./helpers.js";

const SSE_DATA_PREFIX = "data: ";

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

// Fake-Store: getCall matcht nur den geseedeten Call (Fresh-Fetch-Nachweis via
// getCallIds). finishCall/endCallRecord sind No-op-Spies - Negativ-Beweis, dass der
// Mid-Call-Kill KEIN Settlement selbst ausloest (bleibt P4.5 onHangup, Regel 1).
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

function voiceControlSpy() {
  const calls = [];
  function voiceControl(provider) {
    return {
      async endCallViaCallControl(callControlId) {
        calls.push({ provider, callControlId });
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

function makeHandler({ store, config = fakeTelnyxShimConfig(), agentTurn, voiceControl }) {
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

// === B1: tenant-Budget ueberschritten + callControlId -> Ansage, DANN echter Hangup ===

test("B1: tenant-Budget ueberschritten -> Wind-Down-Completion UND Call-Control-Hangup, kein Token-Burn", async () => {
  const call = makeCall();
  const store = fakeStore({ call, budgetExceeded: true });
  const agentTurn = agentTurnSpy();
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(agentTurn.calls.length, 0, "kein Token-Burn bei ueberschrittenem Budget");
  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").budgetExhaustedHangup);
  assert.equal(res.ended, true);
  assert.deepEqual(voiceControl.calls, [{ provider: "telnyx", callControlId: "cc_1" }]);
  assert.deepEqual(store.settlementCalls, [], "Settlement bleibt allein bei P4.5 onHangup");
});

// === B2: globaler Budget-Notaus + callControlId -> analog B1 =========================

test("B2: globaler Budget-Notaus ueberschritten -> Wind-Down-Completion UND Call-Control-Hangup", async () => {
  const call = makeCall();
  const store = fakeStore({ call, globalBudgetExceeded: true });
  const agentTurn = agentTurnSpy();
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(agentTurn.calls.length, 0);
  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").budgetExhaustedHangup);
  assert.deepEqual(voiceControl.calls, [{ provider: "telnyx", callControlId: "cc_1" }]);
  assert.deepEqual(store.settlementCalls, []);
});

// === B3: Budget ueberschritten OHNE callControlId -> fail-safe Skip, kein Throw ======

test("B3: Budget ueberschritten OHNE callControlId -> Degradations-Completion, KEIN Hangup-Versuch, kein Crash", async () => {
  const call = makeCall({ callControlId: undefined });
  const store = fakeStore({ call, budgetExceeded: true });
  const agentTurn = agentTurnSpy();
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(firstChunkJson(res).choices[0].delta.content, localeFor("de").budgetExhaustedHangup);
  assert.equal(res.ended, true);
  assert.equal(voiceControl.calls.length, 0, "fail-safe Skip ohne callControlId, kein Crash");
});

// === B4: Gegenprobe - Budget OK -> kein Budget-Kill-Hangup, agentTurn laeuft normal ===

test("B4: Budget OK -> kein Budget-Kill-Hangup, agentTurn wird normal aufgerufen", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const agentTurn = agentTurnSpy({ speech: "Hallo", endCall: false });
  const voiceControl = voiceControlSpy();
  const handler = makeHandler({ store, agentTurn, voiceControl });
  const res = fakeRes();

  await handler(reqWith({ auth: "Bearer call_x:sec-per-call" }), res);

  assert.equal(agentTurn.calls.length, 1);
  assert.equal(voiceControl.calls.length, 0, "kein Hangup, wenn kein Cap ueberschritten ist");
  assert.equal(firstChunkJson(res).choices[0].delta.content, "Hallo");
});
