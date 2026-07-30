// P6 (PLAN-TELNYX-AI-ASSISTANT.md, Phase telnyx-p6): hangUpAction() waehlt den
// Hangup-Endpunkt+ID anhand der Call-FORM (callControlId-Praesenz), NICHT der
// voiceEngine - EINE Quelle (G5) fuer terminateCappedCall UND cancel_call (server.js).
// Ohne diese Zentralisierung schluege ein Cap-Timer gegen einen C-Telnyx-Call still
// mit einem TeXML-endCall(undefined) fehl -> der Call orphant nach jedem Deploy weiter,
// Kostenexplosion (Befund 1, Absolute Regel 1). Reine Unit-Tests (Spy-voiceControl,
// kein Server/Store/Netz) + Quelltext-Wiring-Guards (Muster reattach-active-call.test.js
// T-Asymmetrie-Regressionsguard).
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

// Spy-voiceControl: protokolliert jeden endCall/endCallViaCallControl-Aufruf mit
// Provider+Argument, damit T1-T3 belegen koennen, welcher Endpunkt getroffen wurde
// (und welcher NICHT).
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

// ---- T1-T4: hangUpAction (pur) ----

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
  const thunk = hangUpAction(spy, { provider: "twilio" }, "CA_x");
  await thunk();

  assert.deepEqual(spy.calls, [{ op: "endCall", provider: "twilio", arg: "CA_x" }]);
});

test("T4: weder callControlId noch providerCallSid -> null (Hangup wird fail-safe uebersprungen)", () => {
  const spy = voiceControlSpy();
  const thunk = hangUpAction(spy, { provider: "twilio" }, null);

  assert.equal(thunk, null);
  assert.equal(spy.calls.length, 0);
});

// ---- T5: reattach reicht twilioSid=null durch (Endpunkt-Wahl bleibt downstream, s. T1) ----

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
    // KS-P1b: der Re-Attach-Kern prueft zusaetzlich die Geld-Achse. Diese Datei misst die
    // Call-Control-Fixture (twilioSid null), nicht Geld -> Achse frei = Bestandsverhalten.
    budgetAxisFor: () => null,
    terminateOverBudgetCall: async () => {},
  };
  return { deps, calls };
}

test("T5a: reattach Ueberzeit-Fixture (callControlId, twilioSid null) -> terminateCappedCall(id, null, 'failed')", async () => {
  const call = activeCallControlCall(SECONDS_400); // 400s > 180s Limit
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
  const call = activeCallControlCall(SECONDS_60); // 60s von 180s verbraucht -> Rest > 0
  const { deps, calls } = makeReattachDeps(call);

  const result = await reattachActiveCall("reattach_cc", deps);

  assert.deepEqual(result, { call });
  assert.equal(calls.terminate.length, 0);
  assert.equal(calls.schedule.length, 1);
  assert.equal(calls.schedule[0].callId, "reattach_cc");
  assert.equal(calls.schedule[0].providerCallSid, null);
  assert.ok(calls.schedule[0].ms > 0 && calls.schedule[0].ms <= MAX_DURATION_S * MS_PER_S);
});

// ---- T6-T8: Wiring-Guards (Quelltext, Muster reattach-active-call.test.js) ----

// P5 (Server-Slim): terminateCappedCall wanderte nach telephony/call-lifecycle.js.
const lifecycleSrc = fs.readFileSync(path.join(ROOT, "src", "telephony", "call-lifecycle.js"), "utf8");
// P9 (Server-Slim): die /api/calls-Route-Gruppe wanderte nach routes/api-calls.js.
const apiCallsSrc = fs.readFileSync(path.join(ROOT, "src", "routes", "api-calls.js"), "utf8");

test("T6: terminateCappedCall verwendet hangUpAction (nicht mehr das alte providerCallSid-Ternary)", () => {
  // KS-P1b: der Body liegt seither im grund-parametrisierten terminateActiveCall, das
  // terminateCappedCall (Zeit-Achse) und terminateOverBudgetCall (Geld-Achse) teilen -
  // EIN Terminalisierungspfad, INV-9 unveraendert. Der Anker wandert mit, der
  // Pruefgegenstand (hangUpAction statt Inline-Ternary) bleibt.
  const marker = "async function terminateActiveCall({ callId, providerCallSid, status, failureReason }) {";
  const block = lifecycleSrc.slice(lifecycleSrc.indexOf(marker), lifecycleSrc.indexOf(marker) + 1200);

  assert.match(block, /hangUp:\s*hangUpAction\(voiceControl,\s*call,\s*providerCallSid\)/);
  assert.doesNotMatch(
    block,
    /providerCallSid\s*\?\s*\(\)\s*=>\s*voiceControl\(call\.provider\)\.endCall/,
    "das alte inline Ternary darf nicht mehr da sein (G5: EINE Quelle ueber hangUpAction)",
  );
});

test("T7: cancel_call verwendet hangUpAction (dieselbe Quelle wie terminateCappedCall)", () => {
  const marker = 'router.post("/api/calls/:id/cancel"';
  const block = apiCallsSrc.slice(apiCallsSrc.indexOf(marker), apiCallsSrc.indexOf(marker) + 1500);

  assert.match(block, /hangUp:\s*hangUpAction\(voiceControl,\s*call,\s*call\.twilioSid\)/);
});

test("T8: C-Telnyx-Origination armiert den Max-Dauer-Timer (P6-Luecke geschlossen)", () => {
  // P6 (Struct-1, Outbound-Gate-Kette-Extraktion): outboundProvider lebt seither als
  // ctx.outboundProvider (Gate-Loop-Ergebnis) - reine Variablenquelle, kein Verhaltenswechsel.
  // P5 (Provider-Registry): der Telnyx-Literal-Vergleich wurde durch die Capability-Seam
  // (providerSupports/CAPABILITY) ersetzt - derselbe Marker-Anker, neue Quelltext-Form.
  const marker =
    "config.telnyx.telnyxAssistant.enabled && providerSupports(ctx.outboundProvider, CAPABILITY.AI_ASSISTANT)";
  const block = apiCallsSrc.slice(apiCallsSrc.indexOf(marker), apiCallsSrc.indexOf(marker) + 1500);

  assert.match(block, /armMaxDurationTimer\(call,\s*null\)/);
  assert.doesNotMatch(block, /P6-Luecke/, "die alte, bewusste Luecke darf nicht mehr dokumentiert sein");
});
