import { planCapCents } from "../../billing/plan-caps.js";
import { isKnownPlanSlug } from "../../plans.js";
import { tenantsOf } from "./grundlagen.js";
import { CENTS_PER_EUR, isBookableCents, globalCapCents } from "../defaults.js";
import {
  usageFor,
  globalUsageTotals,
  tokenCostUsd,
  denyCorruptUsage,
  laterMonotonicKey,
  spendMonthUsageCents,
} from "./nutzung.js";

export function tenantBudgetRow(state, tenantId) {
  return state.tenantBudgets.find((budget) => budget.tenantId === tenantId) || null;
}

export function seedTenantDefaultBudget(state, tenantId, defaultBudgetCents) {
  if (!defaultBudgetCents) return;
  if (tenantBudgetRow(state, tenantId)) return;
  setTenantBudget(state, tenantId, { budgetCents: defaultBudgetCents, hardCapCents: defaultBudgetCents });
}

export function deriveTenantBudgetFromPlan(state, tenantId, cfg) {
  const tenant = tenantsOf(state).find((candidate) => candidate.id === tenantId);
  if (!tenant) return;
  const slug = tenant.stripePlanSlug;
  if (!slug) return;
  if (!isKnownPlanSlug(slug)) {
    console.warn(
      `[budget] plan-cap grund=slug_unbekannt slug=${slug} tenant=${tenantId} -> ` +
        "Ableitung uebersprungen (bestehende Decke bleibt, Tenant-Achse fail-closed)",
    );
    return;
  }
  const capCents = planCapCents(slug, cfg);
  if (capCents <= 0) {
    console.warn(
      `[budget] plan-cap grund=tarif_null slug=${slug} tenant=${tenantId} -> ` +
        "Ableitung uebersprungen (bestehende Decke bleibt, VOICE_TARIFF_DEFAULT_CENTS=0)",
    );
    return;
  }
  setTenantBudget(state, tenantId, { budgetCents: capCents, hardCapCents: capCents });
}

export function setTenantBudget(state, tenantId, { budgetCents, hardCapCents }) {
  const existing = tenantBudgetRow(state, tenantId);
  if (existing) {
    existing.budgetCents = budgetCents;
    existing.hardCapCents = hardCapCents;
    return existing;
  }
  const row = { tenantId, budgetCents, hardCapCents };
  state.tenantBudgets.push(row);
  return row;
}

function effectiveCapCents(state, tenantId, cfg) {
  const budget = tenantBudgetRow(state, tenantId);
  if (budget) return budget.hardCapCents;
  const tenantDefaultCents = cfg.defaultTenantBudgetCents;
  return tenantDefaultCents > 0 ? tenantDefaultCents : globalCapCents(cfg);
}

function budgetPeriodUsageCents(bucket) {
  if (!bucket.budgetPeriodKey) return bucket.costCents;
  return Math.max(0, bucket.costCents - bucket.budgetPeriodBaselineCents);
}

export function stampBudgetPeriod(state, tenantId, periodStartIso) {
  if (!periodStartIso) return { changed: false };
  const bucket = usageFor(state, tenantId);
  if (laterMonotonicKey(bucket.budgetPeriodKey, periodStartIso) !== periodStartIso)
    return { changed: false };
  if (bucket.budgetPeriodKey === periodStartIso) return { changed: false };
  bucket.budgetPeriodKey = periodStartIso;
  bucket.budgetPeriodBaselineCents = bucket.costCents;
  return { changed: true };
}

export function gateUsageCents(s, tenantId, cfg, nowIso) {
  const bucket = usageFor(s, tenantId);
  return cfg.budgetMonthEnabled ? spendMonthUsageCents(bucket, nowIso) : budgetPeriodUsageCents(bucket);
}

function platformSpendMonthCents(state, nowIso) {
  return Object.values(state.usage).reduce((sum, bucket) => sum + spendMonthUsageCents(bucket, nowIso), 0);
}

