// A2 - Aktivierung provisioniert das plan-basierte Rechteprofil (GAP A). Backend-agnostisch
// ueber die geteilte state-ops-Schicht (deckt json + pglite-Logik; die pg-Persistenz +
// accountByTenant-SQL liegen separat in web-auth-pg.test.js). Muster wie
// p3-payment-webhook.test.js: Fake-Seams, offline, F.I.R.S.T.
import test from "node:test";
import assert from "node:assert/strict";
import { applyStripeWebhook, SUBSCRIPTION_EVENT } from "../src/billing/webhook.js";
import { activatePaidTenant } from "../src/billing/activation.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantSubscription,
  setProfile,
  tenantSubscription,
  setKycLevel,
  kycReached,
} from "../src/store/state-ops.js";
import { sanitizeProfile, KYC_OUTBOUND_MIN } from "../src/store/defaults.js";
import { planProfileFor } from "../src/plans.js";

// Duenner Store-Seam auf einem ECHTEN state-Objekt -> s.profiles ist assertbar (ein
// Fake-Recorder haette keine .profiles-Map). Genau die von activatePaidTenant + dem
// Webhook-Pfad genutzten Methoden, jede gegen die echte state-ops-Mutation.
function storeOn(s) {
  return {
    setKycLevel: (t, l) => setKycLevel(s, t, l),
    tenantSubscription: (t) => tenantSubscription(s, t),
    setProfile: (email, patch) => setProfile(s, email, patch),
    findTenantBySubscription: () => null,
    setTenantSubscription: (t, p) => setTenantSubscription(s, t, p),
  };
}

// account = {sub,email} | null. Zeichnet setStatus auf (wie die Webhook-Fakes), liefert
// den Account ueber accountByTenant (die A2-Bruecke tenantId -> email).
function fakeAccounts(account) {
  const calls = { setStatus: [] };
  return {
    calls,
    setStatus: async (t, st) => calls.setStatus.push([t, st]),
    accountByTenant: async () => account,
  };
}

// --- sanitizeProfile-Null-Toleranz (Regressions-Guard fuer A11/A4) ---
test("sanitizeProfile haelt maxCallsPerHour=null, droppt Nicht-Zahl", () => {
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: null }), { maxCallsPerHour: null });
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: 5 }), { maxCallsPerHour: 5 });
  assert.deepEqual(sanitizeProfile({ maxCallsPerHour: "viele" }), {}); // Bestand bleibt
});

// --- Direkter Pfad: voller Tier-Snapshot inkl. null ---
test("activatePaidTenant provisioniert das Tier-Profil auf account.email (alle 6 Felder)", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const acc = fakeAccounts({ sub: "u1", email: "u1@x" });
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: acc,
    provision: async () => {},
    tenant: "t_a",
  });

  assert.deepEqual(s.profiles["u1@x"], planProfileFor("starter")); // inkl. maxCallsPerHour:null
  assert.equal(s.profiles["u1@x"].maxCallsPerHour, null);
  assert.deepEqual(r.profile, { provisioned: true, reason: null, keys: 6 });
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]]);
  assert.equal(kycReached(s, "t_a", KYC_OUTBOUND_MIN), true);
});

// --- Toll-Fraud-Downgrade: Merge==Replace (voller 6-Felder-Snapshot ueberschreibt) ---
test("vorbestehendes unrestricted=true + allowedNumbers -> nach Aktivierung false/[]", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "business" });
  s.profiles["u1@x"] = { unrestricted: true, allowedNumbers: ["+491701234567"], maxCallsPerHour: 99 };
  await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts({ sub: "u1", email: "u1@x" }),
    provision: async () => {},
    tenant: "t_a",
  });
  assert.equal(s.profiles["u1@x"].unrestricted, false);
  assert.deepEqual(s.profiles["u1@x"].allowedNumbers, []);
  assert.equal(s.profiles["u1@x"].maxCallsPerHour, null);
});

// --- SKIP-Faelle: KYC/Status bleiben, kein Wurf, kein Profil-Eintrag ---
test("fehlender Account -> SKIP no_account, Status/KYC trotzdem gesetzt", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const acc = fakeAccounts(null);
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: acc,
    provision: async () => {},
    tenant: "t_a",
  });
  assert.equal(r.profile.provisioned, false);
  assert.equal(r.profile.reason, "no_account");
  assert.equal("u1@x" in s.profiles, false);
  assert.equal(kycReached(s, "t_a", KYC_OUTBOUND_MIN), true);
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]]);
});

test("leere account.email -> SKIP no_email, kein Wurf/Eintrag", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  setTenantSubscription(s, "t_a", { planSlug: "starter" });
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts({ sub: "u1", email: "" }),
    provision: async () => {},
    tenant: "t_a",
  });
  assert.equal(r.profile.reason, "no_email");
  assert.equal(Object.keys(s.profiles).length, 0);
});

test("kein/unbekannter planSlug -> SKIP no_plan, kein undefined-Profil", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {}); // keine setTenantSubscription -> planSlug null
  const r = await activatePaidTenant({
    store: storeOn(s),
    accounts: fakeAccounts({ sub: "u1", email: "u1@x" }),
    provision: async () => {},
    tenant: "t_a",
  });
  assert.equal(r.profile.reason, "no_plan");
  assert.equal(Object.keys(s.profiles).length, 0);
});

// --- Webhook-Pfad == direkter Pfad ---
test("Webhook-ACTIVATE mit plan_slug provisioniert identisch", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {});
  const acc = fakeAccounts({ sub: "u1", email: "u1@x" });
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
      provision: async () => {},
    },
  );
  assert.deepEqual(s.profiles["u1@x"], planProfileFor("business"));
});

test("planSlug-loser Webhook (frischer Tenant) -> SKIP, kein Profil, KYC/Status gesetzt", async () => {
  const s = makeDefaultState();
  registerTenant(s, "t_a", {}); // kein gespeicherter Slug, metadata ohne plan_slug
  const acc = fakeAccounts({ sub: "u1", email: "u1@x" });
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
      provision: async () => {},
    },
  );
  assert.equal(Object.keys(s.profiles).length, 0);
  assert.deepEqual(acc.calls.setStatus, [["t_a", "active"]]);
  assert.equal(kycReached(s, "t_a", KYC_OUTBOUND_MIN), true);
});
