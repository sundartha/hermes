// WEB-14 (i18n-Testkatalog, tasks/i18n-tests/08-web-dashboard-onboarding.md:344, kanonisch
// D12 Leit-Test) - Post-Call-SMS-Rahmentext ist sprachunabhaengig deutsch.
//
// SOLL (rot): fuer einen Call mit language="en" darf der erzeugte SMS-Text (und die
// Notification) KEIN "Anruf..." enthalten. Heute sind die Rahmentexte in
// src/telephony/call-finish.js:57 ("Anruf abgebrochen"/"Anruf nicht zustande gekommen")
// und :80 (`who = "Anruf bei "/"Anruf von "`) sprachunabhaengige Literale - call.language
// wird an keiner der beiden Stellen gelesen.
//
// Unit-Test ueber makeCallFinish (Muster test/diagnostic-retention.test.js Block B): reine
// Fake-Kollaboratoren, kein Server-Spawn, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { seedCall } from "./helpers.js";

const AT = "2026-01-01T00:00:00Z";

function makeFakeStore(notifyCapture) {
  return {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (title, body, callId) => notifyCapture.push({ title, body, callId }),
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => {},
    markBilled: () => {},
  };
}

function makeHarness({ call, summarizeCall, planSummarySms, smsCapture, notifyCapture }) {
  const config = { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} };
  const store = makeFakeStore(notifyCapture);
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileOutboundVoiceBudget: () => {} },
    messaging: () => ({
      sendSms: async ({ body }) => {
        smsCapture.push(body);
      },
    }),
    summarizeCall,
    planSummarySms,
    audit: () => {},
  });
  return callFinish;
}

test("abgebrochener EN-Call -> Notification enthaelt kein 'Anruf' (ex WEB-14)", async () => {
  const notifyCapture = [];
  const call = seedCall({ language: "en", status: "cancelled", transcript: [] });
  const callFinish = makeHarness({
    call,
    summarizeCall: async () => null,
    planSummarySms: () => ({ send: false, reason: null }),
    smsCapture: [],
    notifyCapture,
  });
  await callFinish.finishCall(call);
  assert.equal(notifyCapture.length, 1);
  assert.doesNotMatch(
    notifyCapture[0].title,
    /Anruf/,
    `SOLL: Notification-Titel fuer language=en darf kein "Anruf" enthalten (war "${notifyCapture[0].title}")`,
  );
});

test("abgeschlossener EN-Call -> Summary-SMS-Body enthaelt kein 'Anruf' (ex WEB-14)", async () => {
  const smsCapture = [];
  const notifyCapture = [];
  const call = seedCall({
    language: "en",
    direction: "outbound",
    status: "completed",
    to: "+12025550123",
    transcript: [{ role: "caller", text: "Hi", at: AT }],
  });
  const callFinish = makeHarness({
    call,
    summarizeCall: async () => ({ summary: "Call summary text", actionItems: [] }),
    planSummarySms: () => ({
      send: true,
      to: "+12025550199",
      smsFrom: { e164: "+12025550001" },
      reason: null,
    }),
    smsCapture,
    notifyCapture,
  });
  await callFinish.finishCall(call);
  assert.equal(smsCapture.length, 1, "SMS muss versendet worden sein");
  assert.doesNotMatch(
    smsCapture[0],
    /Anruf/,
    `SOLL: SMS-Body fuer language=en darf kein "Anruf" enthalten (war "${smsCapture[0]}")`,
  );
});
