// Gemeinsame Fake-Test-Harness fuer makeTelnyxLlmShim-Unit-Tests, die den
// Call-Control-Hangup-Pfad (voiceControl) mitabdecken (kein Netz/Spawn). EINE
// Quelle (G5) statt wortgleicher Kopien: vor telnyx-p6 bereits in
// telnyx-shim-endcall.test.js dupliziert, telnyx-p6-midcall-budget-kill.test.js
// haette eine dritte Kopie hinzugefuegt. telnyx-llm-shim.test.js deckt den
// Basis-Shim OHNE voiceControl/callControlId ab und bleibt bewusst eigenstaendig
// (andere fakeStore-/fakeRes-Form, kein Hangup-Pfad in seinen Fixtures).
import { fakeTelnyxShimConfig, noopWatchdog } from "./helpers.js";
import { makeTelnyxLlmShim } from "../src/telnyx-llm-shim.js";
import { localeFor } from "../src/i18n/locales.js";
import { makeConversationWatchdog, WATCHDOG_LOG_PREFIX } from "../src/telnyx-conversation-watchdog.js";
import { makeCallControlTerminator } from "../src/telnyx-call-terminate.js";
import { config } from "../src/config.js";

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

export function makeHandler({
  store,
  config = fakeTelnyxShimConfig(),
  agentTurn,
  voiceControl,
  watchdog = noopWatchdog(),
}) {
  return makeTelnyxLlmShim({ store, config, agentTurn, localeFor, voiceControl, watchdog });
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

// afix-p3 (G5/S2): Watchdog-Test-Rohstoffe, vorher lokal in telnyx-stab-p9-watchdog.test.js -
// jetzt EINE Quelle fuer drei Testdateien (telnyx-stab-p9-watchdog, telnyx-afix-p3-farewell,
// telnyx-shim-endcall brauchen alle einen echten Watchdog + Fake-Timer statt noopWatchdog).

// Kompaktes N/M fuer schnelle, lesbare Tests (config.js-Defaults 45s/8 waeren nur langsamer
// zu lesen, nicht anders zu pruefen - die Watchdog-Logik ist schwellenwert-agnostisch).
export const WATCHDOG_TEST_CONFIG = { telnyxDeadAirTimeoutS: 30, telnyxLoopGuardMaxEmptyTurns: 3 };
export const DEAD_AIR_TEST_MS = 30_000; // = telnyxDeadAirTimeoutS * 1000

// Deterministischer Fake-Timer (P12 Fast/Repeatable): setTimer/clearTimer injiziert statt
// echter Wartezeit. fireAll() feuert alle noch ausstehenden Callbacks synchron.
export function fakeTimers() {
  const pending = [];
  let nextId = 1;
  const cleared = [];
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      pending.push({ id, fn, ms });
      return id;
    },
    clearTimer(id) {
      cleared.push(id);
      const i = pending.findIndex((p) => p.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    fireAll() {
      pending.splice(0).forEach((p) => p.fn());
    },
    pendingCount: () => pending.length,
    clearedCount: () => cleared.length,
    // afix-p3: ms-Werte der noch offenen Timer (Reihenfolge = Stell-Reihenfolge). Erst damit
    // ist "Dead-Air suspendiert" beweisbar - die reine Hangup-Zaehlung kann es NICHT zeigen
    // (der one-shot-State-Delete verschluckt ein zweites Feuern still).
    pendingDelays: () => pending.map((p) => p.ms),
  };
}

// afix-timeout / afix-timeout-caller-gap (G5, Review-Blocker Runde 3): die drei
// makeCallControlIngest-Ingest-Deps (config + ein vom Watchdog-Timer entkoppelter Fake-Timer)
// werden von telnyx-event-ingest-machine.test.js UND telnyx-stab-p9-watchdog.test.js gebraucht -
// vorher zweimal byte-identisch definiert, jetzt EINE Stelle statt zwei Kopien.
export function ingestTimeoutDeps() {
  const t = fakeTimers();
  return { config, setTimer: t.setTimer, clearTimer: t.clearTimer };
}

// Baut Watchdog + geteiltes Terminierungs-Primitiv aus den ECHTEN Factories (kein Mock der
// Kern-Logik) gegen einen gegebenen Fake-Store/-VoiceControl/-Timer (Build-Schritt, P13).
export function makeTestWatchdog({ store, voiceControl, timers, config = WATCHDOG_TEST_CONFIG }) {
  const terminate = makeCallControlTerminator({ store, voiceControl, logPrefix: WATCHDOG_LOG_PREFIX });
  return makeConversationWatchdog({
    config,
    terminate,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
}
