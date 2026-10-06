import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hangUpAction } from "../src/telephony/call-termination.js";
import { reattachActiveCall } from "../src/telephony/reattach.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_DURATION_S = 180;
const SECONDS_60 = 60;
const SECONDS_400 = 400;
const MS_PER_S = 1000;

const SOURCE_WINDOW_TERMINATE_ACTIVE_CALL_CHARS = 1600;
const SOURCE_WINDOW_CANCEL_CALL_CHARS = 4000;
const SOURCE_WINDOW_REARM_TIMERS_CHARS = 1200;

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

const lifecycleSrc = fs.readFileSync(path.join(ROOT, "src", "telephony", "call-lifecycle.js"), "utf8");
const apiCallsSrc = fs.readFileSync(path.join(ROOT, "src", "routes", "api-calls.js"), "utf8");

test("T6: terminateCappedCall verwendet hangUpAction (nicht mehr das alte providerCallSid-Ternary)", () => {
  const marker = "async function terminateActiveCall({ callId, providerCallSid, status, failureReason }) {";
  const block = lifecycleSrc.slice(
    lifecycleSrc.indexOf(marker),
    lifecycleSrc.indexOf(marker) + SOURCE_WINDOW_TERMINATE_ACTIVE_CALL_CHARS,
  );

  assert.match(block, /hangUp:\s*hangUpAction\(voiceControl,\s*call,\s*providerCallSid\)/);
  assert.doesNotMatch(
    block,
    /providerCallSid\s*\?\s*\(\)\s*=>\s*voiceControl\(call\.provider\)\.endCall/,
    "das alte inline Ternary darf nicht mehr da sein (G5: EINE Quelle ueber hangUpAction)",
  );
});

test("T7: cancel_call verwendet hangUpAction (dieselbe Quelle wie terminateCappedCall)", () => {
  const marker = 'router.post("/api/calls/:id/cancel"';
  const block = apiCallsSrc.slice(
    apiCallsSrc.indexOf(marker),
    apiCallsSrc.indexOf(marker) + SOURCE_WINDOW_CANCEL_CALL_CHARS,
  );

  assert.match(block, /const providerHangUp = hangUpAction\(voiceControl,\s*call,\s*call\.twilioSid\);/);
  assert.match(block, /hangUp:\s*providerHangUp\s*\?\?\s*elHangUp/);
  assert.equal(
    (block.match(/hangUpAction\(voiceControl,\s*call,\s*call\.twilioSid\)/g) || []).length,
    1,
    "hangUpAction() darf nur EINMAL ausgewertet werden - Regressionsguard fuer den alten Doppelaufruf",
  );
});

test("Wiring: rearmActiveCallTimers terminalisiert ausschliesslich ueber terminateCappedCall/scheduleMaxDurationEnd (kein direkter voiceEngine-getriebener endCall)", () => {
  const marker = "function rearmActiveCallTimers()";
  const block = lifecycleSrc.slice(
    lifecycleSrc.indexOf(marker),
    lifecycleSrc.indexOf(marker) + SOURCE_WINDOW_REARM_TIMERS_CHARS,
  );
  assert.doesNotMatch(block, /voiceEngine/, "rearm kennt keinen Engine-Sonderfall mehr (IE6-S2)");
  assert.match(block, /terminateCappedCall\(call\.id, call\.twilioSid/);
  assert.match(block, /scheduleMaxDurationEnd\(call, call\.twilioSid/);
  assert.doesNotMatch(
    block,
    /endCallViaCallControl|\.endCall\(/,
    "Hangup-Endpunktwahl bleibt in hangUpAction (Befund 1), NIE inline in rearm",
  );
});
