import { isDeepStrictEqual } from "node:util";
import { BOOTSTRAP_TENANT_ID, KYC_OUTBOUND_MIN } from "../begriffe/mandant.js";
import { sanitizeProfile } from "../begriffe/profil.js";
import { PROFILE_SKIP, resolveTierForTenant } from "./plan-profile-resolver.ts";

export const BACKFILL_SKIP = Object.freeze({
  BOOTSTRAP: "bootstrap",
  NOT_SUBSCRIBER: "not_subscriber",
  ...PROFILE_SKIP,
});

interface Store {
  load: () => { tenants: Tenant[]; profiles: Record<string, unknown> };
  tenantActiveSubscriber: (tenant: string, minLevel: string) => boolean;
  tenantSubscription: (tenant: string) => { planSlug?: string | null | undefined };
  setTenantSubscription: (tenant: string, patch: { planSlug: string }) => unknown;
  setProfile: (tenant: string, tier: unknown) => unknown;
}

interface Tenant {
  id: string;
  stripeSubscriptionId?: string | null | undefined;
}

interface Report {
  apply: boolean;
  scanned: number;
  changes: { id: string; hadExisting: boolean }[];
  unchanged: { id: string }[];
  skipped: { id: string; reason: string }[];
  reconciled: { id: string }[];
}

interface Lauf {
  store: Store;
  apply: boolean;
  resolvePlanSlug: ((subscriptionId: string) => Promise<string | null | undefined>) | undefined;
  report: Report;
}

function ausschlussGrund(store: Store, id: string): string | null {
  if (id === BOOTSTRAP_TENANT_ID) return BACKFILL_SKIP.BOOTSTRAP;
  if (!store.tenantActiveSubscriber(id, KYC_OUTBOUND_MIN)) return BACKFILL_SKIP.NOT_SUBSCRIBER;
  return null;
}

async function holePlanSlugNach(lauf: Lauf, tenant: Tenant): Promise<void> {
  const { resolvePlanSlug } = lauf;
  const { stripeSubscriptionId } = tenant;
  if (!lauf.apply || !resolvePlanSlug || !stripeSubscriptionId) return;
  if (lauf.store.tenantSubscription(tenant.id).planSlug) return;
  const slug = await resolvePlanSlug(stripeSubscriptionId);
  if (!slug) return;
  lauf.store.setTenantSubscription(tenant.id, { planSlug: slug });
  lauf.report.reconciled.push({ id: tenant.id });
}

function gleicheProfilAb(lauf: Lauf, id: string, vorhandeneProfile: Record<string, unknown>): void {
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

export async function backfillPlanProfiles({
  store,
  apply = false,
  resolvePlanSlug,
}: {
  store: Store;
  apply?: boolean;
  resolvePlanSlug?: Lauf["resolvePlanSlug"];
}): Promise<Report> {
  const stand = store.load();
  const report: Report = { apply, scanned: 0, changes: [], unchanged: [], skipped: [], reconciled: [] };
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
