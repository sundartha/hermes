import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallLifecycle, CAP_FAILURE_REASON } from "../../src/telephony/call-lifecycle.ts";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";
import {
  terminateAndBillCall,
  hangUpAction,
  billThunk,
} from "../../src/telephony/call-termination.ts";
import { reattachActiveCall as reattachActiveCallCore } from "../../src/telephony/reattach.ts";
import { blockingBudgetAxis } from "../../src/budget-gate.js";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const TAKT_MS = 15000;
const FAELLIG_MS = 60000;
const LIMIT = 5;
const MAX_VERSUCHE = 3;
const SEKUNDE_MS = 1000;
const MINUTE_MS = 60000;

function makeBetrieb({ el = false, ohneCarrier = false, unbeantwortet = false, ohneKonversation = false } = {}) {
  const row = {
    id: "call_fl",
    tenantId: "tenant_fl",
    status: "active",
    provider: "telnyx",
    twilioSid: ohneCarrier ? "" : "CA_fl",
    direction: el ? "outbound" : "inbound",
    startedAt: "2026-01-01T00:00:00.000Z",
    answeredAt: unbeantwortet ? null : "2026-01-01T00:00:00.000Z",
    maxDurationS: 60,
    ...(el
      ? {
          costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
          elevenlabsConversationId: ohneKonversation ? null : "conv_fl",
        }
      : {}),
  };
  const betrieb = {
    row,
    uhr: 0,
    leaseBis: 0,
    versuche: 0,
    hangups: [],
    rechnungen: [],
    elEnden: [],
    schreibFehler: false,
    elFehler: false,
    fehlerLesen: false,
    schreibtImmerNeu: false,
  };
  return betrieb;
}

function makeProzess(betrieb, { elEndeVerdrahtet = true } = {}) {
  const spiegel = [];
  const store = {
    load: () => ({ calls: spiegel }),
    getCall: (id) => spiegel.find((call) => call.id === id) ?? null,
    attachActiveCall: async (id) => {
      if (betrieb.row.status !== "active" || id !== betrieb.row.id) return null;
      let call = spiegel.find((eintrag) => eintrag.id === id);
      if (!call) {
        call = { ...betrieb.row };
        spiegel.push(call);
      }
      return call;
    },
    setCallEndedAt: async (id, status, endedAtIso) => {
      if (betrieb.schreibFehler) throw new Error("db weg");
      const call = spiegel.find((eintrag) => eintrag.id === id);
      call.status = status;
      call.endedAt = endedAtIso;
      if (betrieb.row.status === "active") Object.assign(betrieb.row, { status, endedAt: endedAtIso });
    },
    recordFailureReason: (id, reason) => {
      const call = spiegel.find((eintrag) => eintrag.id === id);
      call.failureReason = reason;
      betrieb.row.failureReason ??= reason;
    },
    faelligeFristen: async ({ art }) => {
      if (betrieb.fehlerLesen) throw new Error("db nicht erreichbar");
      assert.equal(art, "hoechstdauer");
      const faellig = betrieb.row.status === "active" && betrieb.uhr >= FAELLIG_MS && betrieb.leaseBis <= betrieb.uhr;
      if (!faellig) return [];
      betrieb.leaseBis = betrieb.uhr + TAKT_MS;
      betrieb.versuche += 1;
      return [
        { callId: betrieb.row.id, tenantId: betrieb.row.tenantId, faelligAt: "x", versuche: betrieb.versuche },
      ];
    },
    activeCallsFor: () => [],
    liveBudgetExceeded: () => false,
  };
  const timer = [];
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
    setBudgetWatchTimer: (fn, ms) => {
      timer.push({ fn, ms });
      return { unref() {} };
    },
  });
  const lauf = makeFristenLauf({
    store,
    beende: lifecycle.terminateExpiredCall,
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
  });
  return { store, lifecycle, lauf, timer, spiegel };
}

async function mitFehlerzeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

async function mitGefangenenTimern(body) {
  const echt = globalThis.setTimeout;
  const gestellt = [];
  globalThis.setTimeout = (fn, ms) => {
    gestellt.push({ fn, ms });
    return { unref() {} };
  };
  try {
    await body(gestellt);
  } finally {
    globalThis.setTimeout = echt;
  }
}

