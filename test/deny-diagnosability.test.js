import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates } from "../src/telephony/outbound-gates.js";
import { spendMonthEndDate } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const VALID_TO = "+491711234567";
const DURATION_LEAK = /(max_duration|Sekunden|Dauer|Minute)/;

function defaultStore(overrides = {}) {
  return {
    tenantLanguage: () => "de",
    budgetExceeded: () => false,
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 350, remainingCents: 650 }),
    tryReserveOutboundBudget: () => true,
    reserveExceedsBudget: () => false,
    withStoreLock: (fn) => fn(),
    load: () => ({ outageAlerts: [] }),
    claimPlatformSpendWarning: () => null,
    ...overrides,
  };
}

function defaultConfig(overrides = {}) {
  return withConfigNamespaces({ outboundFrozen: false, platformSpendCapCents: 800, ...overrides });
}

function makeDeps(o = {}) {
  return {
    store: defaultStore(o.store),
    config: defaultConfig(o.config),
    requestTenant: () => "T",
    internalIdentity: () => null,
    OWNER_ID: "owner",
    TENANT_REJECT: "reject",
    ...(o.aniOwnershipRecheck ? { aniOwnershipRecheck: o.aniOwnershipRecheck } : {}),
  };
}

const gateBy = (gates, name) => gates.find((g) => g.name === name);
const baseCtx = (overrides = {}) => ({ to: VALID_TO, tenantId: "T", requestedBy: "owner", ...overrides });

test("budget-Gate, Tenant-Achse: eigene Decke + eigener Verbrauch, grund=budget_tenant", async () => {
  const { gates } = makeOutboundGates(makeDeps({ store: { budgetExceeded: () => true } }));
  const denial = await gateBy(gates, "budget").run(baseCtx());
  assert.equal(denial.status, 402);
  assert.equal(denial.body.error, "Dein Budget-Limit ist erreicht: 3.50 von 10.00 EUR verbraucht.");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=budget_tenant tenant=T`);
});

test("budget-Gate, D7 unbuchbarer Bucket: ziffernfreier Sperrtext, grund bleibt budget_tenant", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        budgetExceeded: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: null, remainingCents: null }),
      },
    }),
  );
  const denial = await gateBy(gates, "budget").run(baseCtx());
  assert.equal(
    denial.body.error,
    "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.",
  );
  assert.ok(!/\d/.test(denial.body.error), "kein 'NaN EUR' auf einer Geld-Kante");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=budget_tenant tenant=T`);
});

test("reserve_budget-Gate, Tenant-Achse Rest>0 (D2-Totband): Fehlbetrag + Spend-Monat-Ende, grund=reserve_ueber_rest", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        tryReserveOutboundBudget: () => false,
        reserveExceedsBudget: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: 779, remainingCents: 21 }),
      },
    }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 60 }));
  const monthEnd = spendMonthEndDate(Date.now());
  assert.equal(denial.status, 402);
  assert.equal(
    denial.body.error,
    `Dieser Anruf passt nicht mehr in dein Budget: es fehlen 0.39 EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
  );
  assert.match(denial.body.error, /endet am \d{4}-\d{2}-\d{2}\.$/);
  assert.ok(!DURATION_LEAK.test(denial.body.error), "keine ausfuehrbare Dauer im Ablehnungstext (Vorgabe 4)");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_ueber_rest tenant=T requestedBy=owner`);
});

test("reserve_budget-Gate, Tenant-Achse Rest<=0 (erschoepft): grund=reserve_erschoepft", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        tryReserveOutboundBudget: () => false,
        reserveExceedsBudget: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: 800, remainingCents: 0 }),
      },
    }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 60 }));
  const monthEnd = spendMonthEndDate(Date.now());
  assert.equal(denial.status, 402);
  assert.equal(
    denial.body.error,
    `Dein Budget ist erschoepft: es fehlen 0.60 EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
  );
  assert.ok(!DURATION_LEAK.test(denial.body.error), "keine ausfuehrbare Dauer im Ablehnungstext (Vorgabe 4)");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_erschoepft tenant=T requestedBy=owner`);
});

test("reserve_budget-Gate, unbuchbarer Reserve-Betrag: ziffernfreier Sperrtext, grund=reserve_erschoepft", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({ store: { tryReserveOutboundBudget: () => false, reserveExceedsBudget: () => false } }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 60 }));
  assert.equal(denial.status, 402);
  assert.equal(
    denial.body.error,
    "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.",
  );
  assert.ok(!/\d/.test(denial.body.error), "kein 'NaN EUR' auf einer Geld-Kante");
  assert.ok(!DURATION_LEAK.test(denial.body.error));
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_erschoepft tenant=T requestedBy=owner`);
});

test("reserve_budget-Gate, D7 unbuchbarer Bucket: ziffernfreier Sperrtext, grund=reserve_erschoepft", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      store: {
        tryReserveOutboundBudget: () => false,
        reserveExceedsBudget: () => true,
        tenantBudgetSnapshot: () => ({ capCents: 800, spentCents: null, remainingCents: null }),
      },
    }),
  );
  const denial = await gateBy(gates, "reserve_budget").run(baseCtx({ reserveCents: 60 }));
  assert.equal(
    denial.body.error,
    "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.",
  );
  assert.ok(!/\d/.test(denial.body.error), "kein 'NaN EUR' auf einer Geld-Kante");
  assert.ok(!DURATION_LEAK.test(denial.body.error));
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=reserve_erschoepft tenant=T requestedBy=owner`);
});

const EINE_MINUTE_MS = 60000;
const HTTP_SERVICE_UNAVAILABLE = 503;
const FRISCHE_MS = "2026-08-27T16:45:00.000Z";
const NOW_MS = Date.parse(FRISCHE_MS) + EINE_MINUTE_MS;

test("ani_ownership-Gate: frische Messung + Nachmessung bestaetigt -> 503, grund=ani_not_owned, PII-frei", async () => {
  const { gates } = makeOutboundGates(
    makeDeps({
      config: { outboundAniGateEnabled: true, outboundAniGateMaxAgeMs: 900000 },
      store: {
        load: () => ({ outageAlerts: [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: FRISCHE_MS }] }),
      },
      aniOwnershipRecheck: async () => true,
    }),
  );
  const nowStub = () => NOW_MS;
  const echterDateNow = Date.now;
  Date.now = nowStub;
  let denial;
  try {
    denial = await gateBy(gates, "ani_ownership").run(baseCtx({ fromNumber: "+15739090177" }));
  } finally {
    Date.now = echterDateNow;
  }
  assert.equal(denial.status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(denial.audit.grund, "ani_not_owned");
  assert.equal(denial.audit.detail, `to=${VALID_TO} grund=ani_not_owned tenant=T requestedBy=owner`);
  assert.ok(!denial.body.error.includes("+15739090177"), `keine ANI im Ablehnungstext: ${denial.body.error}`);
  assert.ok(!denial.audit.detail.includes("+15739090177"), `keine ANI im Audit-Detail: ${denial.audit.detail}`);
});

test("spendMonthEndDate: letzter Tag des UTC-Kalendermonats, inkl. Dezember- und Schaltjahr-Grenzfall", () => {
  assert.equal(spendMonthEndDate(Date.UTC(2026, 6, 19)), "2026-07-31", "Juli -> 31 Tage");
  assert.equal(spendMonthEndDate(Date.UTC(2026, 11, 5)), "2026-12-31", "Dezember-Ueberlauf normalisiert sich selbst");
  assert.equal(spendMonthEndDate(Date.UTC(2024, 1, 10)), "2024-02-29", "Schaltjahr-Februar");
});
