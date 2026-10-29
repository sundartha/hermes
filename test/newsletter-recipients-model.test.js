import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmail,
  isValidEmailFormat,
  planAddNewsletterRecipient,
  MAX_NEWSLETTER_RECIPIENTS,
  NEWSLETTER_CONFIRM_MAIL_DAILY_CAP,
} from "../src/newsletter-recipients.js";
import {
  makeDefaultState,
  registerTenant,
  addNewsletterRecipient,
  removeNewsletterRecipient,
  tenantNewsletterRecipients,
  confirmedNewsletterRecipients,
  dailyNewsletterConfirmMailCount,
  tenantIdpSubject,
  setCancellationMailPending,
  cancellationMailPending,
  tenantsPendingCancellationMail,
  confirmNewsletterRecipientByToken,
} from "../src/store/state-ops.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";

const TENANT = "t_nl_recipients";

function freshTenantState() {
  const s = makeDefaultState();
  registerTenant(s, TENANT, { firstName: "Kunde", lastName: "N" });
  return s;
}

function fakeStoreFrom(s) {
  return {
    tenantNewsletterRecipients: (tenantId) => tenantNewsletterRecipients(s, tenantId),
    dailyNewsletterConfirmMailCount: (tenantId, sinceIso) =>
      dailyNewsletterConfirmMailCount(s, tenantId, sinceIso),
  };
}

test("normalizeEmail: trim + lowercase", () => {
  assert.equal(normalizeEmail("  Max.Mustermann@Example.DE  "), "max.mustermann@example.de");
  assert.equal(normalizeEmail(""), "");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail(null), "");
});

test("isValidEmailFormat: einfache, aber wirksame Pruefung", () => {
  assert.equal(isValidEmailFormat("a@b.de"), true);
  assert.equal(isValidEmailFormat("a.b+tag@sub.example.co"), true);
  assert.equal(isValidEmailFormat("keine-email"), false);
  assert.equal(isValidEmailFormat("a@b"), false, "keine Domain-Endung");
  assert.equal(isValidEmailFormat("a b@c.de"), false, "Leerzeichen");
  assert.equal(isValidEmailFormat(""), false);
});

test("planAddNewsletterRecipient: gueltige, neue Adresse -> ok, normalisierte E-Mail", () => {
  const s = freshTenantState();
  const plan = planAddNewsletterRecipient({
    store: fakeStoreFrom(s),
    tenantId: TENANT,
    rawEmail: "  Freund@Example.TEST  ",
    accountEmail: "kunde@example.test",
  });
  assert.deepEqual(plan, { ok: true, email: "freund@example.test" });
});

test("planAddNewsletterRecipient: ungueltiges Format -> reason=invalid_format", () => {
  const s = freshTenantState();
  const plan = planAddNewsletterRecipient({
    store: fakeStoreFrom(s),
    tenantId: TENANT,
    rawEmail: "keine-email",
    accountEmail: null,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "invalid_format");
});

test("planAddNewsletterRecipient: leere Adresse -> reason=invalid_format", () => {
  const s = freshTenantState();
  const plan = planAddNewsletterRecipient({ store: fakeStoreFrom(s), tenantId: TENANT, rawEmail: "   " });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "invalid_format");
});