export function gatePlatformUsageCents(state, cfg, nowIso) {
  return cfg.budgetMonthEnabled ? platformSpendMonthCents(state, nowIso) : globalUsageTotals(state).costCents;
}

function usageAxesBookable({ gateCents, lifetimeCents }) {
  return isBookableCents(gateCents) && isBookableCents(lifetimeCents);
}

function spendOrDeny({ label, gateCents, lifetimeCents }) {
  if (usageAxesBookable({ gateCents, lifetimeCents })) return { deny: false, spent: gateCents };
  const gateBookable = isBookableCents(gateCents);
  const feld = gateBookable ? "lifetimeCents" : "gateCents";
  denyCorruptUsage(label, feld, gateBookable ? lifetimeCents : gateCents);
  return { deny: true };
}

function tenantUsageAxes(s, tenantId, cfg, nowIso) {
  return {
    gateCents: gateUsageCents(s, tenantId, cfg, nowIso),
    lifetimeCents: usageFor(s, tenantId).costCents,
  };
}

function tenantSpendOrDeny(s, tenantId, cfg, nowIso) {
  return spendOrDeny({ label: `tenant:${tenantId}`, ...tenantUsageAxes(s, tenantId, cfg, nowIso) });
}

export function liveBudgetExceeded(s, tenantId, liveCents, cfg, nowIso) {
  const spend = tenantSpendOrDeny(s, tenantId, cfg, nowIso);
  if (spend.deny) return true;
  if (!isBookableCents(liveCents))
    return denyCorruptUsage(`tenant:${tenantId}`, "liveCents", liveCents);
  return spend.spent + liveCents >= effectiveCapCents(s, tenantId, cfg);
}

export function budgetExceeded(s, tenantId, cfg, nowIso) {
  return liveBudgetExceeded(s, tenantId, 0, cfg, nowIso);
}

export function reserveExceedsBudget(s, tenantId, reserveCents, cfg, nowIso) {
  const spend = tenantSpendOrDeny(s, tenantId, cfg, nowIso);
  if (spend.deny) return true;
  return spend.spent + reservationFor(s, tenantId) + reserveCents > effectiveCapCents(s, tenantId, cfg);
}

export function tenantBudgetSnapshot(s, tenantId, cfg, nowIso) {
  const capCents = effectiveCapCents(s, tenantId, cfg);
  const axes = tenantUsageAxes(s, tenantId, cfg, nowIso);
  if (!usageAxesBookable(axes)) return { capCents, spentCents: null, remainingCents: null };
  const spentCents = axes.gateCents;
  return { capCents, spentCents, remainingCents: capCents - spentCents - reservationFor(s, tenantId) };
}

export function aiCostCents(tokens, cfg) {
  return Math.round(tokenCostUsd(tokens, cfg) * cfg.usdToEur * CENTS_PER_EUR);
}

export function reservationFor(state, tenantId) {
  return state.reservations[tenantId] || 0;
}

export function reservationsTotal(state) {
  return Object.values(state.reservations).reduce((sum, cents) => sum + cents, 0);
}

export function tryReserveOutboundBudget(s, tenantId, reserveCents, cfg, nowIso) {
  if (!isBookableCents(reserveCents)) return false;
  if (reserveExceedsBudget(s, tenantId, reserveCents, cfg, nowIso)) return false;
  s.reservations[tenantId] = reservationFor(s, tenantId) + reserveCents;
  return true;
}

export function releaseOutboundReserve(s, call) {
  if (!call || !call.reserveCents || call.reserveReleased) return false;
  s.reservations[call.tenantId] = Math.max(0, reservationFor(s, call.tenantId) - call.reserveCents);
  call.reserveReleased = true;
  return true;
}

export function releaseOutboundReserveCents(s, tenantId, cents) {
  if (!isBookableCents(cents)) return false;
  s.reservations[tenantId] = Math.max(0, reservationFor(s, tenantId) - cents);
  return true;
}
