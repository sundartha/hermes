import { planCapCents } from "../../billing/plan-caps.js";
import { isKnownPlanSlug } from "../../plans.js";
import { tenantsOf } from "./grundlagen.js";

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
