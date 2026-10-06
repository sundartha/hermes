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

test("BK3-T1 Aktivierung fragt genau eine Dry-Run-Nummer an", () => {
  const s = makeDefaultState();
  registerTenant(s, "t1", {});
  const r = requestNumberForPaidTenant(s, { tenantId: "t1", fallbackCountry: "DE", maxNumbers: HIGH, maxNumbersPerTenant: HIGH });
  assert.equal(r.ok, true);
  assert.equal(r.number.status, NUMBER_STATUS.REQUESTED);
  assert.equal(s.numbers.filter((n) => n.tenantId === "t1").length, 1);
});

test("BK3 fallbackCountry US (keine Tenant-Geo) -> Nummer mit country US", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_us", {});
  const r = requestNumberForPaidTenant(s, { tenantId: "t_us", fallbackCountry: "US", maxNumbers: HIGH, maxNumbersPerTenant: HIGH });
  assert.equal(r.ok, true);
  assert.equal(r.number.country, "US");
});

test("BK3 fallbackCountry US (Webhook-/Aktivierungspfad) liefert number.language='en' ueber den Weltdefault (ex DID-03)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_us_lang", {});
  const r = requestNumberForPaidTenant(s, {
    tenantId: "t_us_lang",
    fallbackCountry: "US",
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });
  assert.equal(r.ok, true);
  assert.equal(r.number.language, "en");
});

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

test("requestNumberForPaidTenant: Tenant OHNE Geo erbt die Sprache NICHT vom Plattform-Fallback-Land", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_no_geo", {});
  const r = requestNumberForPaidTenant(s, {
    tenantId: "t_no_geo",
    fallbackCountry: "FR",
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });
  assert.equal(r.ok, true);
  assert.equal(r.number.country, "FR", "Kauf-Land folgt dem Fallback");
  assert.notEqual(r.number.language, "fr", "Sprache folgt dem Fallback-Land NICHT");
});

test("requestNumberForPaidTenant: Tenant MIT Geo DE schlaegt fallbackCountry FR -> 'de'", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_geo_de", {});
  setTenantGeo(s, "t_geo_de", { country: "DE", defaultLanguage: "de" });
  const r = requestNumberForPaidTenant(s, {
    tenantId: "t_geo_de",
    fallbackCountry: "FR",
    maxNumbers: HIGH,
    maxNumbersPerTenant: HIGH,
  });
  assert.equal(r.ok, true);
  assert.equal(r.number.language, "de", "Tenant-Geo gewinnt ueber den Plattform-Fallback");
});

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
  assert.equal(findTenant(s, "t3b").numberProvisionSkipReason, GLOBAL_CAP_REASON);
});

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
      tenantExists: (tenantId) => Boolean(findTenant(s, tenantId)),
      tenantSubscription: () => ({ planSlug: null }), setProfile: () => ({ changed: [] }),
      clearSuspendedAt: () => {},
      billingHoldActive: () => null,
      stampBudgetPeriod: () => false,
      ensureTenant: async () => {},
      clearBillingHold: () => {},
    },
    accounts: { setStatus: async () => {}, accountByTenant: async () => null },
    sessions: { invalidateByTenant: async () => {} },
    audit: () => {},
    req: {},
    provision,
  };
  const event = JSON.parse(body);
  await applyStripeWebhook(event, deps);
  await applyStripeWebhook(event, deps);
  assert.equal(s.numbers.filter((n) => n.tenantId === "t4").length, 1, "Retry kauft nicht doppelt");
  assert.equal(s.numbers[0].status, NUMBER_STATUS.REQUESTED);
});
