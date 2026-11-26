import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { USAGE_EVENT_KIND } from "../../src/begriffe/abrechnung.ts";
import { NOT_PLACED } from "../../src/telephony/failure-reason.ts";
import { seedCall } from "../helpers.js";

const ANSWERED_AT = "2026-11-26T10:00:00.000Z";
const ENDED_AT = "2026-11-26T10:05:00.000Z";
const SUMMARY_TEXT = "Kurze Zusammenfassung.";

function bauen({ summarizeCall }) {
  const mails = [];
  const smsList = [];
  const usage = [];
  const notifications = [];
  const store = {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (title, body, callId) => notifications.push({ title, body, callId }),
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: (event) => usage.push(event),
    markBilled: () => {},
    markInboxEntry: () => {},
    tenantNewsletterConsent: () => ({ consent: true }),
    confirmedNewsletterRecipients: () => [{ email: "abo@example.test", unsubToken: "tok" }],
    callActionItems: async () => [],
    anrufeDesMandanten: async () => [],
  };
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
    summarizeCall,
    planSummarySms: () => ({ send: true, to: "+491700000000", smsFrom: { e164: "+491511111111" }, reason: null }),
    audit: () => {},
    mailer: { sendMail: async (p) => mails.push(p) },
    accountsRef: { current: { accountByTenant: async () => ({ email: "kunde@example.test" }) } },
  });
  return { callFinish, mails, smsList, usage, notifications };
}

test("Anruf endet mit Zusammenfassung: weder Mail noch SMS noch SMS-Buchung, Ergebnis bleibt", async () => {
  const { callFinish, mails, smsList, usage, notifications } = bauen({
    summarizeCall: async (call) => {
      call.summary = SUMMARY_TEXT;
      return { summary: SUMMARY_TEXT, actionItems: ["Rueckruf"] };
    },
  });
  const call = seedCall({
    status: "completed",
    answeredAt: ANSWERED_AT,
    endedAt: ENDED_AT,
    transcript: [{ role: "caller", text: "Hallo", at: ANSWERED_AT }],
  });

  await callFinish.finishCall(call);

  assert.equal(mails.length, 0);
  assert.equal(smsList.length, 0);
  assert.equal(usage.filter((e) => e.kind === USAGE_EVENT_KIND.SMS).length, 0);
  assert.equal(call.summary, SUMMARY_TEXT);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].body, /Kurze Zusammenfassung\./);
});

test("Anruf kommt nicht zustande: keine Mail, Status und Grund bleiben am Anruf", async () => {
  const { callFinish, mails, smsList } = bauen({ summarizeCall: async () => null });
  const call = seedCall({
    status: "failed",
    direction: "outbound",
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
