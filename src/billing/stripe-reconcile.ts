import { applyStripeWebhookSerialized, SUBSCRIPTION_EVENT } from "./webhook.ts";
import { tenantsForStripeReconcile } from "../store/state-ops.js";
import { MS_PER_SECOND } from "../utils/timer.js";

interface Billing {
  retrieveSubscription: (subscriptionId: string) => Promise<{ status?: string }>;
}

interface SubscriptionDeletedEvent {
  id: string;
  created: number;
  type: string;
  data: { object: { id: string; metadata: { tenant_ref: string } } };
}

interface Logger {
  warn: (message: string) => void;
}

const fehlertext = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const kandidaten: (state: unknown) => { id: string; stripeSubscriptionId: string }[] = tenantsForStripeReconcile;

const HEALING_STRIPE_STATUS = "canceled";

export function syntheticSubscriptionDeletedEvent({
  tenantId,
  subscriptionId,
  nowMs,
}: {
  tenantId: string;
  subscriptionId: string;
  nowMs: number;
}): SubscriptionDeletedEvent {
  return {
    id: `evt_reconcile_${tenantId}_${subscriptionId}`,
    created: Math.floor(nowMs / MS_PER_SECOND),
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: subscriptionId, metadata: { tenant_ref: tenantId } } },
  };
}

export async function runStripeSubscriptionReconcile({
  store,
  billing,
  webhookDeps,
  logger = console,
  nowMs,
}: {
  store: { load: () => unknown };
  billing: Billing;
  webhookDeps: Parameters<typeof applyStripeWebhookSerialized>[1];
  logger?: Logger;
  nowMs: number;
}): Promise<{ checked: number; healed: number; errors: number }> {
  const candidates = kandidaten(store.load());
  let healed = 0;
  let errors = 0;
  for (const tenant of candidates) {
    let status: string | undefined;
    try {
      ({ status } = await billing.retrieveSubscription(tenant.stripeSubscriptionId));
    } catch (err) {
      logger.warn(`[stripe-reconcile] Statusabfrage fehlgeschlagen tenant=${tenant.id}: ${fehlertext(err)}`);
      errors++;
      continue;
    }
    if (status !== HEALING_STRIPE_STATUS) continue;
    logger.warn(
      `[stripe-reconcile] Abo bei Stripe beendet, Tenant nicht suspendiert (verlorener Webhook) -> heile tenant=${tenant.id}`,
    );
    const event = syntheticSubscriptionDeletedEvent({
      tenantId: tenant.id,
      subscriptionId: tenant.stripeSubscriptionId,
      nowMs,
    });
    try {
      await applyStripeWebhookSerialized(event, webhookDeps);
      healed++;
    } catch (err) {
      logger.warn(`[stripe-reconcile] Heilung fehlgeschlagen tenant=${tenant.id}: ${fehlertext(err)}`);
      errors++;
    }
  }
  return { checked: candidates.length, healed, errors };
}
