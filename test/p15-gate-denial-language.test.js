import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates, E164_FORMAT_ERROR } from "../src/telephony/outbound-gates.js";
import { mitRoutenServer, postJson } from "./anrufe/routen-server.js";
import { localeFor, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { spendMonthEndDate } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const VALID_TO = "+491711234567";
const DENIED_TO = "+870123456789";
const FOREIGN_TO = "+15551234567";
const HTTP_BAD_REQUEST = 400;

function defaultStore(language, overrides = {}) {
  return {
    tenantLanguage: () => language,
    countOutboundCallsSince: () => 0,
    kycReached: () => true,
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    budgetExceeded: () => false,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    tryReserveOutboundBudget: () => true,
    reserveExceedsBudget: () => false,
    withStoreLock: (fn) => fn(),
    claimPlatformSpendWarning: () => null,
    ...overrides,
  };
}

function makeDeps(language, o = {}) {
  return {
    store: defaultStore(language, o.store),
    config: withConfigNamespaces({
      outboundFrozen: false,
      allowedCountryCodes: ["+49"],
      maxCallsPerHour: 100,
      perTargetWindowMs: 3600000,
      perTargetCallCap: 100,
      platformSpendCapCents: 800,
      ...o.config,
    }),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
  };
}

const gateBy = (gates, name) => gates.find((g) => g.name === name);

const PLAIN_PROFILE = Object.freeze({
  unrestricted: false,
  allowedCountryCodes: null,
  maxCallsPerHour: null,
  allowedNumbers: [],
});
const OPEN_PROFILE = Object.freeze({ ...PLAIN_PROFILE, unrestricted: true });

function baseCtx(overrides = {}) {
  return {
    req: {},
    to: VALID_TO,
    b: {},
    requestedBy: "owner",
    tenantId: "T",
    profile: OPEN_PROFILE,
    ...overrides,
  };
}

const CASES = [
  {
    label: "kyc",
    gate: "kyc",
    status: 403,
    grund: "kyc",
    deps: { store: { kycReached: () => false } },
    textOf: (g) => g.kycInsufficient,
  },
  {
    label: "abo",
    gate: "number_gate",
    status: 403,
    grund: "abo",
    deps: { store: { tenantInactive: () => true } },
    ctx: { profile: PLAIN_PROFILE },
    textOf: (g) => g.subscriptionInactive,
  },
  {
    label: "billing_hold",
    gate: "number_gate",
    status: 403,
    grund: "billing_hold",
    deps: { store: { billingHoldActive: () => ({ reason: "payment_failed" }) } },
    ctx: { profile: PLAIN_PROFILE },
    textOf: (g) => g.billingHold,
  },
  {
    label: "allowlist",
    gate: "number_gate",
    status: 403,
    grund: "allowlist",
    deps: { store: { tenantActiveSubscriber: () => false } },
    ctx: { profile: PLAIN_PROFILE },
    textOf: (g) => g.notAuthorized,
  },
  {
    label: "denylist",
    gate: "number_gate",
    status: 403,
    grund: "denylist",
    ctx: { to: DENIED_TO },
    textOf: (g) => g.deniedNumber(DENIED_TO),
  },
  {
    label: "land",
    gate: "number_gate",
    status: 403,
    grund: "land",
    ctx: { to: FOREIGN_TO },
    textOf: (g) => g.countryBlocked(FOREIGN_TO),
  },
  {
    label: "stundenlimit",
    gate: "number_gate",
    status: 429,
    grund: "stundenlimit",
    deps: { config: { maxCallsPerHour: 5 }, store: { countOutboundCallsSince: () => 5 } },
    textOf: (g) => g.hourLimit,
  },
  {
    label: "ziel_limit",
    gate: "number_gate",
    status: 429,
    grund: "ziel_limit",
    deps: {
      config: { perTargetCallCap: 2 },
      store: { countOutboundCallsSince: (_since, filter) => (filter?.to ? 2 : 0) },
    },
    textOf: (g) => g.perTargetLimit,
  },
  {
    label: "budget_tenant (lesbarer Bucket)",
    gate: "budget",
    status: 402,
    grund: "budget_tenant",
    deps: { store: { budgetExceeded: () => true } },
    textOf: (g) => g.budgetCapReached("3.50", "10.00"),
  },
  {
    label: "budget_tenant (D7, unbuchbarer Bucket)",
    gate: "budget",
    status: 402,
    grund: "budget_tenant",
    deps: {
      store: {
        budgetExceeded: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: null, remainingCents: null }),
      },
    },
    textOf: (g) => g.budgetUnreadable,
  },
  {
    label: "reserve_ueber_rest",
    gate: "reserve_budget",
    status: 402,
    grund: "reserve_ueber_rest",
    deps: {
      store: {
        tryReserveOutboundBudget: () => false,
        reserveExceedsBudget: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: 779, remainingCents: 21 }),
      },
    },
    ctx: { reserveCents: 60 },
    textOf: (g) => g.reserveOverRemaining("0.39", spendMonthEndDate(Date.now())),
  },
  {
    label: "reserve_erschoepft",
    gate: "reserve_budget",
    status: 402,
    grund: "reserve_erschoepft",
    deps: {
      store: {
        tryReserveOutboundBudget: () => false,
        reserveExceedsBudget: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: 800, remainingCents: 0 }),
      },
    },
    ctx: { reserveCents: 60 },
    textOf: (g) => g.reserveExhausted("0.60", spendMonthEndDate(Date.now())),
  },
];

