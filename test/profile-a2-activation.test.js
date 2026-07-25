// A2 - Aktivierung provisioniert das plan-basierte Rechteprofil (GAP A). Phase S: das Profil
// keyt auf die tenantId (vormals account.email). Backend-agnostisch ueber die geteilte
// state-ops-Schicht (deckt json + pglite-Logik). Muster wie p3-payment-webhook.test.js:
// Fake-Seams, offline, F.I.R.S.T.
import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import { activatePaidTenant, profileAuditDetail } from "../src/billing/activation.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantSubscription,
  setProfile,
  tenantSubscription,
  setKycLevel,
  kycReached,
  clearSuspendedAt,
} from "../src/store/state-ops.js";
import { sanitizeProfile, KYC_OUTBOUND_MIN } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";

// Duenner Store-Seam auf einem ECHTEN state-Objekt -> s.profiles ist assertbar (ein
// Fake-Recorder haette keine .profiles-Map). Genau die von activatePaidTenant + dem
// Webhook-Pfad genutzten Methoden, jede gegen die echte state-ops-Mutation. setProfile
// keyt key-agnostisch (Phase S: der Aufrufer reicht die tenantId).
function storeOn(s) {
  return {
    setKycLevel: (t, l) => setKycLevel(s, t, l),
    tenantSubscription: (t) => tenantSubscription(s, t),
    setProfile: (key, patch) => setProfile(s, key, patch),
    findTenantBySubscription: () => null,
    setTenantSubscription: (t, p) => setTenantSubscription(s, t, p),
    // tenant-prolif-c: activatePaidTenant loescht den Grace-Anker bei Reaktivierung.
    clearSuspendedAt: (t) => clearSuspendedAt(s, t),
    // GAP-04: Spiegel-Nachzug NACH erfolgreicher Aktivierung - json-Backend-Muster (No-op,
    // nur pg braucht den echten DB-Roundtrip).
    ensureTenant: async () => {},
    // GAP-03: Reversibilitaet bei ACTIVATE-Erfolg - hier nicht relevant (kein Hold gesetzt).
    clearBillingHold: () => {},
  };
}

// Zeichnet setStatus auf (wie die Webhook-Fakes). accountByTenant wird seit Phase S NICHT
// mehr gebraucht (Profil keyt auf die tenantId), nur noch setStatus.
function fakeAccounts() {
  const calls = { setStatus: [] };
  return {
    calls,
    setStatus: async (t, st) => calls.setStatus.push([t, st]),
  };
}

// --- sanitizeProfile-Null-Toleranz (Regressions-Guard fuer A11/A4) ---
test("sanitizeProfile haelt maxCallsPerHour=null, droppt Nicht-Zahl", () => {
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: null }), { maxCallsPerHour: null });
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: 5 }), { maxCallsPerHour: 5 });
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: "viele" }), {}); // Bestand bleibt
});

// --- Audit-Detail-Mapper: alle drei Ausgabe-Zweige (Objekt -> String) ---
test("profileAuditDetail mappt ok/skip/none auf das Audit-Fragment", () => {
  assert.equal(profileAuditDetail({ provisioned: true, keys: 6 }), "profile=ok:6");
  assert.equal(profileAuditDetail({ provisioned: false, reason: "no_plan" }), "profile=skip:no_plan");
  assert.equal(profileAuditDetail(undefined), "profile=none");
});

// --- Direkter Pfad: voller Tier-Snapshot inkl. null, auf die tenantId ---
test("activatePaidTenant provisioniert das Tier-Profil auf die tenantId (alle 6 Felder)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const acc = fakeAccounts();
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: acc,
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: "t_a",
  });

  assert.deepEqual(s.profiles["t_a"], planProfileFor("starter")); // inkl. maxCallsPerHour:null
  assert.equal(s.profiles["t_a"].maxCallsPerHour, null);
  assert.deepEqual(r.profile, { provisioned: true, reason: null, keys: 6 });
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]]);
  assert.equal(kycReached(s, "t_a", KYC_OUTBOUND_MIN), true);
});

// --- Toll-Fraud-Downgrade: Merge==Replace (voller 6-Felder-Snapshot ueberschreibt) ---
test("vorbestehendes unrestricted=true + allowedNumbers -> nach Aktivierung false/[]", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "business" });
  s.profiles["t_a"] = { unrestricted: true, allowedNumbers: ["+491701234567"], maxCallsPerHour: 99 };
  await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts(),
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: "t_a",
  });
  assert.equal(s.profiles["t_a"].unrestricted, false);
  assert.deepEqual(s.profiles["t_a"].allowedNumbers, []);
  assert.equal(s.profiles["t_a"].maxCallsPerHour, null);
});

// --- SKIP no_plan: KYC/Status bleiben, kein Wurf, kein Profil-Eintrag ---
test("kein/unbekannter planSlug -> SKIP no_plan, kein undefined-Profil", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {}); // keine setTenantSubscription -> planSlug null
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts(),
    provision: async () => ({ ok: true, reason: "queued" }),
    tenant: "t_a",
  });
  assert.equal(r.profile.reason, "no_plan");
  assert.equal(Object.keys(s.profiles).length, 0);
});

