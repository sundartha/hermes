import assert from "node:assert/strict";
import { test } from "node:test";

import { makeOutboundGates } from "../../src/telephony/outbound-gates.js";
import { runNummerntausch } from "../../src/worker/nummerntausch.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { mitSperreGelesen } from "../gemeinsam/sperre-gelesen-attrappe.js";
import { makePgTestStore } from "../pg-helpers.js";
import { seedState, startServer } from "../helpers.js";

const HTTP_FORBIDDEN = 403;
const ZIEL = "+491711234567";
const EIGENE_NUMMER = "+491700000000";
const FRISCH_ISO = "2026-08-27T16:45:00.000Z";
const FRISCH_MS = Date.parse(FRISCH_ISO);
const EINE_MINUTE_MS = 60000;
const PLATTFORM_NUMMER = "+15551230000";
const ALTE_NUMMER = "+4915799990001";

function speicher(nummern) {
  return mitSperreGelesen({
    tenantLanguage: () => "de",
    countOutboundCallsSince: () => 0,
    tenantPrivateNumber: () => null,
    tenantGeo: () => ({ country: "DE" }),
    load: () => ({
      numbers: nummern,
      outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCH_ISO }],
    }),
    kycReached: () => true,
    tenantContext: () => ({ ownerName: "Alice" }),
    resolveProfile: () => ({ unrestricted: true, allowedCountryCodes: null, maxCallsPerHour: null, allowedNumbers: [] }),
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    tenantSubscription: () => ({}),
    planMinutesExceeded: () => false,
    budgetExceeded: () => false,
    tryReserveOutboundBudget: () => true,
    reserveExceedsBudget: () => false,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 0, remainingCents: 1000 }),
    claimPlatformSpendWarning: () => null,
  });
}

function ketteFuer(nummern, konfig = {}) {
  return makeOutboundGates({
    store: speicher(nummern),
    config: withConfigNamespaces({
      outboundFrozen: false,
      allowedCountryCodes: ["+49"],
      maxCallsPerHour: 100,
      perTargetCallCap: 100,
      perTargetWindowMs: 86400000,
      platformAniE164: PLATTFORM_NUMMER,
      outboundAniGateEnabled: true,
      outboundAniGateMaxAgeMs: 900000,
      ...konfig,
    }),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
    audit: () => {},
    messaging: () => ({ sendSms: async () => {} }),
    aniOwnershipRecheck: async () => true,
  }).gates;
}

async function fahre(gates) {
  const ctx = { to: ZIEL, objective: "Ziel", b: { briefing: "Kontext" } };
  const echt = Date.now;
  Date.now = () => FRISCH_MS + EINE_MINUTE_MS;
  try {
    for (const gate of gates.filter((g) => g.name !== "reserve_budget")) {
      const denial = await gate.run(ctx);
      if (denial) return { denial, ctx };
    }
  } finally {
    Date.now = echt;
  }
  return { denial: null, ctx };
}

const aktiv = (e164) => ({ tenantId: "T", status: "active", provider: "telnyx", e164 });

test("Absender: der Anruf geht mit der eigenen Nummer des Mandanten raus, auch bei offener Plattform-Nummern-Meldung", async () => {
  const { denial, ctx } = await fahre(ketteFuer([aktiv(EIGENE_NUMMER)]));
  assert.equal(denial, null);
  assert.equal(ctx.fromNumber, EIGENE_NUMMER);
});

test("Absender: ohne eigene aktive Nummer bricht der Anruf mit 403 keine_tenant_nummer ab, bevor der Anbieter gefragt wird", async () => {
  const { denial } = await fahre(ketteFuer([{ ...aktiv(EIGENE_NUMMER), tenantId: "anderer" }]));
  assert.equal(denial.status, HTTP_FORBIDDEN);
  assert.equal(denial.audit.grund, "keine_tenant_nummer");
});

test("Start: PLATFORM_ANI_E164 wird nicht mehr gelesen, keine Warnung dazu im Log", async () => {
  const srv = await startServer({ seed: seedState({}), env: { PLATFORM_ANI_E164: "015112345678" } });
  try {
    assert.doesNotMatch(srv.stdout, /PLATFORM_ANI_E164/);
  } finally {
    await srv.stop();
  }
});

test("Nummerntausch: eine Nummer, die dem alten PLATFORM_ANI_E164 gleicht, ist wie jede Mandanten-Nummer ein Kandidat", async () => {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: "t_tausch", status: "active" });
  state.numbers.push({
    id: "num_t_tausch",
    tenantId: "t_tausch",
    e164: ALTE_NUMMER,
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_alt",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  const zeilen = [];
  const anbieter = {
    searchNumbers: async () => [{ e164: "+12025550100" }],
    orderNumber: async ({ e164 }) => ({ e164, providerNumberId: "pnum_neu" }),
    releaseNumber: async () => {},
  };
  await runNummerntausch({
    store,
    config: withConfigNamespaces({
      provisioningEnabled: true,
      maxNumbers: 50,
      maxNumbersPerTenant: 1,
      platformAniE164: ALTE_NUMMER,
      paymentEnabled: true,
    }),
    numberProvisioning: () => anbieter,
    sipRegistrar: { ensureRegistration: async ({ numberId }) => ({ phoneNumberId: `phnum_${numberId}`, angelegt: true }) },
    inboundTrunkSchreiber: null,
    logger: { log: (z) => zeilen.push(z), warn() {}, error() {} },
  });
  assert.ok(zeilen.some((z) => z.startsWith("[nummerntausch] tenant=t_tausch")));
});
