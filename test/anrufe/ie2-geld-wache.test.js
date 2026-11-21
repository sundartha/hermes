import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeCallLifecycle,
  BUDGET_FAILURE_REASON,
} from "../../src/telephony/call-lifecycle.ts";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";
import { terminateAndBillCall, hangUpAction, billThunk } from "../../src/telephony/call-termination.ts";
import { reattachActiveCall as reattachActiveCallCore } from "../../src/telephony/reattach.ts";
import { blockingBudgetAxis, BUDGET_AXIS } from "../../src/budget-gate.js";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";

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
  storeErgaenzung = {},
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
    ...storeErgaenzung,
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
  });
  return { lifecycle, call, order, capTimers, billed, store };
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

test("IE2-1: Achse sperrt ohne Turn und ohne Werkzeugaufruf - der Takt des Fristenlaufs allein beendet den Anruf mit dem Geld-Grund", async () => {
  const harness = makeHarness();
  const { call } = harness;
  const { lauf } = geldLauf(harness);
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    assert.deepEqual(harness.capTimers, [], "armMaxDurationTimer stellt keine Geld-Achse im Speicher");
    await lauf.geldTakt();
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

test("IE2-2: Achse frei - der Lauf beendet NICHTS und schreibt die naechste Pruefung", async () => {
  const harness = makeHarness({ budgetExhausted: false });
  const { call } = harness;
  const { lauf, geldFristen } = geldLauf(harness);
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    await lauf.geldTakt();
  });
  assert.equal(call.status, "active", "der Anruf laeuft weiter");
  assert.equal(call.failureReason, undefined, "kein Grund geschrieben");
  assert.deepEqual(harness.order, [], "kein Hangup, kein Settlement");
  assert.equal(geldFristen.length, 1, "die naechste Runde steht als Frist an der Zeile");
});

test("IE2-3: Geld-Wache und Max-Dauer-Cap ergeben GENAU EINE Terminalisierung", async () => {
  const harness = makeHarness();
  const { call } = harness;
  const { lauf } = geldLauf(harness);
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    await lauf.geldTakt();
    await harness.billed;
    await harness.lifecycle.terminateExpiredCall(call);
  });
  assert.deepEqual(harness.order, TERMINATION_ORDER, "der Cap fuegt keine zweite Runde hinzu");
  assert.equal(
    harness.order.filter((step) => step === "endCall").length,
    1,
    "genau EIN Provider-Hangup",
  );
  assert.equal(call.failureReason, BUDGET_FAILURE_REASON, "der Geld-Grund bleibt stehen");
});

test("IE2-4: der Fristen-Lauf beendet ein ueberlebendes Leg ueber der Kostendecke, ohne dass ein Takt neu gestellt wird", async () => {
  const harness = makeHarness();
  const { call } = harness;
  await withCapturedCapTimers(harness, async () => {
    await harness.lifecycle.terminateOverBudgetExpired(call);
    await harness.billed;
  });
  assert.deepEqual(harness.capTimers, [], "kein Takt im Speicher des Prozesses");
  assert.equal(call.status, "completed", "der Lauf terminalisiert wie der Takt am Anrufstart");
  assert.equal(call.failureReason, BUDGET_FAILURE_REASON);
});

test("IE2-5: Takt 0 stellt nirgends einen Takt - der Rueckfall-Hebel ist byte-identisch zum Bestand", async () => {
  const harness = makeHarness({ intervalMs: TAKT_AUS });
  const { call } = harness;
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
  });
  assert.deepEqual(harness.capTimers, [], "der Max-Dauer-Cap steht als Frist in der Datenbank, nicht als Timer im Prozess");
  assert.equal(call.status, "active", "nichts terminalisiert");
});

test("IE2-6: erfolgreicher Re-Attach stellt keinen Takt im Prozess (die pg-Spiegel-Luecke deckt der Fristenlauf)", async () => {
  const harness = makeHarness({ budgetExhausted: false });
  const { call } = harness;
  let result;
  await withCapturedCapTimers(harness, async () => {
    result = await harness.lifecycle.reattachActiveCall(call.id);
  });
  assert.equal(result.call?.id, call.id, "der Anruf ist wieder im Spiegel");
  assert.deepEqual(harness.capTimers, [], "das wiedergefundene Leg bekommt keinen Timer im Prozess");
});

