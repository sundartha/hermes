// IE2 (PLAN-INBOUND-PARITAET.md, "Die Geld-Achse bekommt einen Herzschlag"): der
// wiederkehrende Geld-Waechter. B8 war der Befund: blockingBudgetAxis wird nur aus vier
// EREIGNISGEBUNDENEN Stellen gefragt (Turn-Runde, Shim-Turn, EL-Werkzeug-Webhook,
// /voice/*-Re-Attach) - ein Anruf ohne Turn und ohne Werkzeugaufruf erreicht die
// pro-Tenant-Decke NIE. Genau diesen Fall gab es bisher als Test nicht.
//
// Gefahren wird gegen die ECHTE Verdrahtung (Muster und Begruendung: test/budget-failure-
// reason.test.js): makeCallLifecycle() + der echte reattachActiveCallCore + die echte
// blockingBudgetAxis + die echte terminateAndBillCall/hangUpAction/billThunk. Gefaelscht
// sind nur die beiden Geld-Achse-Primitiven des Stores (activeCallsFor/liveBudgetExceeded) -
// nicht die Entscheidung selbst.
//
// Zwei Uhren, zwei Listen, keine Wanduhr (P12 Repeatable, T9 Fast):
//   budgetTimers - der TAKT der Geld-Wache, ueber den DI-Parameter setBudgetWatchTimer.
//   capTimers    - der Max-Dauer-Cap, der bewusst NICHT injizierbar ist (Begruendung an
//                  der Signatur in call-lifecycle.js). Er wird fuer die Dauer EINES Tests
//                  ueber die globale Uhr eingefangen und in finally zurueckgegeben. Ohne
//                  das haengt die Datei an einem echten 180-s-setTimeout, den kein Test
//                  mehr abraeumen kann (gemessen: node --test wartet die volle Frist ab).
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

const TAKT_MS = 15000; // derselbe Wert, den config.js ausliefert
const TAKT_AUS = 0; // dokumentierter Rueckfall-Hebel
const MAX_DURATION_S = 180;
const RECENTLY_STARTED_MS = 30000; // 30 s, deutlich unter MAX_DURATION_S -> NICHT expired
const TERMINATION_ORDER = ["recordFailureReason", "setCallEndedAt", "endCall", "bill"];

// Der Anruf-Datensatz UND sein Spy-Store entstehen gemeinsam in makeHarness: der Store
// schreibt beim Terminalisieren an den Datensatz (setCallEndedAt/recordFailureReason), und
// genau dieser Datensatz ist danach der Pruefgegenstand. Gefaelscht sind nur die beiden
// Geld-Achse-Primitiven (activeCallsFor/liveBudgetExceeded) - nicht die Entscheidung.
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
    // Inbound: die Richtung, die B8 ueberhaupt erst zum Befund gemacht hat (ein Anrufer,
    // der nur eine Nachricht hinterlaesst, erzeugt weder Turn noch Werkzeugaufruf).
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
    }, // Settlement-Latch statt Timer-Warten
    releaseReserve: () => {},
    voiceControl: () => ({
      async endCall() {
        order.push("endCall");
      },
    }),
    terminateAndBillCall, // echte Orchestrierung (Reihenfolge ist Pruefgegenstand)
    hangUpAction,
    billThunk,
    reattachActiveCallCore, // echter Kern (reattach.js), kein Spy
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

// Faengt die NICHT injizierbaren Cap-Timer fuer die Dauer des Testkoerpers ein (s.
// Dateikopf). Wiederherstellung in finally - die Tests einer Datei laufen bei node:test
// sequenziell, die Ersetzung reicht also nie in einen anderen Test hinein.
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

// Eine Takt-Runde: den zuletzt gestellten Timer feuern und die Microtasks der
// (asynchronen) Runde ausspielen. setImmediate statt setTimeout - es ueberlebt die
// eingefangene globale Uhr.
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
    // Jetzt der ZEIT-Pfad auf denselben, inzwischen beendeten Anruf.
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
      // Runde 2: die Achse antwortet wieder - und sperrt.
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
