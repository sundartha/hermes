// F2-Mail - Integration ueber makeCallFinish: Versand genau einmal (Dedup nach Erfolg),
// ein Mailer-Fehler laesst finishCall/Billing/SMS unberuehrt (fail-soft), Skip wird
// PII-frei auditiert (keine E-Mail-Adresse im Audit-Detail). Unit-Test mit Fake-
// Kollaboratoren (Muster test/web-14-call-finish-sms-text-language.test.js), kein
// Server-Spawn, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { seedCall } from "./helpers.js";

const ANSWERED_AT = "2026-08-14T10:00:00.000Z";
const ENDED_AT = "2026-08-14T10:05:00.000Z";
const ACCOUNT_EMAIL = "kunde@example.test";

function makeFakeStore({ consent = true } = {}) {
  const calls = { markSummaryMailSent: [], markSummarySmsSent: [] };
  return {
    calls,
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: () => {},
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: () => calls.markSummarySmsSent.push(1),
    markBilled: () => {},
    markSummaryMailSent: () => calls.markSummaryMailSent.push(1),
    tenantNewsletterConsent: () => ({ consent }),
  };
}

function fakeAccountsRef(email = ACCOUNT_EMAIL) {
  return { current: { accountByTenant: async () => (email ? { email } : null) } };
}

const SUMMARY_TEXT = "Kurze Zusammenfassung.";

// Fake-summarizeCall MUSS wie die echte Implementierung (claude.js) call.summary als
// Nebeneffekt setzen, BEVOR sie zurueckkehrt - genau das liest Gate (d) in
// planSummaryMail (mail-summary.js). Ein Fake, der nur den Rueckgabewert liefert (wie in
// test/web-14-*.test.js, wo keine Mail-Gate den call.summary-Nebeneffekt braucht), wuerde
// hier Gate (d) faelschlich als "keine Summary" auswerten.
async function fakeSummarizeCall(call) {
  call.summary = SUMMARY_TEXT;
  return { summary: SUMMARY_TEXT, actionItems: [] };
}

const config = { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} };
const noopSms = () => ({ send: false, reason: null });

function makeCompletedCall(over = {}) {
  return seedCall({
    status: "completed",
    answeredAt: ANSWERED_AT,
    endedAt: ENDED_AT,
    transcript: [{ role: "caller", text: "Hallo", at: ANSWERED_AT }],
    ...over,
  });
}

test("Versand genau einmal: Erfolg -> markSummaryMailSent gesetzt, kein zweiter Versand bei erneutem finishCall", async () => {
  const sendCalls = [];
  const store = makeFakeStore({ consent: true });
  const call = makeCompletedCall();
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: noopSms,
    audit: () => {},
    mailer: { sendMail: async (p) => sendCalls.push(p) },
    accountsRef: fakeAccountsRef(),
  });

  await callFinish.finishCall(call);
  assert.equal(sendCalls.length, 1, "Mail wird genau einmal verschickt");
  assert.equal(sendCalls[0].to, ACCOUNT_EMAIL);
  assert.match(sendCalls[0].text, /Kurze Zusammenfassung\./);
  assert.equal(store.calls.markSummaryMailSent.length, 1, "Dedup-Marker gesetzt");

  // Zweiter Aufruf (z.B. spaeter /voice/status-Retry): call._finished ist bereits gesetzt
  // (In-Memory-Guard) -> finishCall selbst returnt sofort, kein zweiter Versand.
  await callFinish.finishCall(call);
  assert.equal(sendCalls.length, 1, "kein zweiter Versand nach _finished-Guard");
});

test("Versand-Dedup ueber den persistierten Marker: call.summaryMailSentAt bereits gesetzt -> kein Sendeversuch", async () => {
  const sendCalls = [];
  const store = makeFakeStore({ consent: true });
  // call._finished ist NICHT gesetzt (frischer Call-Snapshot, Muster Prozess-Restart),
  // aber der PERSISTIERTE Marker ist schon da - planSummaryMail muss ihn sehen.
  const call = makeCompletedCall({ summaryMailSentAt: "2026-08-14T10:06:00.000Z" });
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: noopSms,
    audit: () => {},
    mailer: { sendMail: async (p) => sendCalls.push(p) },
    accountsRef: fakeAccountsRef(),
  });

  await callFinish.finishCall(call);
  assert.equal(sendCalls.length, 0, "persistierter Marker unterdrueckt den Versand");
});

