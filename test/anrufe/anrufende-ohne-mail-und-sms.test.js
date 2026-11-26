import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { USAGE_EVENT_KIND } from "../../src/begriffe/abrechnung.ts";
import { NOT_PLACED } from "../../src/telephony/failure-reason.ts";
import { BOOTSTRAP_TENANT_ID, makePgTestStore } from "../pg-helpers.js";

const ANSWERED_AT = "2026-11-26T10:00:00.000Z";
const ENDED_AT = "2026-11-26T10:05:00.000Z";
const SUMMARY_TEXT = "Kurze Zusammenfassung.";

async function bauen(anruf) {
  const { store } = await makePgTestStore();
  const call = store.createCall({
    direction: "outbound",
    from: "+4930555000610",
    to: "+4915112340610",
    goal: "Test",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
  });
  Object.assign(call, anruf);
  const mails = [];
  const smsList = [];
  const callFinish = makeCallFinish({
    store,
    config: {
      billing: { paymentEnabled: false, smsCostCents: 5 },
      privacy: {},
      server: { publicUrl: "https://hermes.example.test" },
      voice: { sendSmsSummary: true, dailySmsCap: 50 },
    },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async (p) => smsList.push(p) }),
    summarizeCall: async () => null,
    planSummarySms: () => ({ send: true, to: "+491700000000", smsFrom: { e164: "+491511111111" }, reason: null }),
    audit: () => {},
    mailer: { sendMail: async (p) => mails.push(p) },
    accountsRef: { current: { accountByTenant: async () => ({ email: "kunde@example.test" }) } },
  });
  return { callFinish, call, store, mails, smsList };
}

test("Anruf endet mit Zusammenfassung: weder Mail noch SMS noch SMS-Buchung, Ergebnis bleibt", async () => {
  const { callFinish, call, store, mails, smsList } = await bauen({
    status: "completed",
    answeredAt: ANSWERED_AT,
    endedAt: ENDED_AT,
    summary: SUMMARY_TEXT,
    transcript: [{ role: "caller", text: "Hallo", at: ANSWERED_AT }],
  });

  await callFinish.finishCall(call);

  const zustand = store.load();
  assert.equal(mails.length, 0);
  assert.equal(smsList.length, 0);
  assert.equal(zustand.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.SMS).length, 0);
  assert.equal(call.summary, SUMMARY_TEXT);
  assert.equal(zustand.notifications.length, 1);
  assert.match(zustand.notifications[0].body, /Kurze Zusammenfassung\./);
});

test("Anruf kommt nicht zustande: keine Mail, Status und Grund bleiben am Anruf", async () => {
  const { callFinish, call, mails, smsList } = await bauen({
    status: "failed",
    failureReason: NOT_PLACED,
    endedAt: ENDED_AT,
    transcript: [],
  });

  await callFinish.finishCall(call);

  assert.equal(mails.length, 0);
  assert.equal(smsList.length, 0);
  assert.equal(call.status, "failed");
  assert.equal(call.failureReason, NOT_PLACED);
});
