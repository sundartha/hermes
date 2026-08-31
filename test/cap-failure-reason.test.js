// P11 (GAP-26, Regressionsschutz - KEIN Katalogtest): der Max-Dauer-Cap hinterlaesst einen
// maschinenlesbaren Grund am Call-Record, und zwar GEMEINSAM mit dem Endzustand - also vor
// dem Provider-Hangup und vor dem Settlement. Unit gegen makeCallLifecycle mit Spy-Store
// (offline, kein Server/Netz/Timer, F.I.R.S.T.). Abgrenzung zum Gate-Test
// max-duration-live-cap.test.js: der faehrt den LIVE-Timer per Spawn und prueft nur, DASS
// ein Cap-Merkmal da ist; hier stehen Reihenfolge, exaktes Token und der Boot-Zombie-Pfad
// (status "failed") im Fokus, den der Live-Test nicht erreicht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallLifecycle, CAP_FAILURE_REASON } from "../src/telephony/call-lifecycle.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "../src/telephony/call-termination.js";
import { cappedEndedAtMs, classifyCallTime } from "../src/store/state-ops.js";
import { VOICE_ENGINE } from "../src/config.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const MAX_DURATION_S = 60;
const LONG_AGO_MS = 60 * 60 * 1000; // deutlich ueber MAX_DURATION_S -> expired

// Spy-Store: nur die vier Methoden, die terminateCappedCall/rearmActiveCallTimers anfassen.
// Schreibt in dieselbe order-Liste wie die uebrigen Spies -> die Reihenfolge ist pruefbar.
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
    reattachActiveCallCore: () => ({ call: null, logUnknown: false }),
    cappedEndedAtMs,
    classifyCallTime,
  });

  lifecycle.rearmActiveCallTimers(); // Zombie (Restzeit<=0) -> terminateCappedCall(status "failed")
  await billed;

  assert.equal(call.failureReason, CAP_FAILURE_REASON, "am Cap gestorbener Anruf traegt den Cap-Grund");
  assert.equal(call.status, "failed", "Zombie-Terminalisierung bleibt failed (INV-9 unveraendert)");
  assert.deepEqual(
    order,
    // G27/C2-Fix (Review-Blocker Runde 3): persistEnd laeuft jetzt ueber persistEndWithReason
    // (call-termination.js) - EINE Formulierung, recordFailureReason IMMER zuerst (per
    // Konstruktion, nicht mehr als freie, umkehrbare Zeile).
    ["recordFailureReason", "setCallEndedAt", "endCall", "bill"],
    "Grund liegt VOR dem Provider-Hangup und VOR dem Settlement - die Buchungs-/Summary-Kette liest ihn bereits mit",
  );
});
