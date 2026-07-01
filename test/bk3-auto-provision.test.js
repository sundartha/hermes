// BK3 - Auto-Provisioning nach bestaetigter Abo-Aktivierung (Dry-Run, offline).
// Beweist den vom Spec geforderten Dreiklang gegen die ECHTE Decision-Logik
// (requestNumberForPaidTenant), plus einen signierten End-to-End-Pfad ueber
// verifyStripeSignature + applyStripeWebhook mit Store-Double (kein Server-Spawn,
// Repo-Konvention). Kein Cap-Umgehen wie im P3-Test: der Limit-Fall wird HIER geprueft.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { applyStripeWebhook, verifyStripeSignature, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import { requestNumberForPaidTenant } from "../src/billing/provision-trigger.js";
import { makeDefaultState, registerTenant, setTenantGeo, findTenant } from "../src/store/state-ops.js";
import { NUMBER_STATUS, GLOBAL_CAP_REASON } from "../src/store/defaults.js";

const HIGH = 100;
const SECRET = "whsec_bk3_test";
const NOW = 1_700_000_000;

// T1: bestaetigte Aktivierung (Dry-Run) -> genau EINE 'requested'-Nummer.
test("BK3-T1 Aktivierung fragt genau eine Dry-Run-Nummer an", () => {
  const s = makeDefaultState();
  registerTenant(s, "t1", {});
  const r = requestNumberForPaidTenant(s, { tenantId: "t1", fallbackCountry: "DE", maxNumbers: HIGH, maxNumbersPerTenant: HIGH });
  assert.equal(r.ok, true);
  assert.equal(r.number.status, NUMBER_STATUS.REQUESTED);
  assert.equal(s.numbers.filter((n) => n.tenantId === "t1").length, 1);
});

// AM5: ohne Tenant-Geo greift fallbackCountry als Land der Nummer (US fuer Tests).
test("BK3 fallbackCountry US (keine Tenant-Geo) -> Nummer mit country US", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_us", {});
  const r = requestNumberForPaidTenant(s, { tenantId: "t_us", fallbackCountry: "US", maxNumbers: HIGH, maxNumbersPerTenant: HIGH });
  assert.equal(r.ok, true);
  assert.equal(r.number.country, "US");
});

// forceNumberCountry entkoppelt das KAUF-Land vom Herkunftsland: Tenant-Geo DE, aber
// erzwungenes US -> number.country=US, number.language bleibt am Herkunftsland (de).
// Beweist die Provision-Pfad-Haelfte des Kauf-Land-Overrides (Onboard-Haelfte: f1-geo-onboard).
test("BK3 forceNumberCountry US ueberschreibt Kauf-Land, Sprache bleibt am Herkunftsland (DE)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_force", {});
  setTenantGeo(s, "t_force", { country: "DE", defaultLanguage: "de" });
  const r = requestNumberForPaidTenant(s, {
    tenantId: "t_force",
    fallbackCountry: "DE",
    forceNumberCountry: "US",
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });
  assert.equal(r.ok, true);
  assert.equal(r.number.country, "US", "Kauf-Land erzwungen US");
  assert.equal(r.number.language, "de", "Sprache am Herkunftsland DE");
});

// T2: Idempotenz - zweite Aktivierung kauft nicht doppelt.
test("BK3-T2 zweiter Trigger -> already_provisioned, weiterhin eine Nummer", () => {
  const s = makeDefaultState();
  registerTenant(s, "t2", {});
  const opts = { tenantId: "t2", fallbackCountry: "DE", maxNumbers: HIGH, maxNumbersPerTenant: HIGH };
  assert.equal(requestNumberForPaidTenant(s, opts).ok, true);
  const second = requestNumberForPaidTenant(s, opts);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already_provisioned");
  assert.equal(s.numbers.filter((n) => n.tenantId === "t2").length, 1);
});

// T3: Limit -> kein Kauf (tenant_cap UND global_cap). Grund ist der testbare Vertrag,
// auf den server.js den Audit-Eintrag abbildet (audit() = console-IO, per T-Serie
// nicht im Unit-Test asserted - Smoke/BK5 deckt die Emission).
test("BK3-T3 Cap blockt: keine Nummer, Grund tenant_cap", () => {
  const s = makeDefaultState();
  registerTenant(s, "t3", {});
  const r = requestNumberForPaidTenant(s, { tenantId: "t3", fallbackCountry: "DE", maxNumbers: HIGH, maxNumbersPerTenant: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "tenant_cap");
  assert.equal(s.numbers.filter((n) => n.tenantId === "t3").length, 0);
});

test("BK3-T3b global cap -> global_cap, keine Nummer", () => {
  const s = makeDefaultState();
  registerTenant(s, "t3b", {});
  const r = requestNumberForPaidTenant(s, { tenantId: "t3b", fallbackCountry: "DE", maxNumbers: 0, maxNumbersPerTenant: HIGH });
  assert.equal(r.reason, "global_cap");
  assert.equal(s.numbers.length, 0);
  // Fix B (Webhook-Pfad): der Skip ist auch ueber requestNumberForPaidTenant sichtbar,
  // da beide Aufrufer denselben requestNumber teilen (G5).
  assert.equal(findTenant(s, "t3b").numberProvisionSkipReason, GLOBAL_CAP_REASON);
});

// T4: signierter End-to-End-Webhook -> Nummer im Store, idempotent. provision-Seam
// wendet den ECHTEN Core auf ein gemeinsames s an (Dry-Run: kein queue/drain).
test("BK3-T4 signierter active-Webhook -> eine Dry-Run-Nummer, Retry idempotent", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t4", {});
  const body = JSON.stringify({
    type: SUBSCRIPTION_EVENT.CREATED,
    data: { object: { id: "sub_4", status: "active", metadata: { tenant_ref: "t4", plan_slug: "starter" } } },
  });
  const mac = crypto.createHmac("sha256", SECRET).update(`${NOW}.${body}`).digest("hex");
  assert.equal(verifyStripeSignature({ rawBody: body, signatureHeader: `t=${NOW},v1=${mac}`, secret: SECRET, nowS: NOW }), true);

  const provision = async (tenant) =>
    requestNumberForPaidTenant(s, { tenantId: tenant, fallbackCountry: "DE", maxNumbers: HIGH, maxNumbersPerTenant: HIGH });
  const deps = {
    store: {
      findTenantBySubscription: () => null, setTenantSubscription: () => {}, setKycLevel: () => {},
      reactivateTenantCancelledNumbers: () => {},
      tenantSubscription: () => ({ planSlug: null }), setProfile: () => ({ changed: [] }),
    },
    accounts: { setStatus: async () => {}, accountByTenant: async () => null },
    sessions: { invalidateByTenant: async () => {} },
    audit: () => {},
    req: {},
    provision,
  };
  const event = JSON.parse(body);
  await applyStripeWebhook(event, deps);
  await applyStripeWebhook(event, deps); // identischer Retry
  assert.equal(s.numbers.filter((n) => n.tenantId === "t4").length, 1, "Retry kauft nicht doppelt");
  assert.equal(s.numbers[0].status, NUMBER_STATUS.REQUESTED);
});
