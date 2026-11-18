import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { blockingBudgetAxis } from "../../src/budget-gate.js";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { makeCallLifecycle } from "../../src/telephony/call-lifecycle.ts";
import { billThunk, hangUpAction, terminateAndBillCall } from "../../src/telephony/call-termination.ts";
import { reattachActiveCall as reattachActiveCallCore } from "../../src/telephony/reattach.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const TAKT_MS = 15000;
const ZEILEN = [{ role: "agent", text: "Preis?" }];

async function endeBeiHoechstdauer(zusatz) {
  const row = {
    id: "call_bewertung",
    tenantId: "tenant_bewertung",
    status: "active",
    provider: "telnyx",
    twilioSid: "CA_bewertung",
    direction: "outbound",
    startedAt: "2026-01-01T00:00:00.000Z",
    answeredAt: "2026-01-01T00:00:00.000Z",
    maxDurationS: 180,
    ...zusatz,
  };
  const store = {
    load: () => ({ calls: [row] }),
    getCall: () => row,
    attachActiveCall: async () => (row.status === "active" ? row : null),
    setCallEndedAt: async (_id, status) => void Object.assign(row, { status }),
    recordFailureReason: (_id, reason) => void Object.assign(row, { failureReason: reason }),
    activeCallsFor: () => [],
    liveBudgetExceeded: () => false,
  };
  const lifecycle = makeCallLifecycle({
    store,
    config: withConfigNamespaces({ billing: {}, budgetWatchdogIntervalMs: TAKT_MS }),
    finishCall: () => {},
    releaseReserve: () => {},
    voiceControl: () => ({ endCall: async () => {} }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    endActiveCall: async () => {},
    awaitAndPersistInboundElResult: async () => {},
    reattachActiveCallCore,
    cappedEndedAtMs,
    classifyCallTime,
    blockingBudgetAxis,
    setBudgetWatchTimer: () => ({ unref() {} }),
  });
  await lifecycle.terminateExpiredCall(row);
  return row;
}

const TABELLE = [
  { name: "ausgehender EL-Anruf mit Gespraech endet completed und wird bewertet", zusatz: { costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, transcript: ZEILEN }, status: "completed" },
  { name: "ausgehender EL-Anruf ohne Gespraech endet failed", zusatz: { costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, transcript: [] }, status: "failed" },
  { name: "ausgehender EL-Anruf ohne Gespraechsfeld endet failed", zusatz: { costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI }, status: "failed" },
  { name: "anderer Anruf mit Gespraech endet failed", zusatz: { transcript: ZEILEN }, status: "failed" },
];

for (const { name, zusatz, status } of TABELLE) {
  test(`Frist-Ende Bewertung: ${name}`, async () => {
    const row = await endeBeiHoechstdauer(zusatz);
    assert.equal(row.status, status);
    assert.equal(row.failureReason, "max-duration-cap");
  });
}
