import { KYC_LEVEL } from "../begriffe/mandant.js";
import { resolveTierForTenant } from "./plan-profile-resolver.ts";
import { provisionCleared } from "./provision-outcome.ts";
import { resolvePeriodStartIso } from "./period.ts";

interface Subscription {
  planSlug?: string | null | undefined;
  subscriptionId?: string | null | undefined;
  currentPeriodStart?: number | null | undefined;
  currentPeriodEnd?: number | null | undefined;
}

interface Store {
  tenantSubscription: (tenant: string) => Subscription;
  setTenantSubscription: (tenant: string, patch: Record<string, boolean>) => unknown;
  billingHoldActive: (tenant: string) => boolean;
  stampBudgetPeriod: (tenant: string, periodStartIso: string | null) => unknown;
  setProfile: (tenant: string, tier: unknown) => { changed: string[] };
  setKycLevel: (tenant: string, level: string) => unknown;
  clearSuspendedAt: (tenant: string) => Promise<unknown>;
  clearBillingHold: (tenant: string) => Promise<unknown>;
  ensureTenant: (tenant: string) => Promise<unknown>;
}

interface Accounts {
  setStatus: (tenant: string, status: string) => Promise<unknown>;
}

interface Billing {
  retrieveSubscription?: (subscriptionId: string) => Promise<{ numberSetupFeeExempt: boolean }>;
}

type Provisioned = { reason?: string } | null | undefined;

type Provision = (tenant: string) => Promise<Provisioned>;

interface ProfileResult {
  provisioned: boolean;
  reason: string | null;
  keys: number;
}

function stampPeriodAndRestoreCreditIfPaid({ store, tenant }: { store: Store; tenant: string }): boolean {
  if (store.billingHoldActive(tenant)) return false;
  const periodStarted =
    store.stampBudgetPeriod(tenant, resolvePeriodStartIso(store.tenantSubscription(tenant))) === true;
  if (periodStarted) store.setTenantSubscription(tenant, { periodCreditRevoked: false });
  return periodStarted;
}

function provisionPlanProfile({ store, tenant }: { store: Store; tenant: string }): ProfileResult {
  const { tier, skip } = resolveTierForTenant({ store, tenant });
  if (skip) return { provisioned: false, reason: skip, keys: 0 };
  const { changed } = store.setProfile(tenant, tier);
  return { provisioned: true, reason: null, keys: changed.length };
}

export function profileAuditDetail(profile: ProfileResult | null | undefined): string {
  if (!profile) return "profile=none";
  return profile.provisioned ? `profile=ok:${String(profile.keys)}` : `profile=skip:${String(profile.reason)}`;
}

async function syncNumberSetupFeeExemption({
  store,
  billing,
  tenant,
}: {
  store: Store;
  billing: Billing | undefined;
  tenant: string;
}): Promise<void> {
  if (!billing || typeof billing.retrieveSubscription !== "function") return;
  const { subscriptionId } = store.tenantSubscription(tenant);
  if (!subscriptionId) return;
  try {
    const { numberSetupFeeExempt } = await billing.retrieveSubscription(subscriptionId);
    store.setTenantSubscription(tenant, { numberSetupFeeExempt });
  } catch (e) {
    console.error(`[activation] numberSetupFeeExempt-Check fehlgeschlagen (tenant=${tenant}):`, e instanceof Error ? e.message : String(e));
  }
}

async function provisionAfterSetupFeeExemptionSync({
  store,
  billing,
  provision,
  tenant,
}: {
  store: Store;
  billing: Billing | undefined;
  provision: Provision;
  tenant: string;
}): Promise<Provisioned> {
  await syncNumberSetupFeeExemption({ store, billing, tenant });
  return provision(tenant);
}

async function activateAccountAndRefreshMirror({
  store,
  accounts,
  tenant,
}: {
  store: Store;
  accounts: Accounts;
  tenant: string;
}): Promise<void> {
  await accounts.setStatus(tenant, "active");
  store.setTenantSubscription(tenant, { activationPending: false });
  await store.ensureTenant(tenant);
}

async function clearBillingHold({ store, tenant }: { store: Store; tenant: string }): Promise<boolean> {
  await store.clearBillingHold(tenant);
  return !store.billingHoldActive(tenant);
}

function stampPeriodAndRestoreCreditAfterHoldClear({
  store,
  tenant,
  holdCleared,
}: {
  store: Store;
  tenant: string;
  holdCleared: boolean;
}): boolean {
  return holdCleared && stampPeriodAndRestoreCreditIfPaid({ store, tenant });
}

export async function activatePaidTenant({
  store,
  accounts,
  provision,
  billing,
  tenant,
}: {
  store: Store;
  accounts: Accounts;
  provision: Provision;
  billing: Billing | undefined;
  tenant: string;
}): Promise<{
  profile: ProfileResult;
  activated: boolean;
  provisioned: Provisioned;
  budgetPeriodStarted: boolean;
}> {
  store.setKycLevel(tenant, KYC_LEVEL.CARD);
  await store.clearSuspendedAt(tenant);
  const budgetPeriodStarted = stampPeriodAndRestoreCreditIfPaid({ store, tenant });
  store.setTenantSubscription(tenant, { activationPending: true });
  const provisioned = await provisionAfterSetupFeeExemptionSync({ store, billing, provision, tenant });
  const profile = provisionPlanProfile({ store, tenant });
  if (!provisionCleared(provisioned))
    return { profile, activated: false, provisioned, budgetPeriodStarted };
  await activateAccountAndRefreshMirror({ store, accounts, tenant });
  const holdCleared = await clearBillingHold({ store, tenant });
  const budgetPeriodStartedAfterHold = stampPeriodAndRestoreCreditAfterHoldClear({ store, tenant, holdCleared });
  return {
    profile,
    activated: true,
    provisioned,
    budgetPeriodStarted: budgetPeriodStarted || budgetPeriodStartedAfterHold,
  };
}
