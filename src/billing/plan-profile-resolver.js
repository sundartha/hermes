import { planProfileFor } from "../plans.js";

export const PROFILE_SKIP = Object.freeze({
  NO_PLAN: "no_plan",
});

export function resolveTierForTenant({ store, tenant }) {
  const tier = planProfileFor(store.tenantSubscription(tenant).planSlug);
  if (!tier) return { skip: PROFILE_SKIP.NO_PLAN };
  return { tier };
}
