import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeCallLifecycle,
  BUDGET_FAILURE_REASON,
} from "../src/telephony/call-lifecycle.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "../src/telephony/call-termination.js";
import { reattachActiveCall as reattachActiveCallCore } from "../src/telephony/reattach.js";
import { blockingBudgetAxis, BUDGET_AXIS } from "../src/budget-gate.js";
import { cappedEndedAtMs, classifyCallTime } from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const TAKT_MS = 15000;
const TAKT_AUS = 0;
const MAX_DURATION_S = 180;
const RECENTLY_STARTED_MS = 30000;
const TERMINATION_ORDER = ["recordFailureReason", "setCallEndedAt", "endCall", "bill"];

function makeHarness({
  callId = "call_ie2",
  intervalMs = TAKT_MS,
  budgetExhausted = true,
  budgetAxis = blockingBudgetAxis,
} = {}) {
  const call = {
    id: callId,
    tenantId: "tenant_ie2",
    status: "active",
    provider: "telnyx",
    twilioSid: "CA_ie2",
    direction: "inbound",
    startedAt: new Date(Date.now() - RECENTLY_STARTED_MS).toISOString(),
    maxDurationS: MAX_DURATION_S,
  };
  const order = [];
  const budgetTimers = [];
  const capTimers = [];
  let settleBill;
  const billed = new Promise((resolve) => {
    settleBill = resolve;
  });
  const store = {
    load: () => ({ calls: [call] }),
    getCall: (id) => (id === call.id ? call : null),
    attachActiveCall: async (id) => (id === call.id ? call : null),
    setCallEndedAt: (id, status, endedAtIso) => {
      order.push("setCallEndedAt");
      call.status = status;
      call.endedAt = endedAtIso;
    },
    recordFailureReason: (id, reason) => {
      order.push("recordFailureReason");
      if (!call.failureReason) call.failureReason = reason;
    },
    activeCallsFor: () => [],
    liveBudgetExceeded: () => budgetExhausted,
  };
  const lifecycle = makeCallLifecycle({
    store,
    config: withConfigNamespaces({
      billing: {},
      budgetWatchdogIntervalMs: intervalMs,
    }),
    finishCall: () => {
      order.push("bill");
      settleBill();
    },
    releaseReserve: () => {},
    voiceControl: () => ({
      async endCall() {
        order.push("endCall");
      },
    }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    reattachActiveCallCore,
    cappedEndedAtMs,
    classifyCallTime,
    blockingBudgetAxis: budgetAxis,
    setBudgetWatchTimer: (fn, ms) => {
      budgetTimers.push({ fn, ms });
      return { unref() {} };
    },
  });
  return { lifecycle, call, order, budgetTimers, capTimers, billed };
}

async function withCapturedCapTimers(harness, body) {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    harness.capTimers.push({ fn, ms });
    return { unref() {} };
  };
  try {
    await body();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

async function fireLatest(timers) {
  const timer = timers.pop();
  assert.ok(timer, "es muss ein Timer gestellt sein, um ihn feuern zu koennen");
  timer.fn();
  await new Promise((resolve) => setImmediate(resolve));
  return timer;
}

test("IE2-1: Achse sperrt ohne Turn und ohne Werkzeugaufruf - der Takt allein beendet den Anruf mit dem Geld-Grund", async () => {
  const harness = makeHarness();
  const { call } = harness;
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    assert.equal(harness.budgetTimers.length, 1, "armMaxDurationTimer armiert AUCH die Geld-Achse");
    assert.equal(harness.budgetTimers[0].ms, TAKT_MS, "der Takt kommt aus config.safety");
    await fireLatest(harness.budgetTimers);
    await harness.billed;
  });
  assert.equal(call.status, "completed", "technisch gesundes Leg -> completed, nicht failed");
  assert.equal(call.failureReason, BUDGET_FAILURE_REASON, "der Geld-Grund steht am Record");
  assert.deepEqual(
    harness.order,
    TERMINATION_ORDER,
    "Grund vor Provider-Hangup vor Settlement - derselbe EINE Terminierungspfad",
  );
});

test("IE2-2: Achse frei - der Waechter beendet NICHTS und stellt die naechste Runde", async () => {
  const harness = makeHarness({ budgetExhausted: false });
  const { call } = harness;
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    await fireLatest(harness.budgetTimers);
  });
  assert.equal(call.status, "active", "der Anruf laeuft weiter");
  assert.equal(call.failureReason, undefined, "kein Grund geschrieben");
  assert.deepEqual(harness.order, [], "kein Hangup, kein Settlement");
  assert.equal(harness.budgetTimers.length, 1, "der Takt laeuft weiter (neue Runde gestellt)");
});