test("IE2-7: wirft die Achse, bleibt der Anruf offen und der naechste Takt des Fristenlaufs beendet ihn", async () => {
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
  const { lauf } = geldLauf(harness);
  const realConsoleError = console.error;
  const errorLines = [];
  console.error = (line) => errorLines.push(line);
  try {
    await withCapturedCapTimers(harness, async () => {
      harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
      assert.deepEqual(await lauf.geldTakt(), { beendet: 0, offen: 1, gelesen: true });
      assert.equal(call.status, "active", "eine gescheiterte Runde terminalisiert nichts");
      assert.equal(errorLines.length, 1, "genau EINE Fehlerzeile");
      assert.deepEqual(harness.capTimers, [], "kein Timer im Prozess");
      await lauf.geldTakt();
      await harness.billed;
    });
  } finally {
    console.error = realConsoleError;
  }
  assert.match(errorLines[0], /Beenden fehlgeschlagen/, "die Zeile benennt den Fehlschlag");
  assert.match(errorLines[0], new RegExp(call.id), "mit Korrelation auf die server-generierte callId");
  assert.equal(call.status, "completed", "die zweite Runde terminalisiert");
  assert.equal(call.failureReason, BUDGET_FAILURE_REASON, "mit dem Geld-Grund");
});

test("IE2-8: doppelte Armierung desselben Anrufs stellt keinen Timer im Prozess (kein Timer-Leck)", async () => {
  const harness = makeHarness({ budgetExhausted: false });
  const { call } = harness;
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
  });
  assert.deepEqual(harness.capTimers, [], "kein Timer im Prozess");
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
  await fristAbgelaufen(betrieb);
  await besitzer.lifecycle.terminateExpiredCall(call);
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

test("Frist-Ende: hat ein anderer Prozess den Anruf beendet, steht er beim Besitzer nicht mehr als aktiv und es gab genau einen Hangup", async () => {
  const betrieb = fristBetrieb();
  const besitzer = fristProzess(betrieb);
  const call = await besitzer.store.attachActiveCall("call_ende");
  await fristAbgelaufen(betrieb);
  await besitzer.lifecycle.terminateExpiredCall(call);
  assert.notEqual(besitzer.store.getCall("call_ende").status, "active");
  assert.equal(betrieb.hangups.length, 1);
});

const LANGE_HER_MS = 900000;

function neuerAnruf(id, tenantId, startedMsAgo = RECENTLY_STARTED_MS) {
  return {
    id,
    tenantId,
    status: "active",
    provider: "telnyx",
    twilioSid: `CA_${id}`,
    direction: "inbound",
    startedAt: new Date(Date.now() - startedMsAgo).toISOString(),
    maxDurationS: MAX_DURATION_S,
  };
}

function lesefehlerHarness({ lese, storeErgaenzung = {}, calls = [neuerAnruf("call_lf", "tenant_lf")] }) {
  const [call] = calls;
  const order = [];
  const capTimers = [];
  let settleBill;
  const billed = new Promise((resolve) => {
    settleBill = resolve;
  });
  const store = {
    load: () => ({ calls: [], tenants: [] }),
    getCall: () => call,
    leseCall: lese(call),
    attachActiveCall: async () => call,
    setCallEndedAt: (_id, status) => {
      order.push("setCallEndedAt");
      call.status = status;
    },
    recordFailureReason: (_id, reason) => {
      order.push("recordFailureReason");
      call.failureReason ??= reason;
    },
    activeCallsFor: () => [],
    liveBudgetExceeded: () => true,
    ...storeErgaenzung,
  };
  const lifecycle = makeCallLifecycle({
    store,
    config: withConfigNamespaces({ billing: {}, budgetWatchdogIntervalMs: TAKT_MS }),
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
    blockingBudgetAxis: () => "budget_tenant",
  });
  return { lifecycle, call, order, capTimers, billed, store };
}

async function mitErfasstenFristenUndFehlern(harness, body) {
  const echtesError = console.error;
  const fehlerzeilen = [];
  console.error = (...teile) => fehlerzeilen.push(teile.join(" "));
  try {
    await withCapturedCapTimers(harness, () => body(fehlerzeilen));
  } finally {
    console.error = echtesError;
  }
}

