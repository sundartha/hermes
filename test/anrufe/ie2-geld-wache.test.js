import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeCallLifecycle,
  BUDGET_FAILURE_REASON,
} from "../../src/telephony/call-lifecycle.ts";
import { terminateAndBillCall, hangUpAction, billThunk } from "../../src/telephony/call-termination.ts";
import { reattachActiveCall as reattachActiveCallCore } from "../../src/telephony/reattach.ts";
import { blockingBudgetAxis, BUDGET_AXIS } from "../../src/budget-gate.js";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";

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

function fristHarness(setzeHoechstdauerFrist) {
  const call = { id: "call_frist", tenantId: "tenant_frist", status: "active", twilioSid: "CA_frist", maxDurationS: 90 };
  const store = {
    load: () => ({ calls: [call] }),
    getCall: () => call,
    setzeHoechstdauerFrist,
  };
  const lifecycle = makeCallLifecycle({
    store,
    config: withConfigNamespaces({ billing: {}, budgetWatchdogIntervalMs: TAKT_AUS }),
    finishCall: () => {},
    releaseReserve: () => {},
    voiceControl: () => ({}),
    blockingBudgetAxis: () => null,
    setBudgetWatchTimer: () => ({ unref() {} }),
  });
  return { lifecycle, call };
}

test("Frist beim Anrufstart: armMaxDurationTimer schreibt Anruf, Mandant und Jetzt plus Hoechstdauer als Frist", (t) => {
  const geschrieben = [];
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2031-01-01T00:00:00.000Z") });
  const { lifecycle, call } = fristHarness(async (frist) => void geschrieben.push(frist));
  lifecycle.armMaxDurationTimer(call, call.twilioSid);
  assert.deepEqual(geschrieben, [{ callId: "call_frist", tenantId: "tenant_frist", faelligAt: "2031-01-01T00:01:30.000Z" }]);
});

test("Frist beim Anrufstart: scheitert das Schreiben, steht der Fehler mit Anruf-ID im Log und der Anrufstart laeuft weiter", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { lifecycle, call } = fristHarness(() => Promise.reject(new Error("schreiben verweigert")));
  lifecycle.armMaxDurationTimer(call, call.twilioSid);
  await new Promise((fertig) => setImmediate(fertig));
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("[fristen]")), ["[fristen] Hoechstdauer-Frist schreiben fehlgeschlagen: call_frist Error: schreiben verweigert"]);
});

function fristEl({ ohneKonversation }) {
  return {
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    elevenlabsConversationId: ohneKonversation ? null : "conv_ende",
  };
}

function fristBetrieb({ el = false, ohneCarrier = false, unbeantwortet = false, ohneKonversation = false } = {}) {
  const row = {
    id: "call_ende",
    tenantId: "tenant_ende",
    status: "active",
    provider: "telnyx",
    twilioSid: ohneCarrier ? "" : "CA_ende",
    direction: el ? "outbound" : "inbound",
    startedAt: "2026-01-01T00:00:00.000Z",
    answeredAt: unbeantwortet ? null : "2026-01-01T00:00:00.000Z",
    maxDurationS: MAX_DURATION_S,
    ...(el ? fristEl({ ohneKonversation }) : {}),
  };
  return { row, hangups: [], rechnungen: [], elEnden: [], elFehler: false };
}

