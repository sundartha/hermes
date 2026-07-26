// P15/T2 - der ANZEIGETEXT einer Outbound-Ablehnung folgt der Tenant-Sprache, der
// ABLEHNUNGSGRUND bleibt sprachfreies Protokoll.
//
// HARTE INVARIANTE dieser Datei (PLAN-I18N-FIX P15, Spec Abschnitt 1/T2): grund-Schluessel,
// HTTP-Status und die Audit-Detailzeile sind ueber alle drei Sprachen BYTE-IDENTISCH -
// die Betriebs-Forensik der Kosten-Kette unterscheidet grund=reserve_* von grund=budget_*;
// verschiebt sich das, wird die Budget-Diagnose stumm wertlos. Nur `message`/`body.error`
// verzweigt.
//
// Muster test/deny-diagnosability.test.js: makeOutboundGates(deps) + gate.run(ctx) DIREKT,
// offline, kein Spawn, keine DB. Es wird KEIN Gate-PRAEDIKAT veraendert - Bedingungen,
// Schwellen und Reihenfolge liegen unberuehrt in outbound-gates.js; die Faelle steuern die
// Praedikate nur ueber den Fake-Store an (die reale Praedikat-Suite bleibt
// outbound-gates-order.test.js/effective-cap-fallback.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates, E164_FORMAT_ERROR } from "../src/telephony/outbound-gates.js";
import { localeFor, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { spendMonthEndDate } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const VALID_TO = "+491711234567";
const DENIED_TO = "+870123456789"; // Satelliten-Praefix (Denylist)
const FOREIGN_TO = "+15551234567"; // ausserhalb ALLOWED_COUNTRY_CODES=["+49"]

// Vollstaendig durchgesteuerter Default-Store: JEDES Gate laesst sich damit isoliert
// aufrufen, ohne eine Vorbedingung zu verletzen. Ein Fall ueberschreibt NUR die Methode(n),
// die seine Achse feuern lassen. tenantLanguage ist die EINE Sprachquelle der Gate-Kette
// (store.tenantLanguage -> views.tenantLanguage -> resolveCallLanguage).
function defaultStore(language, overrides = {}) {
  return {
    tenantLanguage: () => language,
    countOutboundCallsSince: () => 0,
    kycReached: () => true,
    tenantInactive: () => false,
    billingHoldActive: () => null,
    tenantActiveSubscriber: () => true,
    budgetExceeded: () => false,
    globalBudgetExceeded: () => false,
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

// Profil ohne Sonderrechte: laesst das Verifikations-Gate (allowlistError) ueberhaupt bis
// zu seiner Entscheidung durchlaufen.
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

// Ein Ablehnungsfall: wie er ausgeloest wird (deps/ctx), was Protokoll bleibt (status/grund)
// und welcher Buendel-Schluessel den Anzeigetext liefert (textOf(gates) je Sprache).
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
    label: "budget_platform (budget-Gate)",
    gate: "budget",
    status: 402,
    grund: "budget_platform",
    deps: { store: { globalBudgetExceeded: () => true } },
    textOf: (g) => g.platformHalt,
  },
  {
    label: "budget_platform (reserve_outcome)",
    gate: "reserve_budget",
    status: 402,
    grund: "budget_platform",
    deps: { store: { tryReserveOutboundBudget: () => false, reserveExceedsBudget: () => false } },
    ctx: { reserveCents: 60 },
    textOf: (g) => g.platformHalt,
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

// Ziffernfreiheit der beiden Betreiber-/D7-Texte in JEDER Sprache: eine Plattform-Zahl oder
// ein "NaN EUR" in einer Tenant-Antwort waere ein Cross-Tenant-Leck bzw. eine Falschauskunft
// auf einer Geld-Kante (Absolute Regel 4/6). Die DE-Achse pinnt
// test/deny-diagnosability.test.js; hier gilt sie fuer alle drei Sprachen.
test("platformHalt und budgetUnreadable tragen in KEINER Sprache eine Ziffer", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const gates = localeFor(language).gates;
    assert.ok(!/\d/.test(gates.platformHalt), `${language}: platformHalt ziffernfrei`);
    assert.ok(!/\d/.test(gates.budgetUnreadable), `${language}: budgetUnreadable ziffernfrei`);
  }
});

// Dokumentierte Ausnahme (P15 Abschnitt 6.1): der reine E.164-Formatfehler bleibt
// sprach-UNABHAENGIG. Er ist ein 400 ohne Audit und wird auch VOR der Gate-Kette
// ausgeliefert (routes/api-calls.js Pre-Gate), wo noch kein Tenant aufgeloest ist - eine
// halbe Lokalisierung ergaebe zwei Texte fuer denselben Fehler.
test("Formatfehler (400): sprach-unabhaengiger E164_FORMAT_ERROR, kein Audit", async () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const { gates } = makeOutboundGates(makeDeps(language));
    const denial = await gateBy(gates, "number_gate").run(baseCtx({ to: "keine-nummer" }));
    assert.equal(denial.status, 400);
    assert.equal(denial.audit, null);
    assert.equal(denial.body.error, E164_FORMAT_ERROR);
  }
});