test("Hoechstdauer: wirft der Leser, bleibt der Anruf aktiv und der Prozess plant keinen eigenen neuen Versuch", async () => {
  let versuche = 0;
  const harness = lesefehlerHarness({
    lese: (call) => async () => {
      versuche += 1;
      if (versuche === 1) throw new Error("Datenbank nicht erreichbar");
      return call;
    },
  });
  await mitErfasstenFristenUndFehlern(harness, async (fehlerzeilen) => {
    await harness.lifecycle.terminateExpiredCall(harness.call);
    assert.equal(harness.call.status, "active", "ein Lesefehler gibt den Anruf nicht frei");
    assert.deepEqual(harness.order, [], "nichts beendet, nichts gebucht");
    assert.deepEqual(harness.capTimers, [], "kein Timer im Prozess");
    assert.equal(fehlerzeilen.length, 1);
    assert.equal(fehlerzeilen[0], "[max-duration] Anruf nicht lesbar: call_lf Datenbank nicht erreichbar");
    await harness.lifecycle.terminateExpiredCall(harness.call);
    await harness.billed;
  });
  assert.equal(harness.call.status, "completed", "ein weiterer Aufruf des Laufs beendet den Anruf");
  assert.equal(versuche, 2);
});

test("Hoechstdauer: liest der Leser den Anruf als nicht aktiv, endet die Frist still ohne neuen Versuch", async () => {
  const harness = lesefehlerHarness({ lese: () => async () => null });
  await mitErfasstenFristenUndFehlern(harness, async (fehlerzeilen) => {
    await harness.lifecycle.terminateExpiredCall(harness.call);
    assert.deepEqual(harness.capTimers, [], "kein neuer Versuch");
    assert.deepEqual(fehlerzeilen, []);
  });
  assert.deepEqual(harness.order, []);
  assert.equal(harness.call.status, "active");
});

test("Geld-Wache: wirft der Leser, bleibt der Anruf aktiv und der naechste Takt des Fristenlaufs beendet ihn", async () => {
  let versuche = 0;
  const harness = lesefehlerHarness({
    lese: (call) => async () => {
      versuche += 1;
      if (versuche === 1) throw new Error("Lesen kaputt");
      return call;
    },
  });
  const { lauf } = geldLauf(harness);
  await mitErfasstenFristenUndFehlern(harness, async (fehlerzeilen) => {
    harness.lifecycle.armMaxDurationTimer(harness.call, harness.call.twilioSid);
    assert.deepEqual(await lauf.geldTakt(), { beendet: 0, offen: 1, gelesen: true });
    assert.equal(harness.call.status, "active");
    assert.deepEqual(harness.order, []);
    assert.deepEqual(harness.capTimers, [], "kein Timer im Prozess");
    assert.match(fehlerzeilen.join("\n"), /\[max-duration\] Anruf nicht lesbar: call_lf Lesen kaputt/);
    await lauf.geldTakt();
    await harness.billed;
  });
  assert.equal(harness.call.status, "completed");
  assert.equal(harness.call.failureReason, BUDGET_FAILURE_REASON);
});

test("Geld-Wache: bei langsamem Leser beendet der Lauf den Anruf ueber der Kostendecke trotzdem, mit genau einer Lesung", async () => {
  let lesevorgaenge = 0;
  let oeffne;
  const offen = new Promise((resolve) => {
    oeffne = resolve;
  });
  const harness = lesefehlerHarness({
    lese: (call) => async () => {
      lesevorgaenge += 1;
      await offen;
      return call;
    },
  });
  const { lauf } = geldLauf(harness);
  await mitErfasstenFristenUndFehlern(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(harness.call, harness.call.twilioSid);
    const takt = lauf.geldTakt();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lesevorgaenge, 1);
    assert.equal(harness.call.status, "active", "solange der Zugriff offen ist, ist nichts entschieden");
    assert.deepEqual(harness.capTimers, [], "kein Timer im Prozess");
    oeffne();
    await takt;
    await harness.billed;
  });
  assert.equal(lesevorgaenge, 1, "die Beendigung liest den Anruf genau einmal");
  assert.equal(harness.call.status, "completed");
  assert.equal(harness.call.failureReason, BUDGET_FAILURE_REASON);
  assert.deepEqual(harness.order, ["recordFailureReason", "setCallEndedAt", "endCall", "bill"]);
});

function neustartHarness() {
  const alleAnrufe = [neuerAnruf("call_t1", "tenant_1"), neuerAnruf("call_t2", "tenant_2", LANGE_HER_MS)];
  return lesefehlerHarness({
    lese: () => async () => null,
    calls: alleAnrufe,
    storeErgaenzung: { load: () => ({ calls: alleAnrufe }) },
  });
}

