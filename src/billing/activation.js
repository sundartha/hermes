import { KYC_LEVEL } from "../store/defaults.js";
import { resolveTierForTenant } from "./plan-profile-resolver.js";
import { provisionCleared } from "./provision-outcome.js";
import { resolvePeriodStartIso } from "./period.js";

function stampBudgetPeriodIfPaid({ store, tenant }) {
  if (store.billingHoldActive(tenant)) return false;
  return store.stampBudgetPeriod(tenant, resolvePeriodStartIso(store.tenantSubscription(tenant))) === true;
}

function provisionPlanProfile({ store, tenant }) {
  const { tier, skip } = resolveTierForTenant({ store, tenant });
  if (skip) return { provisioned: false, reason: skip, keys: 0 };
  const { changed } = store.setProfile(tenant, tier);
  return { provisioned: true, reason: null, keys: changed.length };
}

export function profileAuditDetail(profile) {
  if (!profile) return "profile=none";
  return profile.provisioned ? `profile=ok:${profile.keys}` : `profile=skip:${profile.reason}`;
}

async function syncNumberSetupFeeExemption({ store, billing, tenant }) {
  if (!billing || typeof billing.retrieveSubscription !== "function") return;
  const { subscriptionId } = store.tenantSubscription(tenant);
  if (!subscriptionId) return;
  try {
    const { numberSetupFeeExempt } = await billing.retrieveSubscription(subscriptionId);
    store.setTenantSubscription(tenant, { numberSetupFeeExempt });
  } catch (e) {
    console.error(`[activation] numberSetupFeeExempt-Check fehlgeschlagen (tenant=${tenant}):`, e.message);
  }
}

export async function activatePaidTenant({ store, accounts, provision, billing, tenant }) {
  store.setKycLevel(tenant, KYC_LEVEL.CARD);
  store.clearSuspendedAt(tenant);
  const budgetPeriodStarted = stampBudgetPeriodIfPaid({ store, tenant });
  store.setTenantSubscription(tenant, { activationPending: true });
  await syncNumberSetupFeeExemption({ store, billing, tenant });
  const provisioned = await provision(tenant);
  const profile = provisionPlanProfile({ store, tenant });
  if (!provisionCleared(provisioned))
    return { profile, activated: false, provisioned, budgetPeriodStarted };
  await accounts.setStatus(tenant, "active");
  store.setTenantSubscription(tenant, { activationPending: false });
  await store.ensureTenant(tenant);
  store.clearBillingHold(tenant);
  store.setTenantSubscription(tenant, { periodCreditRevoked: false });
  const budgetPeriodStartedAfterHold = stampBudgetPeriodIfPaid({ store, tenant });
  return {
    profile,
    activated: true,
    provisioned,
    budgetPeriodStarted: budgetPeriodStarted || budgetPeriodStartedAfterHold,
  };
}
