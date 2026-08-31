// OC-Besitz-Verifikation der eigenen Nummer (PLAN-SECURITY.md Launch-Blocker geloest,
// Owner-Entscheidung 2026-08-21): Modell-Tests fuer src/own-number-verify.js (reine
// Funktionen, offline) UND src/store/state-ops.js (Rohdaten-Mutation Stufe 1 + Stufe 2).
// Muster newsletter-recipients-model.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashOwnNumberToken,
  newOwnNumberConfirmToken,
  ownNumberConfirmUrl,
  planStartOwnNumberConfirmation,
  publicPrivateNumberVerification,
  OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP,
  OWN_NUMBER_CONFIRM_TOKEN_TTL_MS,
} from "../src/own-number-verify.js";
import {
  makeDefaultState,
  registerTenant,
  setPrivateNumber,
  tenantPrivateNumber,
  tenantPrivateNumberVerified,
  privateNumberVerification,
  dailyPrivateNumberConfirmMailCount,
  startPrivateNumberEmailConfirmation,
  confirmPrivateNumberByToken,
  verifyPrivateNumberByInboundCall,
} from "../src/store/state-ops.js";

const TENANT = "t_own_number_verify";
const OWN = "+491737252163";
const OTHER = "+491729999001";

function freshTenantState() {
  const s = makeDefaultState();
  registerTenant(s, TENANT, { firstName: "Kunde", lastName: "N" });
  return s;
}

function fakeStoreFrom(s) {
  return { dailyPrivateNumberConfirmMailCount: (tenantId, sinceIso) => dailyPrivateNumberConfirmMailCount(s, tenantId, sinceIso) };
}

// ---- own-number-verify.js: Token-Bausteine --------------------------------------------

test("hashOwnNumberToken: deterministisch, gleicher Input -> gleicher Hash", () => {
  assert.equal(hashOwnNumberToken("abc"), hashOwnNumberToken("abc"));
  assert.notEqual(hashOwnNumberToken("abc"), hashOwnNumberToken("abd"));
});

test("newOwnNumberConfirmToken: tokenHash = hash(confirmToken), TTL 48h, beide Werte gesetzt", () => {
  const nowMs = Date.parse("2026-08-14T12:00:00.000Z");
  const t = newOwnNumberConfirmToken(nowMs);
  assert.equal(t.tokenHash, hashOwnNumberToken(t.confirmToken));
  assert.equal(Date.parse(t.tokenExpiresAt) - nowMs, OWN_NUMBER_CONFIRM_TOKEN_TTL_MS);
  assert.ok(t.confirmToken.length >= 32, "32-Byte-Hex-Token, keine schwache Zufallsquelle");
});

test("ownNumberConfirmUrl: baut den erwarteten Bestaetigungslink", () => {
  assert.equal(
    ownNumberConfirmUrl("https://hermes.example.test", "tok123"),
    "https://hermes.example.test/own-number/confirm?token=tok123",
  );
});

test("planStartOwnNumberConfirmation: unter dem Tageslimit -> ok", () => {
  const s = freshTenantState();
  const plan = planStartOwnNumberConfirmation({ store: fakeStoreFrom(s), tenantId: TENANT });
  assert.deepEqual(plan, { ok: true });
});

test(`planStartOwnNumberConfirmation: Tageslimit erreicht (${OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP}) -> reason=daily_limit`, () => {
  const s = freshTenantState();
  const now = new Date("2026-08-14T12:00:00.000Z");
  for (let i = 0; i < OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP; i++) {
    startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: `h${i}`, tokenExpiresAt: "x", now: now.toISOString() });
  }
  const plan = planStartOwnNumberConfirmation({ store: fakeStoreFrom(s), tenantId: TENANT, now });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "daily_limit");
});

test("planStartOwnNumberConfirmation: Log-Eintraege ausserhalb des 24h-Fensters zaehlen nicht mehr", () => {
  const s = freshTenantState();
  const old = new Date("2026-08-10T12:00:00.000Z");
  for (let i = 0; i < OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP; i++) {
    startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: `h${i}`, tokenExpiresAt: "x", now: old.toISOString() });
  }
  const now = new Date("2026-08-14T12:00:00.000Z");
  const plan = planStartOwnNumberConfirmation({ store: fakeStoreFrom(s), tenantId: TENANT, now });
  assert.equal(plan.ok, true);
});