// --- Webhook-Pfad == direkter Pfad ---
test("Webhook-ACTIVATE mit plan_slug provisioniert identisch (auf die tenantId)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  const acc = fakeAccounts();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: {
          id: "sub_1",
          status: "active",
          metadata: { tenant_ref: "t_a", plan_slug: "business" },
        },
      },
    },
    {
      store: storeOn(s),
      accounts: acc,
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
    },
  );
  assert.deepEqual(s.profiles["t_a"], planProfileFor("business"));
});

test("planSlug-loser Webhook (frischer Tenant) -> SKIP, kein Profil, KYC/Status gesetzt", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {}); // kein gespeicherter Slug, metadata ohne plan_slug
  const acc = fakeAccounts();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: { id: "sub_1", status: "active", metadata: { tenant_ref: "t_a" } },
      },
    },
    {
      store: storeOn(s),
      accounts: acc,
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
    },
  );
  assert.equal(Object.keys(s.profiles).length, 0);
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]]);
  assert.equal(kycReached(s, "t_a", KYC_OUTBOUND_MIN), true);
});

// --- Fix B (0-EUR-Checkout generisch): syncNumberSetupFeeExemption in activatePaidTenant.
// Kernbeweis der Race-Fix-Korrektheit (s. PLAN-VOUCHER-SETUP-FEE-GAP.md Fix B): die
// Pruefung "ist diese Subscription 0 EUR" lebt EINMAL in activation.js, damit BEIDE
// Race-Teilnehmer (Checkout-Return UND Webhook, die beide activatePaidTenant rufen)
// garantiert denselben Code treffen - unabhaengig davon, wer das Aktivierungs-Rennen
// gewinnt (webhook.js: der Webhook gewinnt es REGELMAESSIG). ---
function fakeExemptBilling({ exempt = true, throwErr = null } = {}) {
  const log = [];
  return {
    log,
    async retrieveSubscription(subscriptionId) {
      log.push(subscriptionId);
      if (throwErr) throw throwErr;
      return { planSlug: null, numberSetupFeeExempt: exempt };
    },
  };
}

test("activatePaidTenant: billing.retrieveSubscription liefert exempt:true -> VOR provision() persistiert (Race-Schutz)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { subscriptionId: "sub_free" });
  const billing = fakeExemptBilling({ exempt: true });
  await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts(),
    billing,
    provision: async () => {
      // Zum Zeitpunkt von provision() MUSS das Flag bereits gesetzt sein: das
      // ausgeloeste, idempotente Nummern-Provisioning kann sehr schnell in den
      // echten placeHold laufen (Provisioning-Drain, single-flight).
      assert.equal(
        tenantSubscription(s, "t_a").numberSetupFeeExempt,
        true,
        "Flag VOR provision() gesetzt",
      );
      return { ok: true, reason: "queued" };
    },
    tenant: "t_a",
  });
  assert.deepEqual(billing.log, ["sub_free"]);
  assert.equal(tenantSubscription(s, "t_a").numberSetupFeeExempt, true);
});

test("activatePaidTenant: billing.retrieveSubscription wirft -> Flag bleibt false, KYC/Status/Provisioning laufen trotzdem durch (fail-soft)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { subscriptionId: "sub_broken" });
  const billing = fakeExemptBilling({ throwErr: new Error("Stripe HTTP 500") });
  const acc = fakeAccounts();
  const provisioned = [];
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: acc,
    billing,
    provision: async (t) => {
      provisioned.push(t);
      return { ok: true, reason: "queued" };
    },
    tenant: "t_a",
  });
  assert.equal(
    tenantSubscription(s, "t_a").numberSetupFeeExempt,
    false,
    "Flag bleibt unberuehrt (fail-closed Default) - ein Stripe-Hakler darf keinen stillen Bypass ausloesen",
  );
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]], "Status-Flip laeuft trotz Stripe-Fehler");
  assert.deepEqual(
    provisioned,
    ["t_a"],
    "Provisioning laeuft trotz Stripe-Fehler (P8: ein Stripe-Hakler blockt nie KYC/Status/Provisioning)",
  );
  assert.equal(r.profile.reason, "no_plan");
});

test("Webhook-ACTIVATE mit billing setzt numberSetupFeeExempt IDENTISCH zum direkten Pfad (beide Race-Teilnehmer treffen denselben Code)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  const billing = fakeExemptBilling({ exempt: true });
  const acc = fakeAccounts();
  await applyStripeWebhook(
    {
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: {
        object: {
          id: "sub_webhook_free",
          status: "active",
          metadata: { tenant_ref: "t_a", plan_slug: "business" },
        },
      },
    },
    {
      store: storeOn(s),
      accounts: acc,
      billing,
      sessions: { invalidateByTenant: async () => {} },
      audit: () => {},
      req: {},
      provision: async () => ({ ok: true, reason: "queued" }),
    },
  );
  assert.equal(
    tenantSubscription(s, "t_a").numberSetupFeeExempt,
    true,
    "Webhook-Pfad setzt das Flag ueber dieselbe activation.js-Logik wie der direkte Pfad",
  );
  assert.deepEqual(billing.log, ["sub_webhook_free"]);
});