test("Fristenlauf: ein Anruf nach Ablauf der Hoechstdauer endet im Takt mit dem Kappungsgrund, einmal abgerechnet, ohne Timer zu stellen", async () => {
  const betrieb = makeBetrieb();
  const prozess = makeProzess(betrieb);
  await mitGefangenenTimern(async (gestellt) => {
    betrieb.uhr = FAELLIG_MS - SEKUNDE_MS;
    assert.deepEqual(await prozess.lauf.takt(), { beendet: 0, offen: 0, gelesen: true });
    assert.equal(betrieb.row.status, "active");
    assert.deepEqual(betrieb.hangups, []);
    betrieb.uhr = FAELLIG_MS;
    assert.deepEqual(await prozess.lauf.takt(), { beendet: 1, offen: 0, gelesen: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(gestellt, []);
    assert.deepEqual(prozess.timer, []);
  });
  assert.equal(betrieb.row.status, "failed");
  assert.equal(betrieb.row.failureReason, CAP_FAILURE_REASON);
  assert.deepEqual(betrieb.hangups, ["CA_fl"]);
  assert.deepEqual(betrieb.rechnungen, ["call_fl"]);
});

test("Fristenlauf: zwei Prozesse holen dieselbe faellige Zeile gleichzeitig, genau einer beendet sie", async () => {
  const betrieb = makeBetrieb();
  const erster = makeProzess(betrieb);
  const zweiter = makeProzess(betrieb);
  betrieb.uhr = FAELLIG_MS + MINUTE_MS;
  const ergebnisse = await Promise.all([erster.lauf.takt(), zweiter.lauf.takt()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ergebnisse.map((e) => e.beendet).sort(), [0, 1]);
  assert.deepEqual(betrieb.hangups, ["CA_fl"]);
  assert.deepEqual(betrieb.rechnungen, ["call_fl"]);
});

test("Fristenlauf: war die Zeile schon in der Datenbank beendet, uebernimmt der Lauf sie nicht und beendet nichts", async () => {
  const betrieb = makeBetrieb();
  const prozess = makeProzess(betrieb);
  const beendeteAnrufe = [];
  const lauf = makeFristenLauf({
    store: {
      ...prozess.store,
      faelligeFristen: async () => [{ callId: "call_fl", tenantId: "tenant_fl", faelligAt: "x", versuche: 1 }],
    },
    beende: async (call) => beendeteAnrufe.push(call.id),
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
  });
  betrieb.row.status = "completed";
  assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(beendeteAnrufe, []);
  assert.deepEqual(prozess.spiegel, []);
});

test("Fristenlauf: liefert die Uebernahme einen nicht mehr aktiven Anruf, wird er nicht beendet", async () => {
  const beendeteAnrufe = [];
  const lauf = makeFristenLauf({
    store: {
      faelligeFristen: async () => [{ callId: "call_fl", tenantId: "tenant_fl", faelligAt: "x", versuche: 1 }],
      attachActiveCall: async () => ({ id: "call_fl", status: "completed" }),
      getCall: () => ({ id: "call_fl", status: "completed" }),
    },
    beende: async (call) => beendeteAnrufe.push(call.id),
    limitJeMandant: LIMIT,
    leaseMs: TAKT_MS,
  });
  assert.deepEqual(await lauf.takt(), { beendet: 0, offen: 0, gelesen: true });
  assert.deepEqual(beendeteAnrufe, []);
});

test("Fristenlauf: hat der Lauf eines anderen Prozesses den Anruf beendet, loest der Timer des Besitzers keinen zweiten Hangup und keine zweite Abrechnung aus", async () => {
  const betrieb = makeBetrieb();
  const besitzer = makeProzess(betrieb);
  const anderer = makeProzess(betrieb);
  await mitGefangenenTimern(async (gestellt) => {
    const call = await besitzer.store.attachActiveCall("call_fl");
    besitzer.lifecycle.armMaxDurationTimer(call, call.twilioSid);
    betrieb.uhr = FAELLIG_MS;
    await anderer.lauf.takt();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(betrieb.row.status, "failed");
    gestellt.at(-1).fn();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(betrieb.hangups, ["CA_fl"]);
  assert.deepEqual(betrieb.rechnungen, ["call_fl"]);
  assert.equal(betrieb.row.status, "failed");
});

test("Fristenlauf: ist die Datenbank beim Beenden nicht lesbar, beendet der Besitzer-Timer den Anruf trotzdem", async () => {
  const betrieb = makeBetrieb();
  const besitzer = makeProzess(betrieb);
  const call = await besitzer.store.attachActiveCall("call_fl");
  besitzer.store.attachActiveCall = async () => {
    throw new Error("db nicht erreichbar");
  };
  await besitzer.lifecycle.terminateExpiredCall(call);
  assert.equal(betrieb.row.status, "failed");
  assert.deepEqual(betrieb.hangups, ["CA_fl"]);
});

test("Fristenlauf: ausgehender EL-Anruf ohne Auflegeweg zum Netz loescht die EL-Konversation, der Anruf endet", async () => {
  const betrieb = makeBetrieb({ el: true, ohneCarrier: true });
  const prozess = makeProzess(betrieb);
  betrieb.uhr = FAELLIG_MS;
  await prozess.lauf.takt();
  assert.deepEqual(betrieb.elEnden, ["call_fl"]);
  assert.equal(betrieb.row.status, "failed");
  assert.deepEqual(betrieb.rechnungen, ["call_fl"]);
});

test("Fristenlauf: ein Anruf ohne EL-Konversation und ohne Auflegeweg endet, ohne dass der Lauf eine EL-Konversation loescht", async () => {
  const betrieb = makeBetrieb({ el: true, ohneCarrier: true, ohneKonversation: true });
  const prozess = makeProzess(betrieb);
  betrieb.uhr = FAELLIG_MS;
  await prozess.lauf.takt();
  assert.deepEqual(betrieb.elEnden, []);
  assert.equal(betrieb.row.status, "failed");
});

test("Fristenlauf: ein EL-Anruf, den der EL-Weg selbst auflegt, wird genau einmal ueber ihn beendet", async () => {
  const betrieb = makeBetrieb({ el: true, ohneCarrier: true, unbeantwortet: true });
  const prozess = makeProzess(betrieb);
  betrieb.uhr = FAELLIG_MS;
  await prozess.lauf.takt();
  assert.deepEqual(betrieb.elEnden, ["call_fl"]);
  assert.equal(betrieb.row.status, "failed");
});

test("Fristenlauf: ohne verdrahtetes EL-Ende endet der Anruf ohne Weg zum Netz trotzdem", async () => {
  const betrieb = makeBetrieb({ el: true, ohneCarrier: true });
  const prozess = makeProzess(betrieb, { elEndeVerdrahtet: false });
  betrieb.uhr = FAELLIG_MS;
  await prozess.lauf.takt();
  assert.equal(betrieb.row.status, "failed");
});

test("Fristenlauf: scheitert das Loeschen der EL-Konversation, steht der Fehler mit Anruf-ID im Log und der Anruf endet trotzdem", async (t) => {
  const betrieb = makeBetrieb({ el: true, ohneCarrier: true });
  betrieb.elFehler = true;
  const prozess = makeProzess(betrieb);
  betrieb.uhr = FAELLIG_MS;
  const zeilen = await mitFehlerzeilen(t, () => prozess.lauf.takt());
  assert.equal(betrieb.row.status, "failed");
  assert.deepEqual(zeilen, ["[fristen] EL-Konversation loeschen fehlgeschlagen: call_fl el weg"]);
});

test("Fristenlauf: ein EL-Anruf mit Weg zum Netz wird dort aufgelegt, die EL-Konversation loescht der Lauf nicht selbst", async () => {
  const betrieb = makeBetrieb({ el: true });
  const prozess = makeProzess(betrieb);
  betrieb.uhr = FAELLIG_MS;
  await prozess.lauf.takt();
  assert.deepEqual(betrieb.hangups, ["CA_fl"]);
  assert.deepEqual(betrieb.elEnden, []);
});

test("Fristenlauf: scheitert das Beenden, versucht es der naechste Takt erneut, ab dem dritten Versuch steht der Fehler mit Anruf-ID im Log", async (t) => {
  const betrieb = makeBetrieb();
  betrieb.schreibFehler = true;
  const prozess = makeProzess(betrieb);
  const gesehen = [];
  const zeilen = await mitFehlerzeilen(t, async () => {
    for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch++) {
      betrieb.uhr = FAELLIG_MS + versuch * MINUTE_MS;
      assert.deepEqual(await prozess.lauf.takt(), { beendet: 0, offen: 1, gelesen: true });
      assert.equal(betrieb.row.status, "active");
      gesehen.push(console.error.mock.calls.filter((aufruf) => String(aufruf.arguments[0]).startsWith("[fristen]")).length);
    }
  });
  assert.deepEqual(gesehen, [0, 0, 1]);
  assert.deepEqual(zeilen, ["[fristen] Beenden nach 3 Versuchen nicht gelungen: call_fl"]);
  betrieb.schreibFehler = false;
  betrieb.uhr += MINUTE_MS;
  assert.deepEqual(await prozess.lauf.takt(), { beendet: 1, offen: 0, gelesen: true });
  assert.equal(betrieb.row.status, "failed");
});

test("Fristenlauf: ein Lesefehler steht im Log, der Takt meldet ihn und beendet nichts", async (t) => {
  const betrieb = makeBetrieb();
  const prozess = makeProzess(betrieb);
  betrieb.uhr = FAELLIG_MS;
  betrieb.fehlerLesen = true;
  let ergebnis;
  const zeilen = await mitFehlerzeilen(t, async () => {
    ergebnis = await prozess.lauf.takt();
  });
  assert.deepEqual(ergebnis, { beendet: 0, offen: 0, gelesen: false });
  assert.deepEqual(zeilen, ["[fristen] Takt: faellige Fristen lesen fehlgeschlagen: db nicht erreichbar"]);
  assert.equal(betrieb.row.status, "active");
});