test("planAddNewsletterRecipient: identisch zur Konto-Adresse (normalisiert) -> reason=duplicate", () => {
  const s = freshTenantState();
  const plan = planAddNewsletterRecipient({
    store: fakeStoreFrom(s),
    tenantId: TENANT,
    rawEmail: "Kunde@Example.Test",
    accountEmail: "kunde@example.test",
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "duplicate");
});

test("planAddNewsletterRecipient: bereits in der Liste -> reason=duplicate", () => {
  const s = freshTenantState();
  addNewsletterRecipient(s, TENANT, { email: "freund@example.test", tokenHash: "h", tokenExpiresAt: "x", unsubToken: "u" });
  const plan = planAddNewsletterRecipient({
    store: fakeStoreFrom(s),
    tenantId: TENANT,
    rawEmail: "FREUND@example.test",
    accountEmail: null,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "duplicate");
});

test(`planAddNewsletterRecipient: Cap erreicht (${MAX_NEWSLETTER_RECIPIENTS}) -> reason=cap_reached`, () => {
  const s = freshTenantState();
  for (let i = 0; i < MAX_NEWSLETTER_RECIPIENTS; i++) {
    addNewsletterRecipient(s, TENANT, {
      email: `person${i}@example.test`,
      tokenHash: "h",
      tokenExpiresAt: "x",
      unsubToken: "u",
    });
  }
  const plan = planAddNewsletterRecipient({
    store: fakeStoreFrom(s),
    tenantId: TENANT,
    rawEmail: "einer-zu-viel@example.test",
    accountEmail: null,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "cap_reached");
});

test(`planAddNewsletterRecipient: Tageslimit erreicht (${NEWSLETTER_CONFIRM_MAIL_DAILY_CAP}) -> reason=daily_limit, fail-closed`, () => {
  const s = freshTenantState();
  const now = new Date("2026-08-14T12:00:00.000Z");
  for (let i = 0; i < NEWSLETTER_CONFIRM_MAIL_DAILY_CAP; i++) {
    addNewsletterRecipient(s, TENANT, {
      email: `daily${i}@example.test`,
      tokenHash: "h",
      tokenExpiresAt: "x",
      unsubToken: "u",
      now: now.toISOString(),
    });
    removeNewsletterRecipient(s, TENANT, `daily${i}@example.test`);
  }
  const plan = planAddNewsletterRecipient({
    store: fakeStoreFrom(s),
    tenantId: TENANT,
    rawEmail: "elfte@example.test",
    accountEmail: null,
    now,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "daily_limit");
});

test("planAddNewsletterRecipient: Tageslimit ausserhalb des 24h-Fensters (>24h alt) zaehlt NICHT mehr", () => {
  const s = freshTenantState();
  const old = new Date("2026-08-10T12:00:00.000Z");
  for (let i = 0; i < NEWSLETTER_CONFIRM_MAIL_DAILY_CAP; i++) {
    addNewsletterRecipient(s, TENANT, {
      email: `old${i}@example.test`,
      tokenHash: "h",
      tokenExpiresAt: "x",
      unsubToken: "u",
      now: old.toISOString(),
    });
    removeNewsletterRecipient(s, TENANT, `old${i}@example.test`);
  }
  const now = new Date("2026-08-14T12:00:00.000Z");
  const plan = planAddNewsletterRecipient({
    store: fakeStoreFrom(s),
    tenantId: TENANT,
    rawEmail: "frisch@example.test",
    accountEmail: null,
    now,
  });
  assert.equal(plan.ok, true, "alte Log-Eintraege ausserhalb des rollierenden Fensters blockieren nicht");
});

test("addNewsletterRecipient: legt pending-Eintrag mit allen Feldern an, Antwort ohne Muell-Felder", () => {
  const s = freshTenantState();
  const recipient = addNewsletterRecipient(s, TENANT, {
    email: "freund@example.test",
    tokenHash: "hash123",
    tokenExpiresAt: "2026-08-16T12:00:00.000Z",
    unsubToken: "unsub123",
  });
  assert.equal(recipient.email, "freund@example.test");
  assert.equal(recipient.status, "pending");
  assert.equal(recipient.confirmedAt, null);
  assert.equal(recipient.tokenHash, "hash123");
  assert.ok(recipient.createdAt);
  assert.deepEqual(tenantNewsletterRecipients(s, TENANT).map((r) => r.email), ["freund@example.test"]);
});

test("addNewsletterRecipient: unbekannter Tenant -> throw (kein stilles No-Op)", () => {
  const s = makeDefaultState();
  assert.throws(
    () => addNewsletterRecipient(s, "t_unknown", { email: "x@y.de", tokenHash: "h", tokenExpiresAt: "x", unsubToken: "u" }),
    /nicht gefunden/,
  );
});

test("confirmedNewsletterRecipients: nur status=confirmed, pending bleibt aussen vor", () => {
  const s = freshTenantState();
  addNewsletterRecipient(s, TENANT, { email: "a@x.de", tokenHash: "h1", tokenExpiresAt: "x", unsubToken: "u1" });
  addNewsletterRecipient(s, TENANT, { email: "b@x.de", tokenHash: "h2", tokenExpiresAt: "x", unsubToken: "u2" });
  const [first] = tenantNewsletterRecipients(s, TENANT);
  first.status = "confirmed";
  const confirmed = confirmedNewsletterRecipients(s, TENANT);
  assert.deepEqual(confirmed.map((r) => r.email), ["a@x.de"]);
});

test("removeNewsletterRecipient: entfernt Eintrag, idempotent (zweiter Aufruf -> false)", () => {
  const s = freshTenantState();
  addNewsletterRecipient(s, TENANT, { email: "a@x.de", tokenHash: "h", tokenExpiresAt: "x", unsubToken: "u" });
  assert.equal(removeNewsletterRecipient(s, TENANT, "a@x.de"), true);
  assert.deepEqual(tenantNewsletterRecipients(s, TENANT), []);
  assert.equal(removeNewsletterRecipient(s, TENANT, "a@x.de"), false, "idempotent - kein Treffer mehr");
});

test("removeNewsletterRecipient: unbekannter Tenant -> throw", () => {
  const s = makeDefaultState();
  assert.throws(() => removeNewsletterRecipient(s, "t_unknown", "a@x.de"), /nicht gefunden/);
});

test("[NIE2] die Tageskappe der Bestaetigungsmails zaehlt genau das letzte 24-Stunden-Fenster", async () => {
  const { store } = await makePgTestStore();
  const sentAt = Date.parse("2026-08-14T12:00:00.000Z");
  for (let i = 0; i < NEWSLETTER_CONFIRM_MAIL_DAILY_CAP; i++) {
    store.addNewsletterRecipient(BOOTSTRAP_TENANT_ID, {
      email: `fenster${i}@example.test`,
      tokenHash: "h",
      tokenExpiresAt: "x",
      unsubToken: "u",
      now: new Date(sentAt).toISOString(),
    });
    store.removeNewsletterRecipient(BOOTSTRAP_TENANT_ID, `fenster${i}@example.test`);
  }
  const reasonAfter = (ms) =>
    planAddNewsletterRecipient({
      store,
      tenantId: BOOTSTRAP_TENANT_ID,
      rawEmail: "neu@example.test",
      accountEmail: null,
      now: new Date(sentAt + ms),
    }).reason;
  const DAY = 86_400_000;
  assert.deepEqual(
    [reasonAfter(60_000), reasonAfter(DAY / 2), reasonAfter(DAY), reasonAfter(DAY + 1)],
    ["daily_limit", "daily_limit", "daily_limit", undefined],
  );
});

const EIN_TAG_IN_MS = 86_400_000;
const UNBEKANNT = "t_unbekannt";

function mitEmpfaenger(emails) {
  const s = freshTenantState();
  for (const email of emails) {
    addNewsletterRecipient(s, TENANT, { email, tokenHash: `hash-${email}`, tokenExpiresAt: "2026-08-16T12:00:00.000Z", unsubToken: `u-${email}` });
  }
  return s;
}

test("tenantIdpSubject: liefert den Subject-Wert, sonst null (auch unbekannter Tenant)", () => {
  const s = freshTenantState();
  assert.equal(tenantIdpSubject(s, TENANT), null);
  assert.equal(tenantIdpSubject(s, UNBEKANNT), null);
  setCancellationMailPending(s, TENANT).idpSubject = "sub-123";
  assert.equal(tenantIdpSubject(s, TENANT), "sub-123");
});

test("setCancellationMailPending: setzt nur die uebergebenen Felder, unbekannter Tenant -> null", () => {
  const s = freshTenantState();
  assert.equal(setCancellationMailPending(s, UNBEKANNT, { pending: true }), null);
  const tenant = setCancellationMailPending(s, TENANT, { pending: true, receivedAt: "2026-08-14T10:00:00.000Z" });
  assert.equal(tenant.cancellationMailPending, true);
  assert.equal(tenant.cancellationMailReceivedAt, "2026-08-14T10:00:00.000Z");
  setCancellationMailPending(s, TENANT, { pending: false });
  assert.equal(tenant.cancellationMailPending, false);
  assert.equal(tenant.cancellationMailReceivedAt, "2026-08-14T10:00:00.000Z", "receivedAt bleibt");
  setCancellationMailPending(s, TENANT, { receivedAt: "2026-08-15T10:00:00.000Z" });
  assert.equal(tenant.cancellationMailPending, false, "pending bleibt");
  assert.equal(tenant.cancellationMailReceivedAt, "2026-08-15T10:00:00.000Z");
  setCancellationMailPending(s, TENANT);
  assert.equal(tenant.cancellationMailReceivedAt, "2026-08-15T10:00:00.000Z");
});

test("cancellationMailPending: Standard false/null, sonst die gespeicherten Werte", () => {
  const s = freshTenantState();
  assert.deepEqual(cancellationMailPending(s, UNBEKANNT), { pending: false, receivedAt: null });
  assert.deepEqual(cancellationMailPending(s, TENANT), { pending: false, receivedAt: null });
  setCancellationMailPending(s, TENANT, { pending: true, receivedAt: "2026-08-14T10:00:00.000Z" });
  assert.deepEqual(cancellationMailPending(s, TENANT), { pending: true, receivedAt: "2026-08-14T10:00:00.000Z" });
});

test("tenantsPendingCancellationMail: nur Tenants mit ausstehender Kuendigungsmail", () => {
  const s = freshTenantState();
  registerTenant(s, "t_nl_other", { firstName: "Anderer", lastName: "N" });
  assert.deepEqual(tenantsPendingCancellationMail(s), []);
  setCancellationMailPending(s, TENANT, { pending: true });
  assert.deepEqual(tenantsPendingCancellationMail(s).map((tenant) => tenant.id), [TENANT]);
});

test("tenantNewsletterRecipients und dailyNewsletterConfirmMailCount: unbekannter Tenant -> leer bzw. 0", () => {
  const s = makeDefaultState();
  assert.deepEqual(tenantNewsletterRecipients(s, UNBEKANNT), []);
  assert.equal(dailyNewsletterConfirmMailCount(s, UNBEKANNT, "0"), 0);
});

test("addNewsletterRecipient: Bestaetigungs-Log behaelt Eintraege ab genau 24h, verwirft aeltere", () => {
  const s = freshTenantState();
  const start = Date.parse("2026-08-10T12:00:00.000Z");
  const addAt = (ms) =>
    addNewsletterRecipient(s, TENANT, {
      email: `log${ms}@example.test`,
      tokenHash: "h",
      tokenExpiresAt: "x",
      unsubToken: "u",
      now: new Date(start + ms).toISOString(),
    });
  const logGroesse = () => dailyNewsletterConfirmMailCount(s, TENANT, "0");
  addAt(0);
  assert.equal(logGroesse(), 1);
  addAt(EIN_TAG_IN_MS);
  assert.equal(logGroesse(), 2, "Eintrag genau 24h alt bleibt");
  addAt(2 * EIN_TAG_IN_MS + 1);
  assert.equal(logGroesse(), 1, "aeltere Eintraege fallen heraus");
});

test("removeNewsletterRecipient: ohne Empfaenger -> false, entfernt nur die genannte Adresse", () => {
  const leer = freshTenantState();
  assert.equal(removeNewsletterRecipient(leer, TENANT, "a@x.de"), false);
  assert.deepEqual(tenantNewsletterRecipients(leer, TENANT), []);
  const s = mitEmpfaenger(["a@x.de", "b@x.de"]);
  assert.equal(removeNewsletterRecipient(s, TENANT, "a@x.de"), true);
  assert.deepEqual(tenantNewsletterRecipients(s, TENANT).map((r) => r.email), ["b@x.de"]);
});

test("confirmNewsletterRecipientByToken: bestaetigt pending-Empfaenger mit passendem, gueltigem Token", () => {
  const s = mitEmpfaenger(["a@x.de"]);
  const jetzt = "2026-08-15T12:00:00.000Z";
  assert.deepEqual(confirmNewsletterRecipientByToken(s, "hash-a@x.de", jetzt), { tenantId: TENANT, email: "a@x.de" });
  const [empfaenger] = tenantNewsletterRecipients(s, TENANT);
  assert.equal(empfaenger.status, "confirmed");
  assert.equal(empfaenger.confirmedAt, jetzt);
  assert.equal(empfaenger.tokenHash, null);
  assert.equal(empfaenger.tokenExpiresAt, null);
});

test("confirmNewsletterRecipientByToken: Ablauf genau jetzt, falscher Token und nicht-pending-Eintrag bestaetigen nicht", () => {
  const ablauf = "2026-08-16T12:00:00.000Z";
  const abgelaufen = mitEmpfaenger(["a@x.de"]);
  assert.equal(confirmNewsletterRecipientByToken(abgelaufen, "hash-a@x.de", ablauf), null);
  assert.equal(tenantNewsletterRecipients(abgelaufen, TENANT)[0].status, "pending");

  const falsch = mitEmpfaenger(["a@x.de"]);
  assert.equal(confirmNewsletterRecipientByToken(falsch, "anderer-hash", "2026-08-15T12:00:00.000Z"), null);

  const schonBestaetigt = mitEmpfaenger(["a@x.de"]);
  tenantNewsletterRecipients(schonBestaetigt, TENANT)[0].status = "confirmed";
  assert.equal(confirmNewsletterRecipientByToken(schonBestaetigt, "hash-a@x.de", "2026-08-15T12:00:00.000Z"), null);

  const ohneToken = mitEmpfaenger(["a@x.de"]);
  tenantNewsletterRecipients(ohneToken, TENANT)[0].tokenHash = null;
  assert.equal(confirmNewsletterRecipientByToken(ohneToken, "null", "2026-08-15T12:00:00.000Z"), null);
});