function neustartLauf(harness, { faellig }) {
  const alleAnrufe = harness.store.load().calls;
  const anruf = (id) => alleAnrufe.find((call) => call.id === id);
  const beendet = [];
  const beende = (art, status) => async (call) => {
    beendet.push([art, call.id]);
    anruf(call.id).status = status;
  };
  const lauf = makeFristenLauf({
    store: {
      faelligeFristen: async ({ art }) => {
        if (!faellig[art]) throw new Error("Start ohne Datenbank");
        return faellig[art].map((callId) => ({ callId, tenantId: anruf(callId).tenantId, versuche: 1 }));
      },
      getCall: anruf,
      attachActiveCall: async (id) => anruf(id),
      setzeGeldFrist: async () => {},
    },
    beende: beende("hoechstdauer", "failed"),
    geld: {
      intervalMs: TAKT_MS,
      jetzt: Date.now,
      blockingAxisFor: harness.lifecycle.blockingAxisFor,
      beende: beende("geld", "completed"),
    },
    abgelaufeneHier: harness.lifecycle.abgelaufeneAktive,
    limitJeMandant: 5,
    leaseMs: TAKT_MS,
  });
  return { lauf, beendet };
}

test("Neustart: Hoechstdauer und Geld-Wache kommen aus der Datenbank, der Lauf beendet ohne neu gestellte Timer", async () => {
  const harness = neustartHarness();
  const { lauf, beendet } = neustartLauf(harness, { faellig: { hoechstdauer: ["call_t2"], geld: ["call_t1"] } });
  await mitErfasstenFristenUndFehlern(harness, async () => {
    await lauf.takt();
    await lauf.geldTakt();
  });
  assert.deepEqual(beendet, [["hoechstdauer", "call_t2"], ["geld", "call_t1"]]);
  assert.deepEqual(harness.capTimers, [], "keine Frist im Speicher des Prozesses");
});

test("Neustart: ein Lesefehler im Lauf beendet nach dem zweiten Takt den abgelaufenen Anruf dieses Prozesses, den laufenden nie", async () => {
  const harness = neustartHarness();
  const { lauf, beendet } = neustartLauf(harness, { faellig: {} });
  await mitErfasstenFristenUndFehlern(harness, async (fehlerzeilen) => {
    await lauf.takt();
    assert.deepEqual(beendet, [], "ein einzelner Lesefehler beendet keinen Anruf");
    await lauf.takt();
    assert.match(fehlerzeilen.join("\n"), /Start ohne Datenbank/);
  });
  assert.deepEqual(beendet, [["hoechstdauer", "call_t2"]]);
  assert.deepEqual(harness.capTimers, []);
});

test("Neustart: ohne faellige Frist beendet der Lauf nichts, schreibt keine Logzeile und stellt keinen Timer", async (t) => {
  const harness = neustartHarness();
  const { lauf, beendet } = neustartLauf(harness, { faellig: { hoechstdauer: [], geld: [] } });
  const zeilen = [];
  t.mock.method(console, "log", (...args) => {
    zeilen.push(args.join(" "));
  });
  await mitErfasstenFristenUndFehlern(harness, async () => {
    await lauf.takt();
    await lauf.geldTakt();
  });
  assert.deepEqual(zeilen, []);
  assert.deepEqual(beendet, []);
  assert.deepEqual(harness.capTimers, []);
});

const GNADE_MS = 45_000;

function reserveHarness(setzeReserveFrist, { maxDurationS = 90 } = {}) {
  const call = { id: "call_rf", tenantId: "tenant_rf", status: "active", twilioSid: "CA_rf", maxDurationS };
  const freigaben = [];
  const store = { load: () => ({ calls: [call] }), getCall: () => call, setzeReserveFrist };
  const lifecycle = makeCallLifecycle({
    store,
    config: withConfigNamespaces({ billing: {}, budgetWatchdogIntervalMs: 0, reserveReleaseGraceMs: GNADE_MS }),
    finishCall: () => {},
    releaseReserve: (angefragt) => void freigaben.push(angefragt),
    voiceControl: () => ({}),
    blockingBudgetAxis: () => null,
  });
  return { lifecycle, call, freigaben };
}

test("Reserve-Frist beim Anrufstart: armReserveReleaseTimer schreibt Anruf, Mandant und Jetzt plus Hoechstdauer plus Gnadenfrist", (t) => {
  const geschrieben = [];
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2031-01-01T00:00:00.000Z") });
  const { lifecycle, call } = reserveHarness(async (frist) => void geschrieben.push(frist));
  lifecycle.armReserveReleaseTimer(call);
  assert.deepEqual(geschrieben, [{ callId: "call_rf", tenantId: "tenant_rf", faelligAt: "2031-01-01T00:02:15.000Z" }]);
});

