import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { seedCall } from "./helpers.js";

const ACCOUNT_EMAIL = "kunde@example.test";
const PUBLIC_URL = "https://hermes.example.test";
const ONE_HOUR_MS = 3600000;

const config = {
  billing: {
    paymentEnabled: false,
    smsCostCents: 0,
    outageAlertWindowMs: ONE_HOUR_MS,
    outageAlertMinFailures: 5,
    outageAlertMinAttempts: 50,
    outageAlertFailSharePercent: 50,
    outageAlertDebounceMs: 21600000,
    outageAlertRetryMs: 900000,
    platformAlertSmsTo: "",
  },
  privacy: {},
  server: { publicUrl: PUBLIC_URL },
  mail: { platformAlertMailTo: "" },
};

function makeState(calls) {
  return { calls, outageAlerts: [], platformNumberUse: [] };
}

function makeFakeStore(state) {
  return {
    load: () => state,
    withStoreLock: (fn) => Promise.resolve().then(fn),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: () => {},
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markBilled: () => {},
    markInboxEntry: () => {},
    markSummaryMailSent: () => {},
    markSummarySmsSent: () => {},
    tenantNewsletterConsent: () => ({ consent: false }),
    confirmedNewsletterRecipients: () => [],
  };
}

function fakeAccountsRef(email = ACCOUNT_EMAIL) {
  return { current: { accountByTenant: async () => (email ? { email } : null) } };
}

function auditSpy() {
  const calls = [];
  return { calls, audit: (action, req, detail) => calls.push({ action, detail }) };
}

const SUMMARY_TEXT = "Kurze Zusammenfassung.";

async function fakeSummarizeCall() {
  return { summary: SUMMARY_TEXT, actionItems: [] };
}

function makeFinish({ store, audit }) {
  return makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: () => ({ send: false, reason: null }),
    audit,
    mailer: { sendMail: async () => {} },
    accountsRef: fakeAccountsRef(),
  });
}

test("E3B-01: not-placed-Anruf loest den Betreiber-Melder ueber den echten finishCall-Pfad aus", async () => {
  const call = seedCall({
    status: "failed",
    direction: "outbound",
    to: "+12025550143",
    endedAt: "2026-08-27T10:00:00.000Z",
    failureReason: "not-placed:invite-403",
  });
  const state = makeState([call]);
  const store = makeFakeStore(state);
  const { calls: auditCalls, audit } = auditSpy();

  await makeFinish({ store, audit }).finishCall(call);

  const outageAudits = auditCalls.filter((entry) => entry.action === "outage_detected");
  assert.equal(outageAudits.length, 1, "der Melder muss ueber finishCall genau einmal urteilen (K0/Erstbefund)");
  assert.equal(state.outageAlerts.length, 1, "ein durabler Marker entsteht");
  assert.equal(state.outageAlerts[0].code, "not-placed:invite-403");
});

test("E3B-01/G-Fix (Review-Blocker Runde 2): sendNotPlacedMail wirft (z.B. pg-Pool erschoepft) - der Betreiber-Melder laeuft TROTZDEM", async () => {
  const call = seedCall({
    status: "failed",
    direction: "outbound",
    to: "+12025550143",
    endedAt: "2026-08-27T10:00:00.000Z",
    failureReason: "not-placed:invite-403",
  });
  const state = makeState([call]);
  const store = makeFakeStore(state);
  const { calls: auditCalls, audit } = auditSpy();
  const werfenderAccountsRef = { current: { accountByTenant: async () => { throw new Error("pg-pool-erschoepft"); } } };

  const finish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: fakeSummarizeCall,
    planSummarySms: () => ({ send: false, reason: null }),
    audit,
    mailer: { sendMail: async () => {} },
    accountsRef: werfenderAccountsRef,
  });

  await assert.doesNotReject(() => finish.finishCall(call));

  const outageAudits = auditCalls.filter((entry) => entry.action === "outage_detected");
  assert.equal(outageAudits.length, 1, "der Betreiber-Melder muss trotz werfender Nutzer-Mail laufen (K0/Erstbefund)");
  assert.equal(state.outageAlerts.length, 1, "ein durabler Marker entsteht trotz werfender Nutzer-Mail");
});

test("E3B-01: ein completed-Anruf loest den Betreiber-Melder NICHT aus", async () => {
  const call = seedCall({
    status: "completed",
    direction: "outbound",
    to: "+12025550143",
    answeredAt: "2026-08-27T10:00:00.000Z",
    endedAt: "2026-08-27T10:05:00.000Z",
    transcript: [{ role: "caller", text: "Hallo", at: "2026-08-27T10:00:00.000Z" }],
  });
  const state = makeState([call]);
  const store = makeFakeStore(state);
  const { calls: auditCalls, audit } = auditSpy();

  await makeFinish({ store, audit }).finishCall(call);

  const outageAudits = auditCalls.filter((entry) => entry.action.startsWith("outage_"));
  assert.equal(outageAudits.length, 0, "ein erfolgreicher Anruf darf den Ausfall-Melder nicht anstossen");
  assert.equal(state.outageAlerts.length, 0, "kein Marker ohne Ausfall");
});
