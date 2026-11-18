import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { seedCall } from "../helpers.js";

function baue() {
  const benachrichtigungen = [];
  const sms = [];
  const abgerechnet = [];
  const store = {
    save: () => {},
    addNotification: (title, body, callId) => benachrichtigungen.push({ title, body, callId }),
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => {},
    markBilled: (id) => abgerechnet.push(id),
    markInboxEntry: () => {},
  };
  const callFinish = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async ({ body }) => sms.push(body) }),
    summarizeCall: async () => null,
    planSummarySms: () => ({ send: false, reason: null }),
    audit: () => {},
  });
  return { callFinish, benachrichtigungen, sms, abgerechnet };
}

async function pruefeUnbekannt(t, status) {
  const fehler = t.mock.method(console, "error", () => {});
  const { callFinish, benachrichtigungen, sms, abgerechnet } = baue();
  const call = seedCall({ status, transcript: [] });
  await callFinish.finishCall(call);
  assert.deepEqual(benachrichtigungen, []);
  assert.deepEqual(sms, []);
  assert.deepEqual(abgerechnet, []);
  assert.equal(fehler.mock.callCount(), 1);
  const [meldungsTeile] = fehler.mock.calls.map((aufruf) => aufruf.arguments);
  const meldung = meldungsTeile.join(" ");
  assert.ok(meldung.includes(call.id), meldung);
  assert.ok(meldung.includes("Zustand"), meldung);
}

test("call-finish uebersetzt den Zustand bogus nicht in Titel oder Text", (t) => pruefeUnbekannt(t, "bogus"));
test("call-finish uebersetzt den Zustand ended nicht in Titel oder Text", (t) => pruefeUnbekannt(t, "ended"));
test("call-finish uebersetzt den leeren Zustand nicht in Titel oder Text", (t) => pruefeUnbekannt(t, ""));
test("call-finish uebersetzt den fehlenden Zustand nicht in Titel oder Text", (t) => pruefeUnbekannt(t, undefined));
test("call-finish uebersetzt einen Objekt-Zustand nicht in Titel oder Text", (t) => pruefeUnbekannt(t, { status: "failed" }));
