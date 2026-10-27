import { isDeepStrictEqual } from "node:util";
import { BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN, sanitizeProfile } from "../store/defaults.js";
import { PROFILE_SKIP, resolveTierForTenant } from "./plan-profile-resolver.js";

export const BACKFILL_SKIP = Object.freeze({
  BOOTSTRAP: "bootstrap",
  NOT_SUBSCRIBER: "not_subscriber",
  ...PROFILE_SKIP,
});

function ausschlussGrund(store, id) {
  if (id === BOOTSTRAP_TENANT_ID) return BACKFILL_SKIP.BOOTSTRAP;
  if (!store.tenantActiveSubscriber(id, KYC_OUTBOUND_MIN)) return BACKFILL_SKIP.NOT_SUBSCRIBER;
  return null;
}

function brauchtPlanSlug(lauf, tenant) {
  if (!lauf.apply || !lauf.resolvePlanSlug || !tenant.stripeSubscriptionId) return false;
  return !lauf.store.tenantSubscription(tenant.id).planSlug;
}

async function holePlanSlugNach(lauf, tenant) {
  if (!brauchtPlanSlug(lauf, tenant)) return;
  const slug = await lauf.resolvePlanSlug(tenant.stripeSubscriptionId);
  if (!slug) return;
  lauf.store.setTenantSubscription(tenant.id, { planSlug: slug });
  lauf.report.reconciled.push({ id: tenant.id });
}

function gleicheProfilAb(lauf, id, vorhandeneProfile) {
  const { tier, skip } = resolveTierForTenant({ store: lauf.store, tenant: id });
  if (skip) {
    lauf.report.skipped.push({ id, reason: skip });
    return;
  }
  const existing = vorhandeneProfile[id];
  if (existing && isDeepStrictEqual(existing, sanitizeProfile(tier))) {
    lauf.report.unchanged.push({ id });
    return;
  }
  lauf.report.changes.push({ id, hadExisting: !!existing });
  if (lauf.apply) lauf.store.setProfile(id, tier);
}

export async function backfillPlanProfiles({ store, apply = false, resolvePlanSlug }) {
  const stand = store.load();
  const report = { apply, scanned: 0, changes: [], unchanged: [], skipped: [], reconciled: [] };
  const lauf = { store, apply, resolvePlanSlug, report };
  for (const tenant of stand.tenants) {
    report.scanned++;
    const reason = ausschlussGrund(store, tenant.id);
    if (reason) {
      report.skipped.push({ id: tenant.id, reason });
      continue;
    }
    await holePlanSlugNach(lauf, tenant);
    gleicheProfilAb(lauf, tenant.id, stand.profiles);
  }
  return report;
}
