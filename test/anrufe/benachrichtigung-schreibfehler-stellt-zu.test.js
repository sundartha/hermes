import assert from "node:assert/strict";
import { test } from "node:test";

import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { makePgTestStore } from "../pg-helpers.js";

const WRITE_ERROR = "Posteingang nicht beschreibbar";

async function build({ failWrite }) {
  const log = { notes: [], sms: [], mails: [], capacity: [], errors: [] };
  const { store: pgStore } = await makePgTestStore();
  const store = {
    ...pgStore,
    tenantNewsletterConsent: () => ({ consent: true }),
    addNotification: async (title, body, callId) => {
      if (failWrite) throw new Error(WRITE_ERROR);
      log.notes.push({ title, body, callId });
    },
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
    summarizeCall: async () => ({ summary: "Termin steht", actionItems: [] }),
    planSummarySms: () => ({ send: true, to: "+12025550199", smsFrom: { e164: "+12025550001" }, reason: null }),
    audit: () => {},
    mailer: { sendMail: async (mail) => log.mails.push(mail) },
    accountsRef: { current: { accountByTenant: async () => ({ email: "kunde@example.test" }) } },
    metrics: { logCallCapacity: (detail) => log.capacity.push(detail) },
  });
  return { callFinish, log, store };
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
  const { callFinish, log, store } = await build({ failWrite });
  const call = store.createCall({
    direction: "outbound",
    from: "+15005550006",
    to: "+4915112345678",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  Object.assign(call, {
    language: "de",
    transcript: [{ role: "caller", text: "Hallo", at: "2026-01-01T00:00:00Z" }],
    ...overrides,
  });
  await mitProtokoll(() => callFinish.finishCall(call), log);
  return log;
}

const ABGESCHLOSSEN = { status: "completed", summary: "Termin steht" };
const GESCHEITERT = { status: "failed", transcript: [], failureReason: "at-capacity:leitungen-voll" };

test("Zusammenfassung: Schreibfehler im Posteingang, es geht weder SMS noch Mail raus", async () => {
  const ok = await beendeAnruf({ failWrite: false, overrides: ABGESCHLOSSEN });
  const kaputt = await beendeAnruf({ failWrite: true, overrides: ABGESCHLOSSEN });
  assert.equal(ok.sms.length, 0);
  assert.equal(ok.mails.length, 0);
  assert.equal(kaputt.sms.length, 0);
  assert.equal(kaputt.mails.length, 0);
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
  assert.match(ok.notes[0].body, /Termin steht/);
  assert.ok(ok.notes[0].callId);
  assert.deepEqual(ok.errors, []);
});
