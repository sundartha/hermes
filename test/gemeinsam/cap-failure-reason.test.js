import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallLifecycle, CAP_FAILURE_REASON } from "../../src/telephony/call-lifecycle.ts";
import { terminateAndBillCall, hangUpAction, billThunk } from "../../src/telephony/call-termination.ts";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { VOICE_ENGINE } from "../../src/config.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const MAX_DURATION_S = 60;
const LONG_AGO_MS = 60 * 60 * 1000;

function spyStore(call, order) {
  return {
    load: () => ({ calls: [call] }),
    getCall: (callId) => (callId === call.id ? call : null),
    setCallEndedAt: (callId, status, endedAtIso) => {
      order.push("setCallEndedAt");
      call.status = status;
      call.endedAt = endedAtIso;
    },
    recordFailureReason: (callId, reason) => {
      order.push("recordFailureReason");
      if (!call.failureReason) call.failureReason = reason;
    },
  };
}

test("Cap-Grund: terminateCappedCall persistiert das Cap-Token gemeinsam mit dem Endzustand - vor Hangup und Settlement", async () => {
  const order = [];
  const call = {
    id: "call_cap",
    status: "active",
    provider: "telnyx",
    twilioSid: "CA_1",
    startedAt: new Date(Date.now() - LONG_AGO_MS).toISOString(),
    maxDurationS: MAX_DURATION_S,
  };
  let settled;
  const billed = new Promise((resolve) => {
    settled = resolve;
  });

  const lifecycle = makeCallLifecycle({
    store: spyStore(call, order),
    config: withConfigNamespaces({ voiceEngine: VOICE_ENGINE.BUDGET }),
    finishCall: () => {
      order.push("bill");
      settled();
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
    reattachActiveCallCore: () => ({ call: null, logUnknown: false }),
    cappedEndedAtMs,
    classifyCallTime,
    now: Date.now,
  });

  lifecycle.rearmActiveCallTimers();
  await billed;

  assert.equal(call.failureReason, CAP_FAILURE_REASON, "am Cap gestorbener Anruf traegt den Cap-Grund");
  assert.equal(call.status, "failed", "Zombie-Terminalisierung bleibt failed (INV-9 unveraendert)");
  assert.deepEqual(
    order,
    ["recordFailureReason", "setCallEndedAt", "endCall", "bill"],
    "Grund liegt VOR dem Provider-Hangup und VOR dem Settlement - die Buchungs-/Summary-Kette liest ihn bereits mit",
  );
});

const UHR_JETZT_MS = 1_800_000_000_000;
const UHR_SEKUNDE_MS = 1_000;
const UHR_RESERVE_GNADE_MS = 7_000;

function lifecycleMit({ anruf, now, setTimer }) {
  const call = { ...anruf };
  const reihenfolge = [];
  let abgerechnet;
  const fertig = new Promise((resolve) => {
    abgerechnet = resolve;
  });
  const lifecycle = makeCallLifecycle({
    store: {
      load: () => ({ calls: [call] }),
      getCall: (id) => (id === call.id ? call : null),
      setCallEndedAt: (_id, status, endedAtIso) => {
        call.status = status;
        call.endedAt = endedAtIso;
      },
      recordFailureReason: (_id, grund) => {
        call.failureReason = grund;
      },
    },
    config: withConfigNamespaces({ voiceEngine: VOICE_ENGINE.BUDGET, reserveReleaseGraceMs: UHR_RESERVE_GNADE_MS }),
    finishCall: () => abgerechnet(),
    releaseReserve: (angerufen) => reihenfolge.push(["frei", angerufen.id]),
    voiceControl: () => ({ endCall: async () => undefined }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    reattachActiveCallCore: () => ({ call: null, logUnknown: false }),
    cappedEndedAtMs,
    classifyCallTime,
    now,
    setTimer,
  });
  return { lifecycle, fertig, reihenfolge, call };
}

function lebenderAnruf(vorSekunden) {
  return {
    id: "uhr_c1",
    twilioSid: "CA_uhr_c1",
    status: "active",
    provider: "telnyx",
    answeredAt: new Date(UHR_JETZT_MS - vorSekunden * UHR_SEKUNDE_MS).toISOString(),
    startedAt: null,
    maxDurationS: 60,
  };
}

test("uhr-telephony: Neustart plant die Rest-Maximaldauer ueber den gereichten Zeitgeber nach der gereichten Uhr", () => {
  const gesetzt = [];
  const { lifecycle } = lifecycleMit({
    anruf: lebenderAnruf(10),
    now: () => UHR_JETZT_MS,
    setTimer: (fn, ms) => gesetzt.push(ms),
  });
  lifecycle.rearmActiveCallTimers();
  assert.deepEqual(gesetzt, [50_000]);
});

test("uhr-telephony: Neustart beendet einen Zombie-Anruf mit Ende am Deckel statt an der gereichten Uhr", async () => {
  const gesetzt = [];
  const { lifecycle, fertig, call } = lifecycleMit({ anruf: lebenderAnruf(90), now: () => UHR_JETZT_MS, setTimer: (fn, ms) => gesetzt.push(ms) });
  lifecycle.rearmActiveCallTimers();
  await fertig;
  assert.deepEqual(gesetzt, []);
  assert.equal(call.status, "failed");
  assert.equal(call.failureReason, CAP_FAILURE_REASON);
  assert.equal(call.endedAt, new Date(UHR_JETZT_MS - 30 * UHR_SEKUNDE_MS).toISOString());
});

test("uhr-telephony: Maximaldauer-Timer endet den Anruf zur gereichten Uhr und die Reserve-Freigabe folgt nach Frist plus Gnade", async () => {
  const zeitgeber = [];
  const { lifecycle, fertig, reihenfolge, call } = lifecycleMit({
    anruf: lebenderAnruf(30),
    now: () => UHR_JETZT_MS,
    setTimer: (fn, ms) => zeitgeber.push({ fn, ms }),
  });
  lifecycle.armReserveReleaseTimer(call);
  lifecycle.armMaxDurationTimer(call, "CA_uhr_c1");
  const [reserve, dauer] = zeitgeber;
  assert.equal(dauer.ms + UHR_RESERVE_GNADE_MS, reserve.ms);
  dauer.fn();
  await fertig;
  assert.equal(call.status, "completed");
  assert.equal(call.endedAt, new Date(UHR_JETZT_MS).toISOString());
  reserve.fn();
  assert.deepEqual(reihenfolge, [["frei", "uhr_c1"]]);
});
