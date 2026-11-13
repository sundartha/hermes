import { planProfileFor } from "../plans.ts";

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
  const slug = store.tenantSubscription(tenant).planSlug;
  const tier: unknown = slug ? planProfileFor(slug) : null;
  if (!tier) return { skip: PROFILE_SKIP.NO_PLAN };
  return { tier };
}
