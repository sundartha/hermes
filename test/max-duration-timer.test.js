// IN-03 (PLAN-LAUNCH-TESTS.md, P0/launch-blockierend): Max-Dauer-Timer feuert und beendet
// den Call GENAU EINMAL ueber den korrekten Provider. Reiner Unit-Test der Lifecycle-Factory
// (makeCallLifecycle, src/telephony/call-lifecycle.js) mit Fake-Timern (node:test
// mock.timers) und injizierten Fake-/Real-Deps - kein Server-Spawn, kein Netz (F.I.R.S.T.,
// Muster f1-i18n-locale.test.js). Diese Factory hatte vorher KEINEN eigenen Unit-Test
// (nur server.js konstruiert sie) - deckt jetzt den einzigen harten Max-Dauer-Cap ab.
//
// terminateAndBillCall/billThunk/hangUpAction werden ECHT importiert (sie sind laut eigenem
// Kopfkommentar rein/DI-faehig, "offline mit Spy-voiceControl unit-testbar") - nur
// store/voiceControl/finishCall/releaseReserve sind Fakes. classifyCallTime/cappedEndedAtMs
// kommen ebenfalls echt aus state-ops.js (reine Funktionen, kein IO).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { makeCallLifecycle } from "../src/telephony/call-lifecycle.js";
import {
  terminateAndBillCall,
  billThunk,
  hangUpAction,
} from "../src/telephony/call-termination.js";
import { classifyCallTime, cappedEndedAtMs } from "../src/store/state-ops.js";

function makeFakeStore(calls) {
  const map = new Map(calls.map((c) => [c.id, c]));
  return {
    getCall: (id) => map.get(id),
    setCallEndedAt: (id, status, endedAtIso) => {
      const c = map.get(id);
      if (c) {
        c.status = status;
        c.endedAt = endedAtIso;
      }
    },
  };
}

function makeLifecycle({ store, voiceControl, finishCall }) {
  return makeCallLifecycle({
    store,
    config: { safety: { maxCallDurationS: 300 } },
    finishCall,
    releaseReserve: mock.fn(async () => {}),
    voiceControl,
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    reattachActiveCallCore: () => {
      throw new Error("nicht Teil dieses Tests");
    },
    cappedEndedAtMs,
    classifyCallTime,
  });
}

// Nach jedem Tick-Test muss die Promise-Kette in terminateCappedCall (async, mehrere
// awaits: hangUp -> persistEnd bereits sync -> bill fire-and-forget) durchlaufen sein,
// bevor wir asserten - mock.timers.tick feuert den setTimeout-Callback nur SYNCHRON an,
// die inneren awaits brauchen einen echten Makrotask-Flush (setImmediate bleibt ungemockt).
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("IN-03: armMaxDurationTimer beendet einen Twilio/TeXML-Call (endCall) nach Ablauf, genau einmal", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const call = { id: "call1", status: "active", provider: "twilio", maxDurationS: 30, callControlId: null };
    const store = makeFakeStore([call]);
    const endCall = mock.fn(async () => {});
    const endCallViaCallControl = mock.fn(async () => {});
    const voiceControl = () => ({ endCall, endCallViaCallControl });
    const finishCall = mock.fn(async () => {});

    const lifecycle = makeLifecycle({ store, voiceControl, finishCall });
    lifecycle.armMaxDurationTimer(call, "PROVIDER_SID_123");

    // Noch vor Ablauf: darf NICHT gefeuert haben (Grenzfall).
    mock.timers.tick(29999);
    await flushMicrotasks();
    assert.equal(endCall.mock.callCount(), 0, "vor Ablauf des Call-Limits darf endCall nicht laufen");

    // call-eigenes Limit (30s) schlaegt den globalen Default (300s) - nach genau 30000ms
    // (insgesamt) muss endCall gefeuert haben.
    mock.timers.tick(1);
    await flushMicrotasks();

    assert.equal(endCall.mock.callCount(), 1, "endCall haette genau einmal laufen muessen");
    assert.equal(endCallViaCallControl.mock.callCount(), 0, "TeXML-Call darf NICHT ueber Call-Control beendet werden");
    assert.equal(endCall.mock.calls[0].arguments[0], "PROVIDER_SID_123");
    assert.equal(call.status, "completed");
    assert.equal(finishCall.mock.callCount(), 1, "Buchung (finishCall) muss genau einmal laufen");

    // Kein zweiter Timer/keine zweite Buchung, falls Zeit weiter vorspult (No-op-Guard).
    mock.timers.tick(10_000);
    await flushMicrotasks();
    assert.equal(endCall.mock.callCount(), 1);
    assert.equal(finishCall.mock.callCount(), 1);
  } finally {
    mock.timers.reset();
  }
});

test("IN-03: Call-Control-Call (callControlId gesetzt) wird ueber endCallViaCallControl beendet, NICHT endCall (P6/Befund 1)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const call = {
      id: "call2",
      status: "active",
      provider: "telnyx",
      maxDurationS: 10,
      callControlId: "cc_abc123",
    };
    const store = makeFakeStore([call]);
    const endCall = mock.fn(async () => {});
    const endCallViaCallControl = mock.fn(async () => {});
    const voiceControl = () => ({ endCall, endCallViaCallControl });
    const finishCall = mock.fn(async () => {});

    const lifecycle = makeLifecycle({ store, voiceControl, finishCall });
    lifecycle.armMaxDurationTimer(call, "PROVIDER_SID_IGNORED");

    mock.timers.tick(10_000);
    await flushMicrotasks();

    assert.equal(endCallViaCallControl.mock.callCount(), 1, "Call-Control-Call muss ueber endCallViaCallControl beendet werden");
    assert.equal(endCallViaCallControl.mock.calls[0].arguments[0], "cc_abc123");
    assert.equal(endCall.mock.callCount(), 0, "TeXML-endCall darf bei Call-Control NICHT laufen (still-failed Hangup waere Kostenexplosion, Befund 1)");
    assert.equal(call.status, "completed");
  } finally {
    mock.timers.reset();
  }
});

test("IN-03: bereits vorher beendeter Call -> Timer feuert No-op (kein doppeltes endCall/finishCall)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const call = { id: "call3", status: "active", provider: "twilio", maxDurationS: 5, callControlId: null };
    const store = makeFakeStore([call]);
    const endCall = mock.fn(async () => {});
    const voiceControl = () => ({ endCall, endCallViaCallControl: mock.fn(async () => {}) });
    const finishCall = mock.fn(async () => {});

    const lifecycle = makeLifecycle({ store, voiceControl, finishCall });
    lifecycle.armMaxDurationTimer(call, "SID_X");

    // Call wird VOR Timer-Ablauf anderweitig beendet (z.B. cancel_call/Hangup-Webhook).
    call.status = "cancelled";

    mock.timers.tick(5000);
    await flushMicrotasks();

    assert.equal(endCall.mock.callCount(), 0, "ein bereits nicht mehr aktiver Call darf keinen zweiten Hangup ausloesen");
    assert.equal(finishCall.mock.callCount(), 0, "ein bereits nicht mehr aktiver Call darf keine zweite Buchung ausloesen");
    assert.equal(call.status, "cancelled", "der urspruengliche Endstatus bleibt unangetastet");
  } finally {
    mock.timers.reset();
  }
});
