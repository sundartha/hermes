import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { MS_PER_MINUTE } from "../src/utils/timer.js";
import { seedCall } from "./helpers.js";

const TARGET = "+12025550143";
const ACCOUNT_EMAIL = "kunde@example.test";
const PUBLIC_URL = "https://hermes.example.test";
const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

const MINUTES_PER_HOUR = 60;
const ONE_MINUTE_MS = MS_PER_MINUTE;
const ONE_HOUR_MS = MINUTES_PER_HOUR * ONE_MINUTE_MS;
const SIX_MINUTES = 6;
const SIX_MINUTES_MS = SIX_MINUTES * ONE_MINUTE_MS;
const HOURS_IN_TWO_HOUR_CASE = 2;
const TWO_HOURS_MS = HOURS_IN_TWO_HOUR_CASE * ONE_HOUR_MS;
const FAILED_CALL_COUNT = 5;
const TWO_MAILS = 2;

const config = {
  billing: { paymentEnabled: false, smsCostCents: 0 },
  privacy: {},
  server: { publicUrl: PUBLIC_URL },
};

const neverSummarize = async () => {
  throw new Error("summarizeCall haette im not-placed-Fruehpfad nicht laufen duerfen");
};
const neverSms = () => {
  throw new Error("planSummarySms haette im not-placed-Fruehpfad nicht laufen duerfen");
};
const neverMessaging = () => {
  throw new Error("messaging haette im not-placed-Fruehpfad nicht laufen duerfen");
};

function makeFakeStore(calls) {
  const state = { calls };
  return {
    load: () => state,
    addNotification: () => {},
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    markBilled: () => {},
    markInboxEntry: () => {},
    markSummaryMailSent: () => {},
    markSummarySmsSent: () => {},
    recordUsageEvent: () => {},
  };
}

function fakeAccountsRef(email = ACCOUNT_EMAIL) {
  return { current: { accountByTenant: async () => (email ? { email } : null) } };
}

function makeFailedCall(overrides = {}) {
  return seedCall({
    status: "failed",
    direction: "outbound",
    to: TARGET,
    endedAt: "2026-08-27T10:00:00.000Z",
    failureReason: "not-placed:start-403",
    ...overrides,
  });
}

function harness({ calls, mailer, accountsRef = fakeAccountsRef(), audit = () => {} }) {
  const store = makeFakeStore(calls);
  const callFinish = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: neverMessaging,
    summarizeCall: neverSummarize,
    planSummarySms: neverSms,
    audit,
    mailer,
    accountsRef,
  });
  return { store, callFinish };
}

function makeMailer() {
  const sent = [];
  return { sent, mailer: { sendMail: async (mail) => sent.push(mail) } };
}

test("1: not-placed, outbound, Konto-Mail vorhanden -> genau 1 Mail an die Konto-Adresse", async () => {
  const call = makeFailedCall({ id: "call_1" });
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({ calls: [call], mailer });

  await callFinish.finishCall(call);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, ACCOUNT_EMAIL);
});

test("2: unreachable -> keine Mail", async () => {
  const call = makeFailedCall({ id: "call_2", failureReason: "unreachable:invite-404-D11" });
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({ calls: [call], mailer });

  await callFinish.finishCall(call);

  assert.equal(sent.length, 0);
});

test("3: no-answer -> keine Mail", async () => {
  const call = makeFailedCall({ id: "call_3", failureReason: "no-answer" });
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({ calls: [call], mailer });

  await callFinish.finishCall(call);

  assert.equal(sent.length, 0);
});

test("4: result-unknown -> keine Mail", async () => {
  const call = makeFailedCall({ id: "call_4", failureReason: "result-unknown:start-no-status" });
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({ calls: [call], mailer });

  await callFinish.finishCall(call);

  assert.equal(sent.length, 0);
});

