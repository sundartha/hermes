import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallLifecycle } from "../../src/telephony/call-lifecycle.ts";
import { terminateAndBillCall, hangUpAction, billThunk } from "../../src/telephony/call-termination.ts";
import { reattachActiveCall as reattachActiveCallCore } from "../../src/telephony/reattach.ts";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";

const TAKT_MS = 15000;
const MAX_DURATION_S = 180;

function betrieb({ el = false, ohneCarrier = false } = {}) {
  return {
    row: {
      id: "call_geld_ende",
      tenantId: "tenant_geld_ende",
      status: "active",
      provider: "telnyx",
      twilioSid: ohneCarrier ? "" : "CA_geld_ende",
      direction: el ? "outbound" : "inbound",
      startedAt: "2026-01-01T00:00:00.000Z",
      answeredAt: "2026-01-01T00:00:00.000Z",
      maxDurationS: MAX_DURATION_S,
      ...(el ? { costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, elevenlabsConversationId: "conv_geld_ende" } : {}),
    },
    hangups: [],
    rechnungen: [],
    elEnden: [],
    achsenFragen: [],
  };
}

function prozess(lage, { achse = "budget_tenant" } = {}) {
  const spiegel = [];
  const store = {
    load: () => ({ calls: spiegel }),
    getCall: (id) => spiegel.find((call) => call.id === id) ?? null,
    attachActiveCall: async (id) => {
      if (lage.row.status !== "active" || id !== lage.row.id) return null;
      if (!spiegel.some((call) => call.id === id)) spiegel.push({ ...lage.row });
      return spiegel.find((call) => call.id === id);
    },
    setCallEndedAt: async (id, status, endedAtIso) => {
      Object.assign(spiegel.find((eintrag) => eintrag.id === id), { status, endedAt: endedAtIso });
      if (lage.row.status === "active") Object.assign(lage.row, { status, endedAt: endedAtIso });
    },
    recordFailureReason: (id, reason) => {
      spiegel.find((eintrag) => eintrag.id === id).failureReason = reason;
      if (!lage.row.failureReason) Object.assign(lage.row, { failureReason: reason });
    },
    activeCallsFor: () => [],
    liveBudgetExceeded: () => false,
  };
  const config = withConfigNamespaces({ defaultTenantBudgetCents: 7, budgetWatchdogIntervalMs: TAKT_MS });
  const lifecycle = makeCallLifecycle({
    store,
    config,
    finishCall: (call) => {
      lage.rechnungen.push(call.id);
    },
    releaseReserve: () => {},
    voiceControl: () => ({
      async endCall(sid) {
        lage.hangups.push(sid);
      },
    }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    endActiveCall: async (id) => {
      lage.elEnden.push(id);
    },
    awaitAndPersistInboundElResult: async () => {},
    reattachActiveCallCore,
    cappedEndedAtMs,
    classifyCallTime,
    blockingBudgetAxis: async (anfrage) => {
      lage.achsenFragen.push(anfrage);
      return achse;
    },
    setBudgetWatchTimer: () => ({ unref() {} }),
  });
  return { store, lifecycle, config };
}

test("Geld-Ende: ein Anruf, den die Geld-Frist beendet, endet als completed mit dem Budget-Grund, einmal aufgelegt, einmal abgerechnet", async () => {
  const lage = betrieb();
  const { store, lifecycle } = prozess(lage);
  const call = await store.attachActiveCall("call_geld_ende");
  await lifecycle.terminateOverBudgetExpired(call);
  assert.equal(lage.row.status, "completed");
  assert.equal(lage.row.failureReason, "budget-exhausted");
  assert.deepEqual(lage.hangups, ["CA_geld_ende"]);
  assert.deepEqual(lage.rechnungen, ["call_geld_ende"]);
  assert.deepEqual(lage.elEnden, []);
});

test("Geld-Ende: ein ausgehender EL-Anruf ohne Auflegeweg zum Netz loescht die EL-Konversation, der Anruf endet", async () => {
  const lage = betrieb({ el: true, ohneCarrier: true });
  const { store, lifecycle } = prozess(lage);
  await lifecycle.terminateOverBudgetExpired(await store.attachActiveCall("call_geld_ende"));
  assert.deepEqual(lage.elEnden, ["call_geld_ende"]);
  assert.equal(lage.row.status, "completed");
  assert.equal(lage.row.failureReason, "budget-exhausted");
});

test("Geld-Ende: hat ein anderer Prozess den Anruf schon beendet, folgt kein zweiter Hangup und keine zweite Abrechnung", async () => {
  const lage = betrieb();
  const besitzer = prozess(lage);
  const call = await besitzer.store.attachActiveCall("call_geld_ende");
  const fremder = prozess(lage);
  await fremder.lifecycle.terminateOverBudgetExpired(await fremder.store.attachActiveCall("call_geld_ende"));
  await besitzer.lifecycle.terminateOverBudgetExpired(call);
  assert.deepEqual(lage.hangups, ["CA_geld_ende"]);
  assert.deepEqual(lage.rechnungen, ["call_geld_ende"]);
  assert.equal(besitzer.store.getCall("call_geld_ende").status, "completed");
});

test("Geld-Pruefung: die Achse wird mit Speicher, Abrechnungswerten und Mandant des Anrufs gefragt und ihr Ergebnis weitergegeben", async () => {
  const lage = betrieb();
  const { store, lifecycle, config } = prozess(lage, { achse: "budget_tenant" });
  const call = await store.attachActiveCall("call_geld_ende");
  assert.equal(await lifecycle.blockingAxisFor(call), "budget_tenant");
  assert.equal(lage.achsenFragen.length, 1);
  const [frage] = lage.achsenFragen;
  assert.equal(frage.store, store);
  assert.equal(frage.billing, config.billing);
  assert.equal(frage.billing.defaultTenantBudgetCents, 7);
  assert.equal(frage.tenantId, "tenant_geld_ende");
});
