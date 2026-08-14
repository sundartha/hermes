// F2-Mail - planSummaryMail: reine Ziel-/Sende-Entscheidung fuer die Call-Summary-Mail
// nach einem beendeten Anruf (Newsletter-Einwilligung). Offline-Unit-Test mit Fake-Store/
// Fake-Mailer/Fake-Accounts (kein DB, kein Netz, F.I.R.S.T. - Muster f2-sms-summary-
// plan.test.js). Deckt die fuenf Gates in ihrer Reihenfolge ab:
//   (a) Dedup-Marker gesetzt -> skip, KEIN reason
//   (b) kein Mailer -> skip, reason=no_mailer
//   (c) keine Newsletter-Einwilligung -> skip, KEIN reason
//   (d) keine Summary -> skip, KEIN reason
//   (e) keine Konto-E-Mail -> skip, reason=no_account_email
//   Positivfall: alles vorhanden -> send=true, Ziel = Konto-E-Mail
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSummaryMail } from "../src/mail-summary.js";

const TENANT = "t_mail_a";

function fakeStore(consent = true) {
  return { tenantNewsletterConsent: () => ({ consent }) };
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

test("alles vorhanden -> send=true, Ziel = Konto-E-Mail des Tenants", async () => {
  const plan = await planSummaryMail({
    store: fakeStore(true),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: fakeAccounts("kunde@example.test"),
  });
  assert.equal(plan.send, true);
  assert.equal(plan.to, "kunde@example.test");
  assert.equal(plan.reason, null);
});

test("(a) Dedup-Marker gesetzt -> send=false, KEIN reason (normaler Retry, kein Defizit)", async () => {
  const plan = await planSummaryMail({
    store: fakeStore(true),
    call: baseCall({ summaryMailSentAt: "2026-08-14T10:00:00.000Z" }),
    mailer: fakeMailer(),
    accounts: fakeAccounts("kunde@example.test"),
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
});

test("(b) kein Mailer konfiguriert -> send=false, reason=no_mailer (auditierbar)", async () => {
  const accounts = fakeAccounts("kunde@example.test");
  const plan = await planSummaryMail({
    store: fakeStore(true),
    call: baseCall(),
    mailer: null,
    accounts,
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "no_mailer");
  assert.equal(accounts.calls.length, 0, "kein Konto-Lookup ohne Mailer (kein unnoetiger DB-Call)");
});

test("(c) keine Newsletter-Einwilligung -> send=false, KEIN reason (kein Betriebsdefekt)", async () => {
  const accounts = fakeAccounts("kunde@example.test");
  const plan = await planSummaryMail({
    store: fakeStore(false),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts,
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
  assert.equal(accounts.calls.length, 0, "kein Konto-Lookup ohne Einwilligung");
});

test("(d) keine Summary vorhanden -> send=false, KEIN reason", async () => {
  const accounts = fakeAccounts("kunde@example.test");
  const plan = await planSummaryMail({
    store: fakeStore(true),
    call: baseCall({ summary: null }),
    mailer: fakeMailer(),
    accounts,
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, null);
  assert.equal(accounts.calls.length, 0, "kein Konto-Lookup ohne Summary");
});

test("(e) keine Konto-E-Mail hinterlegt -> send=false, reason=no_account_email", async () => {
  const plan = await planSummaryMail({
    store: fakeStore(true),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: fakeAccounts(null),
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "no_account_email");
});

test("(e) kein accounts-Adapter injiziert (pg-Web-Login-Block nicht gemountet) -> send=false, reason=no_account_email", async () => {
  const plan = await planSummaryMail({
    store: fakeStore(true),
    call: baseCall(),
    mailer: fakeMailer(),
    accounts: null,
  });
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "no_account_email");
});