async function denialFor(testCase, language) {
  const { gates } = makeOutboundGates(makeDeps(language, testCase.deps));
  return gateBy(gates, testCase.gate).run(baseCtx(testCase.ctx));
}

for (const testCase of CASES) {
  test(`Gate-Ablehnung ${testCase.label}: Text folgt der Tenant-Sprache, grund/status bleiben sprachfrei`, async () => {
    const texts = [];
    for (const language of SUPPORTED_LANGUAGES) {
      const denial = await denialFor(testCase, language);
      assert.equal(denial.status, testCase.status, `${language}: Status ist Protokoll`);
      assert.equal(denial.audit.grund, testCase.grund, `${language}: grund ist Protokoll`);
      assert.match(
        denial.audit.detail,
        new RegExp(`grund=${testCase.grund}`),
        `${language}: die Forensik-Zeile traegt denselben Grund`,
      );
      assert.equal(
        denial.body.error,
        testCase.textOf(localeFor(language).gates),
        `${language}: der Anzeigetext kommt aus dem Locale-Buendel`,
      );
      texts.push(denial.body.error);
    }
    assert.equal(
      new Set(texts).size,
      SUPPORTED_LANGUAGES.length,
      "de/en/fr liefern drei VERSCHIEDENE Texte (der Kanal ist wirklich verzweigt)",
    );
  });
}

test("budgetUnreadable traegt in KEINER Sprache eine Ziffer", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    assert.ok(!/\d/.test(localeFor(language).gates.budgetUnreadable), `${language}: budgetUnreadable ziffernfrei`);
  }
});

test("Formatfehler (400): sprach-unabhaengiger E164_FORMAT_ERROR, kein Audit", async () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const { gates } = makeOutboundGates(makeDeps(language));
    const formatDenial = await gateBy(gates, "number_gate").run(baseCtx({ to: "keine-nummer" }));
    assert.equal(formatDenial.status, 400);
    assert.equal(formatDenial.audit, null);
    assert.equal(formatDenial.body.error, E164_FORMAT_ERROR);
    const trunkDenial = await gateBy(gates, "trunk_zero_normalized").run(
      baseCtx({ to: "+4901737123456" }),
    );
    assert.equal(trunkDenial.status, 400);
    assert.equal(trunkDenial.audit, null);
    assert.equal(trunkDenial.body.error, E164_FORMAT_ERROR);
  }
});

test("P15b/C1: der E.164-Formattext ist englisch und liegt in KEINEM Locale-Buendel", () => {
  assert.match(E164_FORMAT_ERROR, /must be E\.164/);
  for (const language of SUPPORTED_LANGUAGES) {
    const gates = localeFor(language).gates;
    const values = Object.values(gates).map((v) =>
      typeof v === "function" ? v(...Array.from({ length: v.length }, () => "<arg>")) : v,
    );
    assert.ok(
      !values.includes(E164_FORMAT_ERROR),
      `${language}: der Formatfehler gehoert NICHT in LOCALES.${language}.gates`,
    );
  }
});

test("P15b/C1: die Anruf-Route lehnt eine Nummer mit Fernvorwahl-Null vor allen Gates mit dem E.164-Formattext ab", async () => {
  const { makeCallRoutes } = await import("../src/routes/api-calls.js");
  const router = makeCallRoutes({
    store: {},
    config: { voice: { elevenLabsOutbound: { enabled: false } } },
    audit: () => {},
    outboundGates: [],
    tenant: { requestTenant: () => null, requireTenant: () => null, tenantOwnsCall: () => false },
    arm: {},
  });
  const antwort = await mitRoutenServer(router, async (basis) => {
    const gesendet = await postJson(`${basis}/api/calls`, { to: "+4901737123456", objective: "Termin vereinbaren" });
    return { status: gesendet.status, inhalt: await gesendet.json() };
  });
  assert.equal(antwort.status, HTTP_BAD_REQUEST);
  assert.deepEqual(antwort.inhalt, { error: E164_FORMAT_ERROR });
});
