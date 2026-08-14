// F2-Mail - planSummaryMail: reine Ziel-/Sende-Entscheidung fuer die Call-Summary-Mail
// nach einem beendeten Anruf (Newsletter-Einwilligung + F2-Newsletter-Recipients Double-
// Opt-in-Zusatzempfaenger). Offline-Unit-Test mit Fake-Store/Fake-Mailer/Fake-Accounts
// (kein DB, kein Netz, F.I.R.S.T. - Muster f2-sms-summary-plan.test.js). Deckt ab:
//   (a) Dedup-Marker gesetzt -> skip, KEIN reason
//   (b) kein Mailer -> skip, reason=no_mailer
//   (c) keine Summary -> skip, KEIN reason
//   (d) keine Newsletter-Einwilligung UND keine Zusatzempfaenger -> skip, KEIN reason
//   (e) Einwilligung, aber keine Konto-E-Mail UND keine Zusatzempfaenger -> reason=no_account_email
//   Positivfall Konto: alles vorhanden -> send=true, EIN Ziel = Konto-E-Mail, unsubToken=null
//   F2-Newsletter-Recipients: CONFIRMED-Zusatzempfaenger sind ORTHOGONAL zum Boolean-Consent
//   (Consent=false + bestaetigte Zusatzempfaenger -> trotzdem send=true, NUR die Zusatzziele)
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSummaryMail } from "../src/mail-summary.js";

const TENANT = "t_mail_a";

function fakeStore({ consent = true, recipients = [] } = {}) {
  return {
    tenantNewsletterConsent: () => ({ consent }),
    confirmedNewsletterRecipients: () => recipients,
  };
}

function fakeMailer() {
  return { sendMail: async () => {} };
}

function fakeAccounts(email) {
  const calls = [];
  return {
    calls,
    accountByTenant: async (tenantId) => {
      calls.push(tenantId);
      return email ? { sub: "sub_mail_a", email } : null;
    },
  };
}

const baseCall = (over = {}) => ({
  id: "call_mail_a",
  tenantId: TENANT,
  summary: "Kurze Zusammenfassung des Anrufs.",
  summaryMailSentAt: null,
  ...over,
});

test("alles vorhanden -> send=true, EIN Ziel = Konto-E-Mail, unsubToken=null", async () => {
  const plan = await planSummaryMail({
    store: fakeStore({ consent: true }),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: fakeAccounts("kunde@example.test"),
  });
  assert.equal(plan.send, true);
  assert.deepEqual(plan.targets, [{ email: "kunde@example.test", unsubToken: null }]);
  assert.equal(plan.reason, null);
});

test("(a) Dedup-Marker gesetzt -> send=false, KEIN reason (normaler Retry, kein Defizit)", async () => {
  const plan = await planSummaryMail({
    store: fakeStore({ consent: true }),
    call: baseCall({ summaryMailSentAt: "2026-08-14T10:00:00.000Z" }),
    mailer: fakeMailer(),
    accounts: fakeAccounts("kunde@example.test"),
  });
  assert.equal(plan.send, false);
  assert.deepEqual(plan.targets, []);
  assert.equal(plan.reason, null);
});

test("(b) kein Mailer konfiguriert -> send=false, reason=no_mailer (auditierbar)", async () => {
  const accounts = fakeAccounts("kunde@example.test");
  const plan = await planSummaryMail({
    store: fakeStore({ consent: true }),
    call: baseCall(),
    mailer: null,
    accounts,
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "no_mailer");
  assert.equal(accounts.calls.length, 0, "kein Konto-Lookup ohne Mailer (kein unnoetiger DB-Call)");
});

test("(c) keine Summary vorhanden -> send=false, KEIN reason", async () => {
  const accounts = fakeAccounts("kunde@example.test");
  const plan = await planSummaryMail({
    store: fakeStore({ consent: true }),
    call: baseCall({ summary: null }),
    mailer: fakeMailer(),
    accounts,
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
  assert.equal(accounts.calls.length, 0, "kein Konto-Lookup ohne Summary");
});

test("(d) keine Newsletter-Einwilligung UND keine Zusatzempfaenger -> send=false, KEIN reason", async () => {
  const accounts = fakeAccounts("kunde@example.test");
  const plan = await planSummaryMail({
    store: fakeStore({ consent: false }),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts,
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
  assert.equal(accounts.calls.length, 0, "kein Konto-Lookup ohne Einwilligung");
});

test("(e) Einwilligung, aber keine Konto-E-Mail hinterlegt, keine Zusatzempfaenger -> reason=no_account_email", async () => {
  const plan = await planSummaryMail({
    store: fakeStore({ consent: true }),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: fakeAccounts(null),
  });
  assert.equal(plan.send, false);
  assert.deepEqual(plan.targets, []);
  assert.equal(plan.reason, "no_account_email");
});

test("(e) kein accounts-Adapter injiziert (pg-Web-Login-Block nicht gemountet) -> send=false, reason=no_account_email", async () => {
  const plan = await planSummaryMail({
    store: fakeStore({ consent: true }),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: null,
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "no_account_email");
});

test("F2-Newsletter-Recipients: Consent=false + bestaetigter Zusatzempfaenger -> send=true, NUR das Zusatzziel", async () => {
  const plan = await planSummaryMail({
    store: fakeStore({
      consent: false,
      recipients: [{ email: "freund@example.test", unsubToken: "unsub_tok_1" }],
    }),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: fakeAccounts("kunde@example.test"),
  });
  assert.equal(plan.send, true);
  assert.deepEqual(plan.targets, [{ email: "freund@example.test", unsubToken: "unsub_tok_1" }]);
  assert.equal(plan.reason, null);
});

test("F2-Newsletter-Recipients: Consent=true + Konto-E-Mail + zwei bestaetigte Zusatzempfaenger -> drei Ziele", async () => {
  const plan = await planSummaryMail({
    store: fakeStore({
      consent: true,
      recipients: [
        { email: "a@example.test", unsubToken: "tok_a" },
        { email: "b@example.test", unsubToken: "tok_b" },
      ],
    }),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: fakeAccounts("kunde@example.test"),
  });
  assert.equal(plan.send, true);
  assert.deepEqual(plan.targets, [
    { email: "kunde@example.test", unsubToken: null },
    { email: "a@example.test", unsubToken: "tok_a" },
    { email: "b@example.test", unsubToken: "tok_b" },
  ]);
});

test("F2-Newsletter-Recipients: Consent=true, keine Konto-E-Mail, aber bestaetigter Zusatzempfaenger -> send=true trotz Konto-Defizit, reason bleibt null", async () => {
  const plan = await planSummaryMail({
    store: fakeStore({
      consent: true,
      recipients: [{ email: "freund@example.test", unsubToken: "unsub_tok_2" }],
    }),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: fakeAccounts(null),
  });
  assert.equal(plan.send, true);
  assert.deepEqual(plan.targets, [{ email: "freund@example.test", unsubToken: "unsub_tok_2" }]);
  assert.equal(plan.reason, null, "es wird ja tatsaechlich versendet - kein Defizit-reason bei send=true");
});