function fristProzess(betrieb, { elEndeVerdrahtet = true } = {}) {
  const spiegel = [];
  const store = {
    load: () => ({ calls: spiegel }),
    getCall: (id) => spiegel.find((call) => call.id === id) ?? null,
    attachActiveCall: async (id) => {
      if (betrieb.row.status !== "active" || id !== betrieb.row.id) return null;
      if (!spiegel.some((call) => call.id === id)) spiegel.push({ ...betrieb.row });
      return spiegel.find((call) => call.id === id);
    },
    setCallEndedAt: async (id, status, endedAtIso) => {
      const call = spiegel.find((eintrag) => eintrag.id === id);
      Object.assign(call, { status, endedAt: endedAtIso });
      if (betrieb.row.status === "active") Object.assign(betrieb.row, { status, endedAt: endedAtIso });
    },
    recordFailureReason: (id, reason) => {
      spiegel.find((eintrag) => eintrag.id === id).failureReason = reason;
      if (!betrieb.row.failureReason) Object.assign(betrieb.row, { failureReason: reason });
    },
    activeCallsFor: () => [],
    liveBudgetExceeded: () => false,
  };
  const lifecycle = makeCallLifecycle({
    store,
    config: withConfigNamespaces({ billing: {}, budgetWatchdogIntervalMs: TAKT_MS }),
    finishCall: (call) => {
      betrieb.rechnungen.push(call.id);
    },
    releaseReserve: () => {},
    voiceControl: () => ({
      async endCall(sid) {
        betrieb.hangups.push(sid);
      },
    }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    endActiveCall: elEndeVerdrahtet
      ? async (id) => {
          betrieb.elEnden.push(id);
          if (betrieb.elFehler) throw new Error("el weg");
        }
      : null,
    awaitAndPersistInboundElResult: async () => {},
    reattachActiveCallCore,
    cappedEndedAtMs,
    classifyCallTime,
    blockingBudgetAxis,
    setBudgetWatchTimer: () => ({ unref() {} }),
  });
  return { store, lifecycle };
}

async function fristAbgelaufen(betrieb, optionen) {
  const prozess = fristProzess(betrieb, optionen);
  const call = await prozess.store.attachActiveCall("call_ende");
  await prozess.lifecycle.terminateExpiredCall(call);
  await new Promise((fertig) => setImmediate(fertig));
  return prozess;
}

test("Frist-Ende: ein abgelaufener Anruf endet als failed mit dem Kappungsgrund, einmal aufgelegt, einmal abgerechnet", async () => {
  const betrieb = fristBetrieb();
  await fristAbgelaufen(betrieb);
  assert.equal(betrieb.row.status, "failed");
  assert.equal(betrieb.row.failureReason, "max-duration-cap");
  assert.deepEqual(betrieb.hangups, ["CA_ende"]);
  assert.deepEqual(betrieb.rechnungen, ["call_ende"]);
});

test("Frist-Ende: hat der Lauf eines anderen Prozesses den Anruf beendet, loest der Timer des Besitzers keinen zweiten Hangup und keine zweite Abrechnung aus", async () => {
  const betrieb = fristBetrieb();
  const besitzer = fristProzess(betrieb);
  const call = await besitzer.store.attachActiveCall("call_ende");
  const timer = [];
  const echt = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => {
    timer.push(fn);
    return { unref() {} };
  };
  try {
    besitzer.lifecycle.armMaxDurationTimer(call, call.twilioSid);
  } finally {
    globalThis.setTimeout = echt;
  }
  await fristAbgelaufen(betrieb);
  timer[0]();
  await new Promise((fertig) => setImmediate(fertig));
  assert.deepEqual(betrieb.hangups, ["CA_ende"]);
  assert.deepEqual(betrieb.rechnungen, ["call_ende"]);
});

test("Frist-Ende: ist die Datenbank beim Beenden nicht lesbar, endet der Anruf trotzdem", async () => {
  const betrieb = fristBetrieb();
  const besitzer = fristProzess(betrieb);
  const call = await besitzer.store.attachActiveCall("call_ende");
  besitzer.store.attachActiveCall = async () => {
    throw new Error("db nicht erreichbar");
  };
  await besitzer.lifecycle.terminateExpiredCall(call);
  assert.equal(betrieb.row.status, "failed");
  assert.deepEqual(betrieb.hangups, ["CA_ende"]);
});

test("Frist-Ende: ausgehender EL-Anruf ohne Auflegeweg zum Netz loescht die EL-Konversation, der Anruf endet", async () => {
  const betrieb = fristBetrieb({ el: true, ohneCarrier: true });
  await fristAbgelaufen(betrieb);
  assert.deepEqual(betrieb.elEnden, ["call_ende"]);
  assert.equal(betrieb.row.status, "failed");
  assert.deepEqual(betrieb.rechnungen, ["call_ende"]);
});

test("Frist-Ende: scheitert das Loeschen der EL-Konversation, steht der Fehler mit Anruf-ID im Log und der Anruf endet trotzdem", async (t) => {
  const betrieb = fristBetrieb({ el: true, ohneCarrier: true });
  betrieb.elFehler = true;
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await fristAbgelaufen(betrieb);
  assert.equal(betrieb.row.status, "failed");
  assert.deepEqual(
    zeilen.filter((zeile) => zeile.startsWith("[fristen]")),
    ["[fristen] EL-Konversation loeschen fehlgeschlagen: call_ende el weg"],
  );
});

test("Frist-Ende: ein EL-Anruf mit Weg zum Netz wird dort aufgelegt, die EL-Konversation loescht der Lauf nicht selbst", async () => {
  const betrieb = fristBetrieb({ el: true });
  await fristAbgelaufen(betrieb);
  assert.deepEqual(betrieb.hangups, ["CA_ende"]);
  assert.deepEqual(betrieb.elEnden, []);
});

test("Frist-Ende: ein Anruf ohne EL-Konversation und ohne Auflegeweg endet, ohne dass eine EL-Konversation geloescht wird", async () => {
  const betrieb = fristBetrieb({ el: true, ohneCarrier: true, ohneKonversation: true });
  await fristAbgelaufen(betrieb);
  assert.deepEqual(betrieb.elEnden, []);
  assert.equal(betrieb.row.status, "failed");
});

test("Frist-Ende: ein EL-Anruf, den der EL-Weg selbst auflegt, wird genau einmal ueber ihn beendet", async () => {
  const betrieb = fristBetrieb({ el: true, ohneCarrier: true, unbeantwortet: true });
  await fristAbgelaufen(betrieb);
  assert.deepEqual(betrieb.elEnden, ["call_ende"]);
  assert.equal(betrieb.row.status, "failed");
});

test("Frist-Ende: ohne verdrahtetes EL-Ende endet der Anruf ohne Weg zum Netz trotzdem", async () => {
  const betrieb = fristBetrieb({ el: true, ohneCarrier: true });
  await fristAbgelaufen(betrieb, { elEndeVerdrahtet: false });
  assert.equal(betrieb.row.status, "failed");
});
