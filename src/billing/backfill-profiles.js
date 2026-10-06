import { isDeepStrictEqual } from "node:util";
import { BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN, sanitizeProfile } from "../store/defaults.js";
import { PROFILE_SKIP, resolveTierForTenant } from "./plan-profile-resolver.js";

export const BACKFILL_SKIP = Object.freeze({
  BOOTSTRAP: "bootstrap",
  NOT_SUBSCRIBER: "not_subscriber",
  ...PROFILE_SKIP,
});

export async function backfillPlanProfiles({ store, apply = false, resolvePlanSlug }) {
  const s = store.load();
  const report = { apply, scanned: 0, changes: [], unchanged: [], skipped: [], reconciled: [] };
  for (const tenant of s.tenants) {
    report.scanned++;
    const id = tenant.id;
    if (id === BOOTSTRAP_TENANT_ID) {
      report.skipped.push({ id, reason: BACKFILL_SKIP.BOOTSTRAP });
      continue;
    }
    if (!store.tenantActiveSubscriber(id, KYC_OUTBOUND_MIN)) {
      report.skipped.push({ id, reason: BACKFILL_SKIP.NOT_SUBSCRIBER });
      continue;
    }
    if (apply && resolvePlanSlug && tenant.stripeSubscriptionId && !store.tenantSubscription(id).planSlug) {
      const slug = await resolvePlanSlug(tenant.stripeSubscriptionId);
      if (slug) {
        store.setTenantSubscription(id, { planSlug: slug });
        report.reconciled.push({ id });
      }
    }
    const { tier, skip } = resolveTierForTenant({ store, tenant: id });
    if (skip) {
      report.skipped.push({ id, reason: skip });
      continue;
    }
    const desired = sanitizeProfile(tier);
    const existing = s.profiles[id];
    if (existing && isDeepStrictEqual(existing, desired)) {
      report.unchanged.push({ id });
      continue;
    }
    report.changes.push({ id, hadExisting: !!existing });
    if (apply) store.setProfile(id, tier);
  }
  return report;
}
