import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { seedCall } from "./helpers.js";

const ANSWERED_AT = "2026-08-14T10:00:00.000Z";
const ENDED_AT = "2026-08-14T10:05:00.000Z";
const ACCOUNT_EMAIL = "kunde@example.test";
const PUBLIC_URL = "https://hermes.example.test";

function makeFakeStore({ consent = true, recipients = [] } = {}) {
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
    markInboxEntry: () => {},
    markSummaryMailSent: () => calls.markSummaryMailSent.push(1),
    tenantNewsletterConsent: () => ({ consent }),
    confirmedNewsletterRecipients: () => recipients,
  };
}

function fakeAccountsRef(email = ACCOUNT_EMAIL) {
  return { current: { accountByTenant: async () => (email ? { email } : null) } };
}

const SUMMARY_TEXT = "Kurze Zusammenfassung.";

async function fakeSummarizeCall(call) {
  call.summary = SUMMARY_TEXT;
  return { summary: SUMMARY_TEXT, actionItems: [] };
}

const config = {
  billing: { paymentEnabled: false, smsCostCents: 0 },
  privacy: {},
  server: { publicUrl: PUBLIC_URL },
};
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
  assert.doesNotMatch(sendCalls[0].text, /Abmelden:/, "Konto-Adresse bekommt KEINEN Abmelde-Link");
  assert.equal(store.calls.markSummaryMailSent.length, 1, "Dedup-Marker gesetzt");

  await callFinish.finishCall(call);
  assert.equal(sendCalls.length, 1, "kein zweiter Versand nach _finished-Guard");
});

test("Versand-Dedup ueber den persistierten Marker: call.summaryMailSentAt bereits gesetzt -> kein Sendeversuch", async () => {
  const sendCalls = [];
  const store = makeFakeStore({ consent: true });
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

test("fail-soft: Mailer wirft fuer das EINZIGE Ziel -> finishCall wirft NICHT, Billing/SMS-Pfad bleibt unberuehrt, KEIN Marker", async () => {
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

test("Skip-Audit: keine Konto-E-Mail, keine Zusatzempfaenger -> reason=no_account_email, kein Throw", async () => {
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

test("kein Newsletter-Opt-in, keine Zusatzempfaenger -> kein Versand, KEIN Audit-Eintrag (kein Ziel-Defizit)", async () => {
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
  });

  await assert.doesNotReject(() => callFinish.finishCall(call));
});

test("CONFIRMED-Zusatzempfaenger bekommt eine EIGENE Mail MIT Abmelde-Link (Konto-Adresse bleibt ohne)", async () => {
  const sendCalls = [];
  const store = makeFakeStore({
    consent: true,
    recipients: [{ email: "freund@example.test", unsubToken: "tok_freund" }],
  });
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
  assert.equal(sendCalls.length, 2, "Konto-Adresse UND Zusatzempfaenger bekommen je eine Mail");
  const accountMail = sendCalls.find((m) => m.to === ACCOUNT_EMAIL);
  const recipientMail = sendCalls.find((m) => m.to === "freund@example.test");
  assert.ok(accountMail && recipientMail);
  assert.doesNotMatch(accountMail.text, /Abmelden:/, "Konto-Adresse ohne Abmelde-Link");
  assert.match(recipientMail.text, /Abmelden:.*\/newsletter\/unsubscribe\?token=tok_freund/s);
  assert.equal(store.calls.markSummaryMailSent.length, 1, "EIN Marker fuer den gesamten Call (nicht pro Ziel)");
});

test("nur PENDING-Zusatzempfaenger (nicht bestaetigt) -> store liefert ihn nicht ueber confirmedNewsletterRecipients -> keine Mail an ihn", async () => {
  const sendCalls = [];
  const store = makeFakeStore({ consent: true, recipients: [] });
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
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].to, ACCOUNT_EMAIL);
});

test("Teilfehler fail-soft: EIN Ziel schlaegt fehl, das andere gelingt -> Fehler geloggt, trotzdem EIN Marker (kein gezielter Retry)", async () => {
  const sendCalls = [];
  const store = makeFakeStore({
    consent: true,
    recipients: [{ email: "kaputt@example.test", unsubToken: "tok_kaputt" }],
  });
  const call = makeCompletedCall();
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: noopSms,
    audit: () => {},
    mailer: {
      sendMail: async (p) => {
        if (p.to === "kaputt@example.test") throw new Error("bounced");
        sendCalls.push(p);
      },
    },
    accountsRef: fakeAccountsRef(),
  });

  await assert.doesNotReject(() => callFinish.finishCall(call));
  assert.equal(sendCalls.length, 1, "nur das erfolgreiche Ziel wurde tatsaechlich zugestellt");
  assert.equal(store.calls.markSummaryMailSent.length, 1, "Marker gesetzt, weil MINDESTENS ein Ziel erfolgreich war");
});

test("Consent=false, aber CONFIRMED-Zusatzempfaenger vorhanden -> orthogonale Achse, trotzdem Versand NUR an den Zusatzempfaenger", async () => {
  const sendCalls = [];
  const store = makeFakeStore({
    consent: false,
    recipients: [{ email: "freund@example.test", unsubToken: "tok_freund" }],
  });
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
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].to, "freund@example.test");
  assert.match(sendCalls[0].text, /Abmelden:/);
});