test("Reserve-Frist beim Anrufstart: ein Anruf ohne eigene Hoechstdauer bekommt die Kappung als Hoechstdauer", (t) => {
  const geschrieben = [];
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2031-01-01T00:00:00.000Z") });
  const { lifecycle, call } = reserveHarness(async (frist) => void geschrieben.push(frist), { maxDurationS: 0 });
  lifecycle.armReserveReleaseTimer(call);
  assert.deepEqual(geschrieben, [{ callId: "call_rf", tenantId: "tenant_rf", faelligAt: "2031-01-01T00:30:45.000Z" }]);
});

test("Reserve-Frist beim Anrufstart: scheitert das Schreiben, steht der Fehler mit Anruf-ID im Log und der Timer bleibt gestellt", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { lifecycle, call, freigaben } = reserveHarness(() => Promise.reject(new Error("schreiben verweigert")));
  lifecycle.armReserveReleaseTimer(call);
  await new Promise((fertig) => setImmediate(fertig));
  assert.deepEqual(
    zeilen.filter((zeile) => zeile.startsWith("[fristen]")),
    ["[fristen] Reserve-Frist schreiben fehlgeschlagen: call_rf Error: schreiben verweigert"],
  );
  t.mock.timers.tick(90_000 + GNADE_MS);
  assert.deepEqual(freigaben, []);
});

test("Reserve-Frist beim Anrufstart: ohne Schreib-Methode am Speicher laeuft der Timer wie bisher", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { lifecycle, call, freigaben } = reserveHarness(undefined);
  lifecycle.armReserveReleaseTimer(call);
  t.mock.timers.tick(90_000 + GNADE_MS);
  assert.deepEqual(freigaben, []);
});

test("Reserve-Frist beim Anrufstart: die Freigabe nach Ablauf bekommt den aktuellen Stand des Anrufs aus dem Speicher", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { lifecycle, call, freigaben } = reserveHarness(undefined);
  lifecycle.armReserveReleaseTimer({ ...call, status: "ringing" });
  t.mock.timers.tick(90_000 + GNADE_MS);
  assert.deepEqual(freigaben, []);
});

test("Hoechstdauer-Frist: der Anrufstart stellt keinen Timer im Prozess, die Hoechstdauer steht nur als Frist", async () => {
  const geschrieben = [];
  const harness = makeHarness({ budgetExhausted: false, storeErgaenzung: { setzeHoechstdauerFrist: async (frist) => void geschrieben.push(frist) } });
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(harness.call, harness.call.twilioSid);
  });
  assert.deepEqual(harness.capTimers, []);
  assert.equal(geschrieben.length, 1);
  assert.equal(harness.call.status, "active");
});

test("Hoechstdauer-Frist: die Wiederanbindung schreibt die Restzeit als Frist und stellt keinen Timer im Prozess", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2031-01-01T00:00:00.000Z") });
  const geschrieben = [];
  const harness = makeHarness({ budgetExhausted: false, storeErgaenzung: { setzeHoechstdauerFrist: async (frist) => void geschrieben.push(frist) } });
  let ergebnis;
  await withCapturedCapTimers(harness, async () => {
    ergebnis = await harness.lifecycle.reattachActiveCall(harness.call.id);
  });
  assert.equal(ergebnis.call?.id, harness.call.id);
  assert.deepEqual(harness.capTimers, []);
  assert.deepEqual(geschrieben, [{ callId: "call_ie2", tenantId: "tenant_ie2", faelligAt: "2031-01-01T00:02:30.000Z" }]);
});

function geldLauf(harness, { geldFaellig = true } = {}) {
  const { call } = harness;
  const geldFristen = [];
  const lauf = makeFristenLauf({
    store: {
      faelligeFristen: async () => [{ callId: call.id, tenantId: call.tenantId, versuche: 1 }],
      getCall: harness.store.getCall,
      attachActiveCall: harness.store.attachActiveCall,
      setzeGeldFrist: async (frist) => void geldFristen.push(frist),
    },
    beende: harness.lifecycle.terminateExpiredCall,
    geld: geldFaellig
      ? {
          intervalMs: TAKT_MS,
          jetzt: () => 1_000_000,
          blockingAxisFor: harness.lifecycle.blockingAxisFor,
          beende: harness.lifecycle.terminateOverBudgetExpired,
        }
      : undefined,
    limitJeMandant: 5,
    leaseMs: TAKT_MS,
  });
  return { lauf, geldFristen };
}

