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
      this.ended = true;
      this.headers["Content-Type"] = "application/json";
      this.body = b;
      return this;
    },
  };
}

// Fake-Store: getCallByControlId loest den Call ueber die ccid auf (E1-Korrelation);
// getCall bleibt fuer den Fresh-Fetch in terminateViaCallControl (Nachweis via
// getCallIds). finishCall/endCallRecord sind No-op-Spies - Negativ-Beweis, dass
// weder end_call noch der Mid-Call-Budget-Kill selbst ein Settlement ausloesen
// (bleibt P4.5 onHangup, EINE Quelle, Regel 1).
export function fakeStore({ call, budgetExceeded = false, globalBudgetExceeded = false } = {}) {
  const getCallIds = [];
  const settlementCalls = [];
  return {
    getCallIds,
    settlementCalls,
    getCallByControlId(ccid) {
      return call && call.callControlId === ccid ? call : null;
    },
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
    callControlId: "cc_1",
    status: "active",
    ...overrides,
  };
}

export function makeHandler({ store, config = fakeTelnyxShimConfig(), agentTurn, voiceControl }) {
  return makeTelnyxLlmShim({ store, config, agentTurn, localeFor, voiceControl });
}

export function reqWith({ auth, body = {} } = {}) {
  const headers = {};
  if (auth !== undefined) headers.authorization = auth;
  // Live-Telnyx sendet stream:true; body.stream (falls im Override gesetzt) gewinnt.
  return { headers, body: { stream: true, ...body } };
}

// Statischer Shim-Bearer (E2), matcht fakeTelnyxShimConfig()-Default (helpers.js).
export const SHIM_SHARED_SECRET = "shim-secret";

// Gueltiger Request fuer einen gegebenen Call: Bearer + ccid im forward_metadata-Body
// unter extra_metadata (E1, P2-bestaetigt). EINE Konstruktionsstelle (G5).
export function validReq(call, extra = {}) {
  return reqWith({
    auth: `Bearer ${SHIM_SHARED_SECRET}`,
    body: { extra_metadata: { call_control_id: call.callControlId }, ...extra },
  });
}

const SSE_DONE_LINE = "data: [DONE]\n\n";

// Alle SSE-data-Events (ohne [DONE]-Sentinel) als Objekte.
export function sseChunks(res) {
  return res.chunks
    .filter((c) => c !== SSE_DONE_LINE)
    .map((c) => JSON.parse(c.slice(SSE_DATA_PREFIX.length).trim()));
}

// Gesprochener Text: alle delta.content-Fragmente konkateniert (Chunk-Layout-agnostisch).
export function sseContent(res) {
  return sseChunks(res)
    .map((c) => c.choices[0].delta.content)
    .filter((t) => typeof t === "string")
    .join("");
}

// finish_reason aus dem separaten Abschluss-Chunk (einziger mit non-null finish_reason).
export function sseFinishReason(res) {
  const finish = sseChunks(res).find((c) => c.choices[0].finish_reason !== null);
  return finish ? finish.choices[0].finish_reason : null;
}

// role aus dem ersten Delta-Chunk (OpenAI: role-Delta zuerst).
export function sseRole(res) {
  const first = sseChunks(res)[0];
  return first ? first.choices[0].delta.role : undefined;
}

export function sseEndsWithDone(res) {
  return res.chunks[res.chunks.length - 1] === SSE_DONE_LINE;
}

// stream:false-Antwort: das an res.json uebergebene chat.completion-Objekt.
export function jsonCompletion(res) {
  return res.body;
}