test("IE2-3: Geld-Wache und Max-Dauer-Cap ergeben GENAU EINE Terminalisierung", async () => {
  const harness = makeHarness();
  const { call } = harness;
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    await fireLatest(harness.budgetTimers);
    await harness.billed;
    await fireLatest(harness.capTimers);
  });
  assert.deepEqual(harness.order, TERMINATION_ORDER, "der Cap fuegt keine zweite Runde hinzu");
  assert.equal(
    harness.order.filter((step) => step === "endCall").length,
    1,
    "genau EIN Provider-Hangup",
  );
  assert.equal(call.failureReason, BUDGET_FAILURE_REASON, "der Geld-Grund bleibt stehen");
});

test("IE2-4: Boot-Re-Arm armiert die Geld-Wache", async () => {
  const harness = makeHarness();
  const { call } = harness;
  harness.lifecycle.rearmBudgetWatchdogs();
  assert.equal(harness.budgetTimers.length, 1, "das ueberlebende Leg bekommt genau einen Takt");
  await fireLatest(harness.budgetTimers);
  await harness.billed;
  assert.equal(call.status, "completed", "der re-armierte Takt terminalisiert wie am Anrufstart");
});

test("IE2-5: Takt 0 stellt nirgends einen Takt - der Rueckfall-Hebel ist byte-identisch zum Bestand", async () => {
  const harness = makeHarness({ intervalMs: TAKT_AUS });
  const { call } = harness;
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    harness.lifecycle.rearmBudgetWatchdogs();
  });
  assert.deepEqual(harness.budgetTimers, [], "kein Takt am Anrufstart und keiner beim Boot-Re-Arm");
  assert.equal(harness.capTimers.length, 1, "der Max-Dauer-Cap bleibt unberuehrt scharf");
  assert.equal(call.status, "active", "nichts terminalisiert");
});

test("IE2-6: erfolgreicher Re-Attach armiert den Takt (die pg-Spiegel-Luecke ist gedeckt)", async () => {
  const harness = makeHarness({ budgetExhausted: false });
  const { call } = harness;
  let result;
  await withCapturedCapTimers(harness, async () => {
    result = await harness.lifecycle.reattachActiveCall(call.id);
  });
  assert.equal(result.call?.id, call.id, "der Anruf ist wieder im Spiegel");
  assert.equal(harness.budgetTimers.length, 1, "das wiedergefundene Leg bekommt eine Geld-Wache");
});

test("IE2-7: wirft die Achse, stirbt die Wache nicht - die Runde wird neu gestellt", async () => {
  const axisFailure = new Error("Achse nicht antwortbar");
  let axisCalls = 0;
  const harness = makeHarness({
    budgetAxis: () => {
      axisCalls += 1;
      if (axisCalls === 1) throw axisFailure;
      return BUDGET_AXIS.TENANT;
    },
  });
  const { call } = harness;
  const realConsoleError = console.error;
  const errorLines = [];
  console.error = (line) => errorLines.push(line);
  try {
    await withCapturedCapTimers(harness, async () => {
      harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
      await fireLatest(harness.budgetTimers);
      assert.equal(call.status, "active", "eine gescheiterte Runde terminalisiert nichts");
      assert.equal(errorLines.length, 1, "genau EINE Fehlerzeile");
      assert.equal(harness.budgetTimers.length, 1, "die Wache stellt sich neu");
      await fireLatest(harness.budgetTimers);
      await harness.billed;
    });
  } finally {
    console.error = realConsoleError;
  }
  assert.match(errorLines[0], /Geld-Wache/, "die Zeile benennt die Wache");
  assert.match(errorLines[0], new RegExp(call.id), "mit Korrelation auf die server-generierte callId");
  assert.equal(call.status, "completed", "die zweite Runde terminalisiert");
  assert.equal(call.failureReason, BUDGET_FAILURE_REASON, "mit dem Geld-Grund");
});

test("IE2-8: doppelte Armierung desselben Anrufs stellt genau EINEN Takt (kein Timer-Leck)", async () => {
  const harness = makeHarness({ budgetExhausted: false });
  const { call } = harness;
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
  });
  assert.equal(harness.budgetTimers.length, 1, "arm() ist idempotent");
});
