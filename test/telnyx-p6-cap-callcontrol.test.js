import { test } from "node:test";
import assert from "node:assert/strict";
import { hangUpAction } from "../src/telephony/call-termination.js";
import { reattachActiveCall } from "../src/telephony/reattach.js";

const MAX_DURATION_S = 180;
const SECONDS_60 = 60;
const SECONDS_400 = 400;
const MS_PER_S = 1000;

function voiceControlSpy() {
  const calls = [];
  function voiceControl(provider) {
    return {
      async endCall(sid) {
        calls.push({ op: "endCall", provider, arg: sid });
      },
      async endCallViaCallControl(callControlId) {
        calls.push({ op: "endCallViaCallControl", provider, arg: callControlId });
      },
    };
  }
  voiceControl.calls = calls;
  return voiceControl;
}

test("T1: callControlId gesetzt -> Thunk ruft endCallViaCallControl, NIE endCall", async () => {
  const spy = voiceControlSpy();
  const thunk = hangUpAction(spy, { provider: "telnyx", callControlId: "cc_1" }, null);

  assert.equal(typeof thunk, "function");
  await thunk();

  assert.deepEqual(spy.calls, [{ op: "endCallViaCallControl", provider: "telnyx", arg: "cc_1" }]);
});

test("T2: callControlId UND providerCallSid gesetzt -> callControlId gewinnt (Praezedenz)", async () => {
  const spy = voiceControlSpy();
  const thunk = hangUpAction(spy, { provider: "telnyx", callControlId: "cc_1" }, "CA_ignored");
  await thunk();

  assert.deepEqual(
    spy.calls,
    [{ op: "endCallViaCallControl", provider: "telnyx", arg: "cc_1" }],
    "endCall darf bei vorhandener callControlId NIE getroffen werden",
  );
});

test("T3: kein callControlId, providerCallSid gesetzt -> Thunk ruft endCall (TeXML byte-identisch)", async () => {
  const spy = voiceControlSpy();
  const thunk = hangUpAction(spy, { provider: "telnyx" }, "CA_x");
  await thunk();

  assert.deepEqual(spy.calls, [{ op: "endCall", provider: "telnyx", arg: "CA_x" }]);
});

test("T4: weder callControlId noch providerCallSid -> null (Hangup wird fail-safe uebersprungen)", () => {
  const spy = voiceControlSpy();
  const thunk = hangUpAction(spy, { provider: "telnyx" }, null);

  assert.equal(thunk, null);
  assert.equal(spy.calls.length, 0);
});

const activeCallControlCall = (secondsAgo) => ({
  id: "reattach_cc",
  twilioSid: null,
  callControlId: "cc_r",
  status: "active",
  answeredAt: new Date(Date.now() - secondsAgo * MS_PER_S).toISOString(),
  startedAt: null,
  maxDurationS: null,
});

function makeReattachDeps(attachResult) {
  const calls = { terminate: [], schedule: [] };
  const deps = {
    attachActiveCall: async () => attachResult,
    maxCallDurationS: MAX_DURATION_S,
    terminateCappedCall: async (callId, providerCallSid, status) => {
      calls.terminate.push({ callId, providerCallSid, status });
    },
    scheduleMaxDurationEnd: (call, providerCallSid, ms) => {
      calls.schedule.push({ callId: call.id, providerCallSid, ms });
    },
    budgetAxisFor: () => null,
    terminateOverBudgetCall: async () => {},
  };
  return { deps, calls };
}

test("T5a: reattach Ueberzeit-Fixture (callControlId, twilioSid null) -> terminateCappedCall(id, null, 'failed')", async () => {
  const call = activeCallControlCall(SECONDS_400);
  const { deps, calls } = makeReattachDeps(call);

  const result = await reattachActiveCall("reattach_cc", deps);

  assert.deepEqual(result, { call: null, logUnknown: false });
  assert.equal(calls.terminate.length, 1);
  assert.deepEqual(calls.terminate[0], {
    callId: "reattach_cc",
    providerCallSid: null,
    status: "failed",
  });
  assert.equal(calls.schedule.length, 0);
});

test("T5b: reattach Aktiv-Restzeit-Fixture (callControlId, twilioSid null) -> scheduleMaxDurationEnd(call, null, ms>0)", async () => {
  const call = activeCallControlCall(SECONDS_60);
  const { deps, calls } = makeReattachDeps(call);

  const result = await reattachActiveCall("reattach_cc", deps);

  assert.deepEqual(result, { call });
  assert.equal(calls.terminate.length, 0);
  assert.equal(calls.schedule.length, 1);
  assert.equal(calls.schedule[0].callId, "reattach_cc");
  assert.equal(calls.schedule[0].providerCallSid, null);
  assert.ok(calls.schedule[0].ms > 0 && calls.schedule[0].ms <= MAX_DURATION_S * MS_PER_S);
});