test("Geld-Wache an der Zeile: Anrufstart und Wiederanbindung stellen keinen Timer im Prozess, der Lauf beendet den Anruf ueber der Kostendecke", async () => {
  let gesperrt = false;
  const harness = makeHarness({ budgetAxis: () => (gesperrt ? BUDGET_AXIS.TENANT : null) });
  const { call } = harness;
  const { lauf } = geldLauf(harness);
  await withCapturedCapTimers(harness, async () => {
    harness.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    await harness.lifecycle.reattachActiveCall(call.id);
  });
  gesperrt = true;
  assert.deepEqual(harness.capTimers, [], "weder Anrufstart noch Wiederanbindung stellen eine Geld-Wache im Speicher");
  assert.equal(call.status, "active", "ohne Lauf endet nichts");
  assert.deepEqual(await lauf.geldTakt(), { beendet: 1, offen: 0, gelesen: true });
  assert.equal(call.status, "completed");
  assert.equal(call.failureReason, BUDGET_FAILURE_REASON);
  assert.deepEqual(harness.order, TERMINATION_ORDER);
});

test("Geld-Wache an der Zeile: unter der Kostendecke schreibt der Lauf die naechste Pruefung im Abstand des Takts und beendet nichts", async () => {
  const harness = makeHarness({ budgetExhausted: false });
  const { lauf, geldFristen } = geldLauf(harness);
  assert.deepEqual(await lauf.geldTakt(), { beendet: 0, offen: 0, gelesen: true });
  assert.equal(harness.call.status, "active");
  assert.deepEqual(geldFristen, [
    { callId: harness.call.id, tenantId: harness.call.tenantId, faelligAt: new Date(1_000_000 + TAKT_MS).toISOString() },
  ]);
});

test("Hoechstdauer: wirft der Leser, plant der Prozess keinen neuen Versuch, der naechste Takt des Fristenlaufs beendet den Anruf", async () => {
  let versuche = 0;
  const harness = lesefehlerHarness({
    lese: (call) => async () => {
      versuche += 1;
      if (versuche === 1) throw new Error("Datenbank nicht erreichbar");
      return call;
    },
  });
  const { lauf } = geldLauf(harness, { geldFaellig: false });
  await mitErfasstenFristenUndFehlern(harness, async (fehlerzeilen) => {
    assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 1, gelesen: true });
    assert.equal(harness.call.status, "active", "ein Lesefehler gibt den Anruf nicht frei");
    assert.deepEqual(harness.capTimers, [], "kein Timer im Prozess");
    assert.deepEqual(fehlerzeilen, ["[max-duration] Anruf nicht lesbar: call_lf Datenbank nicht erreichbar"]);
    assert.deepEqual(await lauf.takt(), { beendet: 1, offen: 0, gelesen: true });
  });
  assert.equal(harness.call.status, "completed");
  assert.equal(versuche, 2);
});

test("Frist-Ende: hat ein anderer Prozess den Anruf mit anderem Status und Grund beendet, behaelt der Spiegel des Besitzers die Werte der Datenbankzeile und die Pruefung fragt im Mandanten des Anrufs", async () => {
  const betrieb = fristBetrieb();
  const besitzer = fristProzess(betrieb);
  const call = await besitzer.store.attachActiveCall("call_ende");
  const abfragen = [];
  besitzer.store.attachActiveCall = async (id, optionen) => {
    abfragen.push(optionen);
    Object.assign(betrieb.row, { status: "completed", endedAt: "2026-01-01T00:05:00.000Z", failureReason: "budget-exhausted" });
    Object.assign(call, betrieb.row);
    return null;
  };
  await besitzer.lifecycle.terminateExpiredCall(call);
  await new Promise((fertig) => setImmediate(fertig));
  assert.deepEqual(abfragen, [{ mandant: "tenant_ende" }]);
  const spiegel = besitzer.store.getCall("call_ende");
  assert.equal(spiegel.status, "completed");
  assert.equal(spiegel.endedAt, "2026-01-01T00:05:00.000Z");
  assert.equal(spiegel.failureReason, "budget-exhausted");
  assert.deepEqual(betrieb.hangups, []);
});
