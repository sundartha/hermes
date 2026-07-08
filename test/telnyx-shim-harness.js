// Gemeinsame Fake-Test-Harness fuer makeTelnyxLlmShim-Unit-Tests, die den
// Call-Control-Hangup-Pfad (voiceControl) mitabdecken (kein Netz/Spawn). EINE
// Quelle (G5) statt wortgleicher Kopien: vor telnyx-p6 bereits in
// telnyx-shim-endcall.test.js dupliziert, telnyx-p6-midcall-budget-kill.test.js
// haette eine dritte Kopie hinzugefuegt. telnyx-llm-shim.test.js deckt den
// Basis-Shim OHNE voiceControl/callControlId ab und bleibt bewusst eigenstaendig
// (andere fakeStore-/fakeRes-Form, kein Hangup-Pfad in seinen Fixtures).
import { fakeTelnyxShimConfig } from "./helpers.js";
import { makeTelnyxLlmShim } from "../src/telnyx-llm-shim.js";
import { localeFor } from "../src/i18n/locales.js";

const SSE_DATA_PREFIX = "data: ";

// Minimaler Express-res-Fake: erfasst Status, gesetzte Header und geschriebene
// SSE-Chunks. headersSent kippt erst bei einem tatsaechlichen Schreibvorgang
// (write/end) - wie im echten Express.
export function fakeRes() {
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
// getCallIds). finishCall/endCallRecord sind No-op-Spies - Negativ-Beweis, dass
// weder end_call noch der Mid-Call-Budget-Kill selbst ein Settlement ausloesen
// (bleibt P4.5 onHangup, EINE Quelle, Regel 1).
export function fakeStore({ call, budgetExceeded = false, globalBudgetExceeded = false } = {}) {
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

// Spy-voiceControl: protokolliert (provider, callControlId) je Hangup-Aufruf;
// optional wirft der Hangup selbst (Robustheits-Check, z.B. E5 in
// telnyx-shim-endcall.test.js).
export function voiceControlSpy({ throwOnHangup = false } = {}) {
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

export function agentTurnSpy(result = { speech: "Hallo Welt", endCall: false }) {
  const calls = [];
  async function agentTurn(call, callerText) {
    calls.push({ call, callerText });
    return result;
  }
  agentTurn.calls = calls;
  return agentTurn;
}

export function makeCall(overrides = {}) {
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

export function makeHandler({ store, config = fakeTelnyxShimConfig(), agentTurn, voiceControl }) {
  return makeTelnyxLlmShim({ store, config, agentTurn, localeFor, voiceControl });
}

export function reqWith({ auth, body = {} } = {}) {
  const headers = {};
  if (auth !== undefined) headers.authorization = auth;
  return { headers, body };
}

export function firstChunkJson(res) {
  return JSON.parse(res.chunks[0].slice(SSE_DATA_PREFIX.length).trim());
}
