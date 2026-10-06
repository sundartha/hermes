import test from "node:test";
import assert from "node:assert/strict";

import { planCapCents } from "../src/billing/plan-caps.js";
import { CATALOG_SLUGS, findPlan } from "../src/plans.js";
import { outboundReserveCents } from "../src/store/defaults.js";
import {
  addVoiceUsageCostCents,
  deriveTenantBudgetFromPlan,
  makeDefaultState,
  registerTenant,
  reserveExceedsBudget,
  setTenantBudget,
  setTenantSubscription,
  tenantBudgetSnapshot,
} from "../src/store/state-ops.js";

const BOOKING_RATES_CENTS_PER_MIN = Object.freeze([300, 30]);
const STARTER_CAP_AT_LIVE_RATE_CENTS = 1500;
const BUSINESS_CAP_AT_LIVE_RATE_CENTS = 4500;
const LIVE_BOOKING_RATE_CENTS_PER_MIN = 30;
const STARTER_SOLD_MINUTES = 30;

function cfgAtRate(rateCentsPerMin) {
  return Object.freeze({
    voiceTariffDefaultCents: rateCentsPerMin,
    defaultTenantBudgetCents: 0,
    platformSpendCapCents: 0,
    budgetMonthEnabled: false,
  });
}

async function captureWarn(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.warn = orig;
  }
  return lines;
}

test("KS-P5a: jede Plan-Decke traegt die verkauften Minuten PLUS die Reserve des letzten Anrufs", () => {
  for (const rate of BOOKING_RATES_CENTS_PER_MIN) {
    for (const slug of CATALOG_SLUGS) {
      const soldMinutes = findPlan(slug).includedMinutes;
      const capCents = planCapCents(slug, cfgAtRate(rate));
      assert.ok(
        Number.isInteger(capCents),
        `${slug}@${rate}: Decke ${capCents} ist keine Ganzzahl (Geldgrenze aus einer Rundung, G26)`,
      );
      assert.ok(
        soldMinutes * rate + outboundReserveCents(rate) <= capCents,
        `${slug}@${rate}: Decke ${capCents} traegt die ${soldMinutes} verkauften Minuten nicht ` +
          `inkl. Worst-Case-Reserve (${soldMinutes * rate} + ${outboundReserveCents(rate)})`,
      );
    }
  }
});

test("KS-P5a: die Decke folgt dem Buchungssatz (ein Satz, keine zweite Zahl)", () => {
  assert.equal(planCapCents("starter", cfgAtRate(30)), STARTER_CAP_AT_LIVE_RATE_CENTS);
  assert.equal(planCapCents("business", cfgAtRate(30)), BUSINESS_CAP_AT_LIVE_RATE_CENTS);
  assert.equal(planCapCents("starter", cfgAtRate(300)), 15000);
  assert.equal(planCapCents("business", cfgAtRate(300)), 45000);
});

test("KS-P5a: Starter telefoniert die verkauften Minuten leer - der letzte Anruf faellt NICHT ins Reserve-Gate", () => {
  const cfg = cfgAtRate(LIVE_BOOKING_RATE_CENTS_PER_MIN);
  const s = makeDefaultState();
  const tenantId = "t_ks_p5a_starter";
  registerTenant(s, tenantId, {});
  setTenantSubscription(s, tenantId, { planSlug: "starter" });
  deriveTenantBudgetFromPlan(s, tenantId, cfg);
  assert.equal(
    tenantBudgetSnapshot(s, tenantId, cfg).capCents,
    STARTER_CAP_AT_LIVE_RATE_CENTS,
    "Vorbedingung: die abgeleitete Decke folgt dem Buchungssatz",
  );

  const reserveCents = outboundReserveCents(LIVE_BOOKING_RATE_CENTS_PER_MIN);
  const minutesBeforeLastCall = STARTER_SOLD_MINUTES - reserveCents / LIVE_BOOKING_RATE_CENTS_PER_MIN;
  addVoiceUsageCostCents(s, tenantId, minutesBeforeLastCall * LIVE_BOOKING_RATE_CENTS_PER_MIN);

  assert.equal(
    reserveExceedsBudget(s, tenantId, reserveCents, cfg),
    false,
    "der letzte verkaufte Anruf muss noch durch das Reserve-Gate passen",
  );
});

test("KS-P5a: Buchungssatz 0 (Kosten-Achse aus) schreibt KEINE 0-Decke", async () => {
  const s = makeDefaultState();
  const tenantId = "t_ks_p5a_tarif_null";
  registerTenant(s, tenantId, {});
  setTenantSubscription(s, tenantId, { planSlug: "starter" });
  setTenantBudget(s, tenantId, {
    budgetCents: STARTER_CAP_AT_LIVE_RATE_CENTS,
    hardCapCents: STARTER_CAP_AT_LIVE_RATE_CENTS,
  });

  const warnLines = await captureWarn(() => deriveTenantBudgetFromPlan(s, tenantId, cfgAtRate(0)));

  assert.deepEqual(
    s.tenantBudgets.find((b) => b.tenantId === tenantId),
    {
      tenantId,
      budgetCents: STARTER_CAP_AT_LIVE_RATE_CENTS,
      hardCapCents: STARTER_CAP_AT_LIVE_RATE_CENTS,
    },
    "bestehende Decke unveraendert - eine 0-Decke waere Telefonie-Totalausfall, kein strengeres Gate",
  );
  const tarifNullLines = warnLines.filter((l) => l.includes("grund=tarif_null"));
  assert.equal(tarifNullLines.length, 1, `genau eine laute WARN erwartet, war: ${JSON.stringify(warnLines)}`);
});
