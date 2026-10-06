import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  setNewsletterConsent,
  tenantNewsletterConsent,
} from "../src/store/state-ops.js";

const TENANT = "t_newsletter";

function freshTenantState() {
  const s = makeDefaultState();
  registerTenant(s, TENANT, { firstName: "Kunde", lastName: "N" });
  return s;
}

const isIso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

test("(a) frischer Tenant: NIE eingewilligt (Default false), consentAt null - kein Vorangekreuzt", () => {
  const s = freshTenantState();
  assert.deepEqual(tenantNewsletterConsent(s, TENANT), { consent: false, consentAt: null });
});

test("(b) unbekannter Tenant: lesend fail-closed 'nicht eingewilligt' (nie undefined/throw)", () => {
  const s = makeDefaultState();
  assert.deepEqual(tenantNewsletterConsent(s, "t_unknown"), { consent: false, consentAt: null });
});

test("(c) Einwilligen (true) -> consent true + ISO-Zeitstempel gesetzt", () => {
  const s = freshTenantState();
  setNewsletterConsent(s, TENANT, true);
  const view = tenantNewsletterConsent(s, TENANT);
  assert.equal(view.consent, true);
  assert.ok(isIso(view.consentAt), "consentAt ist eine ISO-Zeit");
});

test("(d) Widerruf (false) NACH Einwilligung -> consent false + Zeitstempel aktualisiert (kein Set-once)", () => {
  const s = freshTenantState();
  setNewsletterConsent(s, TENANT, true);
  const grantedAt = tenantNewsletterConsent(s, TENANT).consentAt;

  setNewsletterConsent(s, TENANT, false);
  const view = tenantNewsletterConsent(s, TENANT);
  assert.equal(view.consent, false, "Widerruf persistiert");
  assert.ok(isIso(view.consentAt), "consentAt bleibt eine ISO-Zeit");
  assert.notEqual(view.consentAt, undefined);
  void grantedAt;
});

test("(e) erneutes Einwilligen NACH Widerruf -> wieder true, Zeitstempel erneut gesetzt", () => {
  const s = freshTenantState();
  setNewsletterConsent(s, TENANT, true);
  setNewsletterConsent(s, TENANT, false);
  setNewsletterConsent(s, TENANT, true);
  const view = tenantNewsletterConsent(s, TENANT);
  assert.equal(view.consent, true);
  assert.ok(isIso(view.consentAt));
});

test("(f) ungueltiger Wert (String/Zahl/undefined/null) -> throw, State bleibt fail-closed unveraendert", () => {
  const s = freshTenantState();
  for (const bad of ["true", 1, 0, undefined, null, {}, []]) {
    assert.throws(() => setNewsletterConsent(s, TENANT, bad), /boolean/);
  }
  assert.deepEqual(tenantNewsletterConsent(s, TENANT), { consent: false, consentAt: null });
});

test("(g) unbekannter Tenant -> setNewsletterConsent wirft (kein stilles No-Op, Muster setKycLevel/setPrivateNumber)", () => {
  const s = makeDefaultState();
  assert.throws(() => setNewsletterConsent(s, "t_does_not_exist", true), /nicht gefunden/);
});
