// F2-Newsletter-Recipients: Modell-Tests fuer Normalisierung/Format/Duplikat/Cap (offline,
// F.I.R.S.T., kein IO). Deckt src/newsletter-recipients.js (Gate-Entscheidung, reine
// Funktionen) UND src/store/state-ops.js (Rohdaten-Mutation: add/remove) ab - Muster
// newsletter-consent-store.test.js.
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
} from "../src/store/state-ops.js";

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

// ---- normalizeEmail / isValidEmailFormat ---------------------------------------------

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

// ---- planAddNewsletterRecipient (Gate-Entscheidung) ------------------------------------

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
    removeNewsletterRecipient(s, TENANT, `daily${i}@example.test`); // Cap 5 nicht ueberschreiten
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
  const now = new Date("2026-08-14T12:00:00.000Z"); // 4 Tage spaeter
  const plan = planAddNewsletterRecipient({
    store: fakeStoreFrom(s),
    tenantId: TENANT,
    rawEmail: "frisch@example.test",
    accountEmail: null,
    now,
  });
  assert.equal(plan.ok, true, "alte Log-Eintraege ausserhalb des rollierenden Fensters blockieren nicht");
});

// ---- state-ops: addNewsletterRecipient / removeNewsletterRecipient --------------------

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