test("5: Entprellung - fuenf not-placed-Anrufe desselben Tenants in 6 Minuten -> genau 1 Mail insgesamt", async () => {
  const base = Date.parse("2026-08-27T10:00:00.000Z");
  const calls = Array.from({ length: FAILED_CALL_COUNT }, (_unused, index) =>
    makeFailedCall({
      id: `call_5_${index}`,
      endedAt: new Date(base + index * ONE_MINUTE_MS).toISOString(),
    }),
  );
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({ calls, mailer });

  for (const call of calls) await callFinish.finishCall(call);

  assert.equal(sent.length, 1, "fuenf Fehlversuche in 6 Minuten sind EIN Vorfall");
});

test("5b: Positiv-Kontrolle der Entprellung - zwei not-placed-Anrufe 2h auseinander -> 2 Mails", async () => {
  const base = Date.parse("2026-08-27T10:00:00.000Z");
  const calls = [
    makeFailedCall({ id: "call_5b_1", endedAt: new Date(base).toISOString() }),
    makeFailedCall({ id: "call_5b_2", endedAt: new Date(base + TWO_HOURS_MS).toISOString() }),
  ];
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({ calls, mailer });

  for (const call of calls) await callFinish.finishCall(call);

  assert.equal(sent.length, TWO_MAILS, "ausserhalb des Fensters ist es ein neuer Vorfall");
});

test("6: inbound mit not-placed-Token -> keine Mail (Gate b)", async () => {
  const call = makeFailedCall({ id: "call_6", direction: "inbound", from: TARGET, to: undefined });
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({ calls: [call], mailer });

  await callFinish.finishCall(call);

  assert.equal(sent.length, 0);
});

test("7: PII-Probe - Gespraechsinhalt/Anbieter-Rohtext duerfen weder in der Mail noch im Audit-Detail auftauchen", async () => {
  const call = makeFailedCall({
    id: "call_7",
    summary: "GEHEIM-Gespraechsinhalt",
    transcript: [{ role: "caller", text: "GEHEIM-Transkriptzeile", at: "2026-08-27T10:00:00.000Z" }],
  });
  const auditCalls = [];
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({
    calls: [call],
    mailer,
    audit: (...args) => auditCalls.push(args),
  });

  await callFinish.finishCall(call);

  assert.equal(sent.length, 1);
  const mailText = `${sent[0].subject}\n${sent[0].text}`;
  assert.ok(!mailText.includes("GEHEIM"), "kein Gespraechsinhalt im Mailtext");
  assert.ok(!mailText.includes("INVITE"), "kein Anbieter-Rohtext im Mailtext");
  assert.ok(!mailText.includes("Invalid destination"), "kein Anbieter-Rohtext im Mailtext");
  for (const args of auditCalls) {
    const flat = JSON.stringify(args);
    assert.ok(!flat.includes(ACCOUNT_EMAIL), "keine E-Mail-Adresse im Audit");
    assert.ok(!flat.includes(TARGET), "keine Rufnummer im Audit");
  }
});

test("8: kein Mailer -> keine Mail, Audit meldet no_mailer, finishCall wirft nicht", async () => {
  const call = makeFailedCall({ id: "call_8" });
  const auditCalls = [];
  const { callFinish } = harness({
    calls: [call],
    mailer: null,
    audit: (...args) => auditCalls.push(args),
  });

  await assert.doesNotReject(callFinish.finishCall(call));

  const skip = auditCalls.find((args) => args[0] === "not_placed_mail_skipped");
  assert.ok(skip, "Skip wird auditiert");
  assert.match(skip[2], /reason=no_mailer/);
});

test("Entprellung ist tenant-scoped: ein not-placed-Anruf von Tenant A unterdrueckt Tenant B nicht", async () => {
  const base = Date.parse("2026-08-27T10:00:00.000Z");
  const callA = makeFailedCall({ id: "call_a", tenantId: TENANT_A, endedAt: new Date(base).toISOString() });
  const callB = makeFailedCall({
    id: "call_b",
    tenantId: TENANT_B,
    endedAt: new Date(base + SIX_MINUTES_MS).toISOString(),
  });
  const { sent, mailer } = makeMailer();
  const { callFinish } = harness({ calls: [callA, callB], mailer });

  await callFinish.finishCall(callA);
  await callFinish.finishCall(callB);

  assert.equal(sent.length, TWO_MAILS, "verschiedene Tenants entprellen sich nicht gegenseitig");
});
