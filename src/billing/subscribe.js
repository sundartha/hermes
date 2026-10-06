import { hasCardOnFile } from "../self-service.js";
import { CATALOG_SLUGS, isKnownPlanSlug } from "../plans.js";
import { activatePaidTenant } from "./activation.js";
import { bindPaymentMethodOnTenant, customerMatches } from "./card-setup.js";

export const PLAN_SLUGS = CATALOG_SLUGS;

const PLAN_PRICE_CONFIG_KEY = Object.freeze({
  starter: "stripeStarterPriceId",
  business: "stripeBusinessPriceId",
});

export function priceIdForPlan(slug, config) {
  const key = PLAN_PRICE_CONFIG_KEY[slug];
  if (!key) return null;
  return config.billing[key] || null;
}

const PM_KEY_SUFFIX_LEN = 12;

function subscribeIdempotencyKey(tenant, slug, paymentMethodId) {
  return `sub_${tenant}_${slug}_${paymentMethodId.slice(-PM_KEY_SUFFIX_LEN)}`;
}

export function checkoutSessionIdempotencyKey({ tenant, planSlug, priceId, customerId }) {
  return `subcs_${tenant}_${planSlug}_${priceId}_${customerId}`;
}

export function hasActiveSubscription(store, tenant) {
  return !!store.tenantSubscription(tenant).subscriptionId;
}

export function clearSubscriptionReference(store, tenant) {
  if (!hasActiveSubscription(store, tenant)) return;
  store.setTenantSubscription(tenant, { subscriptionId: null });
}

export async function createTenantSubscription({ store, billing, config, tenant, planSlug }) {
  if (!isKnownPlanSlug(planSlug)) return { ok: false, reason: "unknown_plan" };
  const priceId = priceIdForPlan(planSlug, config);
  if (!priceId) return { ok: false, reason: "plan_unconfigured" };
  if (hasActiveSubscription(store, tenant)) return { ok: false, reason: "already_subscribed" };
  const stripe = store.tenantStripe(tenant);
  if (!hasCardOnFile(stripe)) return { ok: false, reason: "no_card" };
  const { subscriptionId, currentPeriodEnd, currentPeriodStart } = await billing.createSubscription({
    tenantRef: tenant,
    customerId: stripe.customerId,
    paymentMethodId: stripe.paymentMethodId,
    priceId,
    idempotencyKey: subscribeIdempotencyKey(tenant, planSlug, stripe.paymentMethodId),
  });
  store.setTenantSubscription(tenant, { subscriptionId, planSlug, currentPeriodEnd, currentPeriodStart });
  return { ok: true, subscriptionId, planSlug, currentPeriodEnd };
}

export async function activateSubscriptionFromCheckoutSession({
  store,
  billing,
  accounts,
  provision,
  tenant,
  sessionId,
  expectedPlanSlug,
}) {
  const outcome = await billing.getSubscriptionCheckoutResult(sessionId);
  if (!customerMatches(store, tenant, outcome.customerId))
    return { ok: false, reason: "customer_mismatch" };
  if (!outcome.planSlug || outcome.planSlug !== expectedPlanSlug)
    return { ok: false, reason: "plan_mismatch" };
  if (hasActiveSubscription(store, tenant)) {
    const existing = store.tenantSubscription(tenant);
    if (existing.subscriptionId === outcome.subscriptionId) {
      if (hasCardOnFile(store.tenantStripe(tenant)))
        return { ok: false, reason: "already_subscribed" };
      bindPaymentMethodOnTenant(store, tenant, outcome);
      store.setTenantSubscription(tenant, {
        subscriptionId: outcome.subscriptionId,
        planSlug: outcome.planSlug,
        currentPeriodEnd: outcome.currentPeriodEnd,
        currentPeriodStart: outcome.currentPeriodStart,
      });
      const { profile, provisioned } = await activatePaidTenant({ store, accounts, provision, billing, tenant });
      return { ok: false, reason: "already_subscribed", profile, provisioned };
    }
    return { ok: false, reason: "subscription_conflict", subscriptionId: outcome.subscriptionId };
  }
  bindPaymentMethodOnTenant(store, tenant, outcome);
  store.setTenantSubscription(tenant, {
    subscriptionId: outcome.subscriptionId,
    planSlug: outcome.planSlug,
    currentPeriodEnd: outcome.currentPeriodEnd,
    currentPeriodStart: outcome.currentPeriodStart,
  });
  const { profile, provisioned } = await activatePaidTenant({ store, accounts, provision, billing, tenant });
  return {
    ok: true,
    subscriptionId: outcome.subscriptionId,
    planSlug: outcome.planSlug,
    currentPeriodEnd: outcome.currentPeriodEnd,
    profile,
    provisioned,
  };
}
