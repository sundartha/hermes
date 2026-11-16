import assert from "node:assert/strict";
import { test } from "node:test";

import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { LOCALES } from "../../src/i18n/locales.js";
import { seedCall } from "../helpers.js";

const WRITE_ERROR = "Posteingang nicht beschreibbar";

function build({ failWrite, summary = null }) {
  const log = { notes: [], sms: [], mails: [], capacity: [], errors: [] };
  const store = {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: async (title, body, callId) => {
      if (failWrite) throw new Error(WRITE_ERROR);
      log.notes.push({ title, body, callId });
    },
    purgeTranscript: async () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markSummarySmsSent: async () => {},
    markSummaryMailSent: async () => {},
    markBilled: () => {},
    markInboxEntry: async () => {},
    load: () => ({ calls: [] }),
    callActionItems: async () => [],
    tenantNewsletterConsent: () => ({ consent: true }),
    confirmedNewsletterRecipients: () => [],
  };
  const callFinish = makeCallFinish({
    store,
    config: {
      billing: { paymentEnabled: false, smsCostCents: 0 },
      privacy: {},
      server: { publicUrl: "https://example.test" },
    },
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async (sms) => log.sms.push(sms) }),
    summarizeCall: async () => ({ summary, actionItems: [] }),
    planSummarySms: () => ({ send: true, to: "+12025550199", smsFrom: { e164: "+12025550001" }, reason: null }),
    audit: () => {},
    mailer: { sendMail: async (mail) => log.mails.push(mail) },
    accountsRef: { current: { accountByTenant: async () => ({ email: "kunde@example.test" }) } },
    metrics: { logCallCapacity: (detail) => log.capacity.push(detail) },
  });
  return { callFinish, log };
}

async function mitProtokoll(aktion, log) {
  const original = console.error;
  console.error = (...args) => log.errors.push(args);
  try {
    await aktion();
  } finally {
    console.error = original;
  }
}

async function beendeAnruf({ failWrite, overrides }) {
  const { callFinish, log } = build({ failWrite, summary: "Termin steht" });
  const call = seedCall({
    language: "de",
    direction: "outbound",
    transcript: [{ role: "caller", text: "Hallo", at: "2026-01-01T00:00:00Z" }],
    ...overrides,
  });
  await mitProtokoll(() => callFinish.finishCall(call), log);
  return log;
}

const ABGESCHLOSSEN = { status: "completed", summary: "Termin steht" };
const GESCHEITERT = { status: "failed", transcript: [], failureReason: "at-capacity:leitungen-voll" };

test("Zusammenfassung: Schreibfehler im Posteingang, SMS und Mail gehen trotzdem raus", async () => {
  const ok = await beendeAnruf({ failWrite: false, overrides: ABGESCHLOSSEN });
  const kaputt = await beendeAnruf({ failWrite: true, overrides: ABGESCHLOSSEN });
  assert.equal(ok.sms.length, 1);
  assert.equal(ok.mails.length, 1);
  assert.equal(kaputt.sms.length, ok.sms.length);
  assert.equal(kaputt.mails.length, ok.mails.length);
  assert.equal(kaputt.mails[0].to, "kunde@example.test");
  assert.equal(kaputt.notes.length, 0);
});

test("Fehlermeldung: Schreibfehler im Posteingang, die Fehlerbehandlung des Anrufs läuft trotzdem", async () => {
  const ok = await beendeAnruf({ failWrite: false, overrides: GESCHEITERT });
  const kaputt = await beendeAnruf({ failWrite: true, overrides: GESCHEITERT });
  assert.deepEqual(ok.capacity, [{ detail: "leitungen-voll" }]);
  assert.deepEqual(kaputt.capacity, ok.capacity);
});

test("Abgebrochener Anruf: Schreibfehler stoppt die Fehlerbehandlung nicht", async () => {
  const kaputt = await beendeAnruf({
    failWrite: true,
    overrides: { ...GESCHEITERT, status: "cancelled" },
  });
  assert.deepEqual(kaputt.capacity, [{ detail: "leitungen-voll" }]);
});

test("Schreibfehler wird protokolliert und nicht als gespeichert gemeldet", async () => {
  const kaputt = await beendeAnruf({ failWrite: true, overrides: ABGESCHLOSSEN });
  assert.deepEqual(kaputt.errors, [["[notification]", WRITE_ERROR]]);
  assert.equal(kaputt.notes.length, 0);
});

test("Erfolgreiches Schreiben: Eintrag mit Titel und Anruf, nichts protokolliert", async () => {
  const ok = await beendeAnruf({ failWrite: false, overrides: ABGESCHLOSSEN });
  assert.equal(ok.notes.length, 1);
  assert.equal(ok.notes[0].title, LOCALES.de.postCall.summaryTitle);
  assert.equal(ok.notes[0].callId, "call_test1");
  assert.deepEqual(ok.errors, []);
});
