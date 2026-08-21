// P11 (PLAN-I18N Umsetzung) - Post-Call-Rahmentexte (Notification/SMS, WEB-14) folgen
// der Sprache des Calls (LOCALES[lang].postCall). Unit-Test ueber makeCallFinish
// (Muster test/web-14-call-finish-sms-text-language.test.js), kein Server-Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { seedCall } from "./helpers.js";

const AT = "2026-01-01T00:00:00Z";

function makeHarness({ summarizeCall, planSummarySms, smsCapture, notifyCapture }) {
  const config = { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} };
  const store = {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (title, body, callId) => notifyCapture.push({ title, body, callId }),
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => {},
    markBilled: () => {},
    // INBOX-P1: der Marker faellt am Gespraechsende immer (No-op bei false).
    markInboxEntry: () => {},
  };
  return makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({
      sendSms: async ({ body }) => smsCapture.push(body),
    }),
    summarizeCall,
    planSummarySms,
    audit: () => {},
  });
}

for (const lang of SUPPORTED_LANGUAGES) {
  test(`P11-P1 ${lang}: abgebrochener Call -> Notification-Titel aus LOCALES[lang].postCall`, async () => {
    const notifyCapture = [];
    const call = seedCall({ language: lang, status: "cancelled", transcript: [] });
    const callFinish = makeHarness({
      summarizeCall: async () => null,
      planSummarySms: () => ({ send: false, reason: null }),
      smsCapture: [],
      notifyCapture,
    });
    await callFinish.finishCall(call);
    assert.equal(notifyCapture.length, 1);
    assert.equal(notifyCapture[0].title, LOCALES[lang].postCall.cancelledTitle);
    assert.equal(
      notifyCapture[0].body,
      LOCALES[lang].postCall.statusBody(call.to, "cancelled"),
    );
  });

  test(`P11-P2 ${lang}: abgeschlossener Call -> Summary-SMS-Body aus LOCALES[lang].postCall`, async () => {
    const smsCapture = [];
    const notifyCapture = [];
    const call = seedCall({
      language: lang,
      direction: "outbound",
      status: "completed",
      to: "+12025550123",
      transcript: [{ role: "caller", text: "Hi", at: AT }],
    });
    const callFinish = makeHarness({
      summarizeCall: async () => ({ summary: "Summary text", actionItems: ["Follow up"] }),
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
    assert.equal(smsCapture.length, 1);
    const t = LOCALES[lang].postCall;
    const who = t.subjectOutbound(call.to);
    assert.ok(smsCapture[0].includes(who), `${lang}: SMS-Body traegt nicht das Betreff-Praefix`);
    assert.ok(
      smsCapture[0].includes(t.actionItemsHeading),
      `${lang}: SMS-Body traegt nicht die Action-Items-Ueberschrift`,
    );
    assert.equal(notifyCapture[0].title, t.summaryTitle);
  });
}

// DE-Gegenprobe byte-genau gegen die heutigen Strings (Umzug verschiebt nichts, WEB-14).
test("P11-P3 DE-Gegenprobe byte-genau: cancelledTitle/subjectOutbound/summaryTitle", () => {
  const t = LOCALES.de.postCall;
  assert.equal(t.cancelledTitle, "Anruf abgebrochen");
  assert.equal(t.subjectOutbound("+491511234"), "Anruf bei +491511234");
  assert.equal(t.summaryTitle, "Neue Call Summary");
  assert.equal(t.actionItemsHeading, "Action Items:");
});