test("publicPrivateNumberVerification: strippt auf {emailConfirmed, verified, verifiedAt}, strikt Boolean", () => {
  assert.deepEqual(
    publicPrivateNumberVerification({ emailConfirmed: true, verified: true, verifiedAt: "2026-08-14T00:00:00.000Z" }),
    { emailConfirmed: true, verified: true, verifiedAt: "2026-08-14T00:00:00.000Z" },
  );
  assert.deepEqual(publicPrivateNumberVerification(), { emailConfirmed: false, verified: false, verifiedAt: null });
  assert.deepEqual(
    publicPrivateNumberVerification({ emailConfirmed: "true", verified: 1 }),
    { emailConfirmed: false, verified: false, verifiedAt: null },
    "kein Truthiness-Vergleich",
  );
});

// ---- state-ops.js: setPrivateNumber Reset-Regel ----------------------------------------

test("setPrivateNumber: neue Nummer setzt den Verifikationszustand zurueck", () => {
  const s = freshTenantState();
  setPrivateNumber(s, TENANT, OWN);
  startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: "h", tokenExpiresAt: "2099-01-01T00:00:00.000Z" });
  confirmPrivateNumberByToken(s, "h", "2026-08-14T00:00:00.000Z");
  assert.equal(privateNumberVerification(s, TENANT).emailConfirmed, true, "Vorbedingung: bestaetigt vor der Aenderung");
  setPrivateNumber(s, TENANT, OTHER); // tatsaechliche Aenderung
  const state = privateNumberVerification(s, TENANT);
  assert.equal(state.emailConfirmed, false, "Reset bei echter Aenderung");
  assert.equal(state.verified, false);
});

test("setPrivateNumber: dieselbe Nummer erneut speichern ist idempotent - Bestaetigung bleibt", () => {
  const s = freshTenantState();
  setPrivateNumber(s, TENANT, OWN);
  startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: "h", tokenExpiresAt: "2099-01-01T00:00:00.000Z" });
  confirmPrivateNumberByToken(s, "h", "2026-08-14T00:00:00.000Z");
  assert.equal(privateNumberVerification(s, TENANT).emailConfirmed, true);
  setPrivateNumber(s, TENANT, OWN); // dieselbe Nummer
  assert.equal(privateNumberVerification(s, TENANT).emailConfirmed, true, "kein Reset bei unveraendertem Wert");
});

test("setPrivateNumber: Loeschen der Nummer setzt den Verifikationszustand ebenfalls zurueck", () => {
  const s = freshTenantState();
  setPrivateNumber(s, TENANT, OWN);
  startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: "h", tokenExpiresAt: "2099-01-01T00:00:00.000Z" });
  confirmPrivateNumberByToken(s, "h", "2026-08-14T00:00:00.000Z");
  setPrivateNumber(s, TENANT, "");
  assert.equal(tenantPrivateNumber(s, TENANT), null);
  assert.equal(privateNumberVerification(s, TENANT).emailConfirmed, false);
});

// ---- state-ops.js: Stufe 1 (E-Mail-Bestaetigung) ----------------------------------------

test("startPrivateNumberEmailConfirmation: unbekannter Tenant -> throw (kein stilles No-Op)", () => {
  const s = makeDefaultState();
  assert.throws(
    () => startPrivateNumberEmailConfirmation(s, "t_unknown", { tokenHash: "h", tokenExpiresAt: "x" }),
    /nicht gefunden/,
  );
});

test("confirmPrivateNumberByToken: gueltiger Token -> emailConfirmedAt gesetzt, Token geleert (Einmalverwendung)", () => {
  const s = freshTenantState();
  startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: "hash1", tokenExpiresAt: "2099-01-01T00:00:00.000Z" });
  const result = confirmPrivateNumberByToken(s, "hash1", "2026-08-14T00:00:00.000Z");
  assert.deepEqual(result, { tenantId: TENANT });
  assert.equal(privateNumberVerification(s, TENANT).emailConfirmed, true);
  assert.equal(confirmPrivateNumberByToken(s, "hash1", "2026-08-14T00:00:00.000Z"), null, "Einmalverwendung");
});

test("confirmPrivateNumberByToken: abgelaufener Token -> null, keine Mutation", () => {
  const s = freshTenantState();
  startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: "hash1", tokenExpiresAt: "2026-08-01T00:00:00.000Z" });
  const result = confirmPrivateNumberByToken(s, "hash1", "2026-08-14T00:00:00.000Z");
  assert.equal(result, null);
  assert.equal(privateNumberVerification(s, TENANT).emailConfirmed, false);
});

