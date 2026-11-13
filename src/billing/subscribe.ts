import { hasCardOnFile } from "../self-service.js";
import { CATALOG_SLUGS, isKnownPlanSlug } from "../plans.ts";
import { activatePaidTenant } from "./activation.ts";
import { bindPaymentMethodOnTenant, customerMatches } from "./card-setup.ts";

type ActivationArgs = Parameters<typeof activatePaidTenant>[0];
type Activated = Awaited<ReturnType<typeof activatePaidTenant>>;
type Profile = Activated["profile"];
type Provisioned = Activated["provisioned"];

interface Subscription {
  subscriptionId?: string | null | undefined;
}

interface Stripe {
  customerId?: string | null;
  paymentMethodId?: string | null;
}

interface TenantStripePatch {
  customerId?: string | null;
  paymentMethodId?: string | null;
  paymentMethodType?: string | null;
}

interface SubscriptionPatch {
  subscriptionId: string | null;
  planSlug?: string | null;
  currentPeriodEnd?: number | null;
  currentPeriodStart?: number | null;
}

interface SubscriptionReader {
  tenantSubscription: (tenant: string) => Subscription;
}

interface SubscriptionClearer extends SubscriptionReader {
  setTenantSubscription: (tenant: string, patch: { subscriptionId: null }) => unknown;
}

type Store = ActivationArgs["store"] & {
  setTenantSubscription: (tenant: string, patch: SubscriptionPatch) => unknown;
  tenantStripe: (tenant: string) => Stripe;
  setTenantStripe: (tenant: string, patch: TenantStripePatch) => void;
};

interface CheckoutOutcome {
  customerId: string;
  planSlug?: string | null;
  subscriptionId: string;
  currentPeriodEnd: number | null;
  currentPeriodStart: number | null;
  paymentMethodId: string | null;
  paymentMethodType?: string | null;
}

interface Billing {
  createSubscription: (args: {
    tenantRef: string;
    planSlug: string;
    customerId: string | null | undefined;
    paymentMethodId: string;
    priceId: string;
    idempotencyKey: string;
  }) => Promise<{
    subscriptionId: string;
    currentPeriodEnd: number | null;
    currentPeriodStart: number | null;
  }>;
  getSubscriptionCheckoutResult: (sessionId: string) => Promise<CheckoutOutcome>;
}

type ActivationResult =
  | {
      ok: false;
      reason: string;
      subscriptionId?: string;
      profile?: Profile;
      provisioned?: Provisioned;
    }
  | {
      ok: true;
      subscriptionId: string;
      planSlug: string;
      currentPeriodEnd: number | null;
      profile: Profile;
      provisioned: Provisioned;
    };

interface Config {
  billing: Record<"stripeStarterPriceId" | "stripeBusinessPriceId", string>;
}

const hasCardOnFileOf: (stripe: Stripe) => boolean = hasCardOnFile;

export const PLAN_SLUGS = CATALOG_SLUGS;

const PLAN_PRICE_CONFIG_KEY: Readonly<
  Record<string, "stripeStarterPriceId" | "stripeBusinessPriceId">
> = Object.freeze({
  starter: "stripeStarterPriceId",
  business: "stripeBusinessPriceId",
});

export function priceIdForPlan(slug: string, config: Config): string | null {
  const key = PLAN_PRICE_CONFIG_KEY[slug];
  if (!key) return null;
  return config.billing[key] || null;
}

const PM_KEY_SUFFIX_LEN = 12;

function subscribeIdempotencyKey(tenant: string, slug: string, paymentMethodId: string): string {
  return `sub_${tenant}_${slug}_${paymentMethodId.slice(-PM_KEY_SUFFIX_LEN)}`;
}

export function checkoutSessionIdempotencyKey({
  tenant,
  planSlug,
  priceId,
  customerId,
}: {
  tenant: string;
  planSlug: string;
  priceId: string;
  customerId: string;
}): string {
  return `subcs_${tenant}_${planSlug}_${priceId}_${customerId}`;
}

export function hasActiveSubscription(store: SubscriptionReader, tenant: string): boolean {
  return !!store.tenantSubscription(tenant).subscriptionId;
}

export function clearSubscriptionReference(store: SubscriptionClearer, tenant: string): void {
  if (!hasActiveSubscription(store, tenant)) return;
  store.setTenantSubscription(tenant, { subscriptionId: null });
}

export async function createTenantSubscription({
  store,
  billing,
  config,
  tenant,
  planSlug,
}: {
  store: Store;
  billing: Billing;
  config: Config;
  tenant: string;
  planSlug: string;
}): Promise<
  | { ok: false; reason: string }
  | { ok: true; subscriptionId: string; planSlug: string; currentPeriodEnd: number | null }
> {
  if (!isKnownPlanSlug(planSlug)) return { ok: false, reason: "unknown_plan" };
  const priceId = priceIdForPlan(planSlug, config);
  if (!priceId) return { ok: false, reason: "plan_unconfigured" };
  if (hasActiveSubscription(store, tenant)) return { ok: false, reason: "already_subscribed" };
  const { customerId, paymentMethodId } = store.tenantStripe(tenant);
  if (!paymentMethodId) return { ok: false, reason: "no_card" };
  const { subscriptionId, currentPeriodEnd, currentPeriodStart } = await billing.createSubscription(
    {
      tenantRef: tenant,
      planSlug,
      customerId,
      paymentMethodId,
      priceId,
      idempotencyKey: subscribeIdempotencyKey(tenant, planSlug, paymentMethodId),
    },
  );
  store.setTenantSubscription(tenant, {
    subscriptionId,
    planSlug,
    currentPeriodEnd,
    currentPeriodStart,
  });
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
}: {
  store: Store;
  billing: Billing & ActivationArgs["billing"];
  accounts: ActivationArgs["accounts"];
  provision: ActivationArgs["provision"];
  tenant: string;
  sessionId: string;
  expectedPlanSlug: string;
}): Promise<ActivationResult> {
  const outcome = await billing.getSubscriptionCheckoutResult(sessionId);
  if (!customerMatches(store, tenant, outcome.customerId))
    return { ok: false, reason: "customer_mismatch" };
  if (!outcome.planSlug || outcome.planSlug !== expectedPlanSlug)
    return { ok: false, reason: "plan_mismatch" };
  if (hasActiveSubscription(store, tenant)) {
    const existing = store.tenantSubscription(tenant);
    if (existing.subscriptionId === outcome.subscriptionId) {
      if (hasCardOnFileOf(store.tenantStripe(tenant)))
        return { ok: false, reason: "already_subscribed" };
      bindPaymentMethodOnTenant(store, tenant, outcome);
      store.setTenantSubscription(tenant, {
        subscriptionId: outcome.subscriptionId,
        planSlug: outcome.planSlug,
        currentPeriodEnd: outcome.currentPeriodEnd,
        currentPeriodStart: outcome.currentPeriodStart,
      });
      const { profile, provisioned } = await activatePaidTenant({
        store,
        accounts,
        provision,
        billing,
        tenant,
      });
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
  const { profile, provisioned } = await activatePaidTenant({
    store,
    accounts,
    provision,
    billing,
    tenant,
  });
  return {
    ok: true,
    subscriptionId: outcome.subscriptionId,
    planSlug: outcome.planSlug,
    currentPeriodEnd: outcome.currentPeriodEnd,
    profile,
    provisioned,
  };
}
