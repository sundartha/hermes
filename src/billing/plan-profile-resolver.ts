import { planProfileFor } from "../plans.js";

export const PROFILE_SKIP = Object.freeze({
  NO_PLAN: "no_plan",
});

export function resolveTierForTenant({
  store,
  tenant,
}: {
  store: { tenantSubscription: (tenant: string) => { planSlug?: string | null | undefined } };
  tenant: string;
}): { skip: string; tier?: undefined } | { tier: unknown; skip?: undefined } {
  const tier: unknown = planProfileFor(store.tenantSubscription(tenant).planSlug);
  if (!tier) return { skip: PROFILE_SKIP.NO_PLAN };
  return { tier };
}