test("confirmPrivateNumberByToken: falscher Token -> null", () => {
  const s = freshTenantState();
  startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: "hash1", tokenExpiresAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(confirmPrivateNumberByToken(s, "falsch", "2026-08-14T00:00:00.000Z"), null);
});

// ---- state-ops.js: Stufe 2 (Anruf-Nachweis) -----------------------------------------

function verifiedTenant() {
  const s = freshTenantState();
  setPrivateNumber(s, TENANT, OWN);
  startPrivateNumberEmailConfirmation(s, TENANT, { tokenHash: "h", tokenExpiresAt: "2099-01-01T00:00:00.000Z" });
  confirmPrivateNumberByToken(s, "h", "2026-08-14T00:00:00.000Z");
  return s;
}

test("verifyPrivateNumberByInboundCall: From == eigene Nummer, Stufe 1 abgeschlossen -> verified true, Feld gesetzt", () => {
  const s = verifiedTenant();
  const result = verifyPrivateNumberByInboundCall(s, TENANT, { fromE164: OWN, nowIso: "2026-08-15T00:00:00.000Z" });
  assert.equal(result.verified, true);
  assert.equal(tenantPrivateNumberVerified(s, TENANT), true);
  assert.equal(privateNumberVerification(s, TENANT).verifiedAt, "2026-08-15T00:00:00.000Z");
});

test("verifyPrivateNumberByInboundCall: From != eigene Nummer -> false, nichts mutiert", () => {
  const s = verifiedTenant();
  const result = verifyPrivateNumberByInboundCall(s, TENANT, { fromE164: OTHER, nowIso: "2026-08-15T00:00:00.000Z" });
  assert.equal(result.verified, false);
  assert.equal(tenantPrivateNumberVerified(s, TENANT), false);
});

test("verifyPrivateNumberByInboundCall: Match VOR E-Mail-Bestaetigung -> false + reason, nichts mutiert", () => {
  const s = freshTenantState();
  setPrivateNumber(s, TENANT, OWN); // Stufe 1 NICHT durchlaufen
  const result = verifyPrivateNumberByInboundCall(s, TENANT, { fromE164: OWN, nowIso: "2026-08-15T00:00:00.000Z" });
  assert.equal(result.verified, false);
  assert.equal(result.reason, "call_match_before_email_confirm");
  assert.equal(tenantPrivateNumberVerified(s, TENANT), false);
});

test("verifyPrivateNumberByInboundCall: keine hinterlegte Nummer -> false, kein Wurf", () => {
  const s = freshTenantState();
  const result = verifyPrivateNumberByInboundCall(s, TENANT, { fromE164: OWN, nowIso: "2026-08-15T00:00:00.000Z" });
  assert.equal(result.verified, false);
});

test("verifyPrivateNumberByInboundCall: unbekannter Tenant -> false, kein Wurf", () => {
  const s = makeDefaultState();
  const result = verifyPrivateNumberByInboundCall(s, "t_unknown", { fromE164: OWN, nowIso: "2026-08-15T00:00:00.000Z" });
  assert.equal(result.verified, false);
});

test("verifyPrivateNumberByInboundCall: bereits verifiziert -> zweiter Anruf mutiert nichts mehr (Einmalverwendung)", () => {
  const s = verifiedTenant();
  verifyPrivateNumberByInboundCall(s, TENANT, { fromE164: OWN, nowIso: "2026-08-15T00:00:00.000Z" });
  const secondResult = verifyPrivateNumberByInboundCall(s, TENANT, { fromE164: OWN, nowIso: "2026-08-20T00:00:00.000Z" });
  assert.equal(secondResult.verified, false);
  assert.equal(privateNumberVerification(s, TENANT).verifiedAt, "2026-08-15T00:00:00.000Z", "erster Zeitstempel bleibt");
});

test("tenantPrivateNumberVerified / privateNumberVerification: fail-closed Default bei frischem Tenant", () => {
  const s = freshTenantState();
  assert.equal(tenantPrivateNumberVerified(s, TENANT), false);
  assert.deepEqual(privateNumberVerification(s, TENANT), { emailConfirmed: false, verified: false, verifiedAt: null });
});