test("fail-soft: Mailer wirft -> finishCall wirft NICHT, Billing/SMS-Pfad bleibt unberuehrt", async () => {
  const smsCalls = [];
  const store = makeFakeStore({ consent: true });
  const call = makeCompletedCall();
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async (p) => smsCalls.push(p) }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: () => ({ send: true, to: "+491700000000", smsFrom: { e164: "+491511111111" }, reason: null }),
    audit: () => {},
    mailer: {
      sendMail: async () => {
        throw new Error("SMTP timeout");
      },
    },
    accountsRef: fakeAccountsRef(),
  });

  await assert.doesNotReject(() => callFinish.finishCall(call));
  assert.equal(smsCalls.length, 1, "SMS-Pfad lief trotz gescheitertem Mailversand unveraendert");
  assert.equal(store.calls.markSummarySmsSent.length, 1, "SMS-Marker trotzdem gesetzt");
  assert.equal(store.calls.markSummaryMailSent.length, 0, "Mail-Marker NICHT gesetzt (kein Erfolg vorgetaeuscht)");
});

test("Skip-Audit: kein Mailer konfiguriert -> audit mail_summary_skipped reason=no_mailer, PII-frei (keine E-Mail im Detail)", async () => {
  const auditCalls = [];
  const store = makeFakeStore({ consent: true });
  const call = makeCompletedCall();
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: noopSms,
    audit: (action, _req, detail) => auditCalls.push({ action, detail }),
    mailer: null,
    accountsRef: fakeAccountsRef(),
  });

  await callFinish.finishCall(call);
  const skip = auditCalls.find((c) => c.action === "mail_summary_skipped");
  assert.ok(skip, "Skip wurde auditiert");
  assert.equal(skip.detail, `call=${call.id} reason=no_mailer`);
  assert.doesNotMatch(skip.detail, new RegExp(ACCOUNT_EMAIL), "keine E-Mail-Adresse im Audit-Detail");
});

test("Skip-Audit: keine Konto-E-Mail -> reason=no_account_email, kein Throw", async () => {
  const auditCalls = [];
  const store = makeFakeStore({ consent: true });
  const call = makeCompletedCall();
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: noopSms,
    audit: (action, _req, detail) => auditCalls.push({ action, detail }),
    mailer: { sendMail: async () => {} },
    accountsRef: fakeAccountsRef(null),
  });

  await callFinish.finishCall(call);
  const skip = auditCalls.find((c) => c.action === "mail_summary_skipped");
  assert.ok(skip);
  assert.equal(skip.detail, `call=${call.id} reason=no_account_email`);
});

test("kein Newsletter-Opt-in -> kein Versand, KEIN Audit-Eintrag (kein Ziel-Defizit)", async () => {
  const auditCalls = [];
  const sendCalls = [];
  const store = makeFakeStore({ consent: false });
  const call = makeCompletedCall();
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: noopSms,
    audit: (action, _req, detail) => auditCalls.push({ action, detail }),
    mailer: { sendMail: async (p) => sendCalls.push(p) },
    accountsRef: fakeAccountsRef(),
  });

  await callFinish.finishCall(call);
  assert.equal(sendCalls.length, 0);
  assert.equal(auditCalls.some((c) => c.action === "mail_summary_skipped"), false);
});

test("Default-Aufrufer ohne mailer/accountsRef (Bestandstests) bleiben gueltig - kein Throw", async () => {
  const store = makeFakeStore({ consent: true });
  const call = makeCompletedCall();
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: noopSms,
    audit: () => {},
    // mailer/accountsRef bewusst WEGGELASSEN (Default null/{current:null}).
  });

  await assert.doesNotReject(() => callFinish.finishCall(call));
});
