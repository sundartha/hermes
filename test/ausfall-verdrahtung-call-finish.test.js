// OUTBOUND-E3b Review-Blocker (B1/E3B-01): DIE NAHT finishCall -> reportSystematicOutage
// ist bisher an KEINER Stelle laufzeit-gepruft - alle bestehenden Ausfall-Tests rufen
// reportSystematicOutage/beurteileAusfall DIREKT auf, nie ueber einen echten
// Anruf-Abschluss (makeCallFinish#finishCall). Ein Refactoring, das die Aufrufzeile in
// call-finish.js#reportFailedCall entfernt, blieb dadurch bei VOLLER gruener Suite
// unbemerkt (Gegenprobe im Review: `void reportSystematicOutage;` statt des Aufrufs ->
// 5228 pass / 0 fail).
//
// Dieser Test schliesst genau diese Luecke: ECHTES makeCallFinish, ECHTER Store-Zustand
// (state-ops.js#openOutageAlert/claimOutageAlert - kein zweiter Fake-Mechanismus, G5),
// scharfes Ausfall-Fenster. not-placed -> der Melder laeuft (Audit-Zeile + durabler
// Marker entstehen); completed -> der Melder laeuft NICHT (kein Ausfall-Audit, kein
// Marker). Versand bleibt ausserhalb dieses Tests (K0/Erstbefund sendet ohnehin nicht,
// s. ausfall-meldeweg.test.js M8) - Ziel hier ist ausschliesslich die VERDRAHTUNG.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { seedCall } from "./helpers.js";

const ACCOUNT_EMAIL = "kunde@example.test";
const PUBLIC_URL = "https://hermes.example.test";
const ONE_HOUR_MS = 3600000;

// Scharfes Fenster, minFailures/minAttempts hoch genug, dass ein einzelner not-placed-
// Anruf NUR den Erstbefund (K0) ausloest - der beweist die Verdrahtung bereits (Audit +
// Marker), ohne den Meldeweg-Versand selbst erneut zu pruefen (das leistet
// ausfall-meldeweg.test.js).
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

// Anders als test/f2-mail-summary-finish-call.test.js#fakeSummarizeCall braucht dieser
// Fake KEINEN call.summary-Nebeneffekt: dieser Test prueft ausschliesslich die
// Ausfall-Melder-Verdrahtung, nicht das Mail-Gate (das liest call.summary als Beleg, hier
// irrelevant) - kein Grund, den Parameter zu mutieren (G12/no-param-reassign).
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
  // Reproduziert den Befund: planNotPlacedMail#accountByTenant ist eine echte pg-Abfrage
  // und kann werfen. Ohne eigenes try/catch um sendNotPlacedMail riss ein Wurf hier den
  // gesamten reportFailedCall mit - der Betreiber-Melder liefe dann NIE, genau in dem
  // Fall, fuer den er gebraucht wird (eine Backend-Stoerung erzeugt not-placed-Anrufe).
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
