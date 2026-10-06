import { applyStripeWebhookSerialized, SUBSCRIPTION_EVENT } from "./webhook.js";
import { tenantsForStripeReconcile } from "../store/state-ops.js";

const HEALING_STRIPE_STATUS = "canceled";

export function syntheticSubscriptionDeletedEvent({ tenantId, subscriptionId, nowMs }) {
  return {
    id: `evt_reconcile_${tenantId}_${nowMs}`,
    created: Math.floor(nowMs / 1000),
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: subscriptionId, metadata: { tenant_ref: tenantId } } },
  };
}

export async function runStripeSubscriptionReconcile({ store, billing, webhookDeps, logger = console, nowMs }) {
  const candidates = tenantsForStripeReconcile(store.load());
  let healed = 0;
  let errors = 0;
  for (const tenant of candidates) {
    let status;
    try {
      ({ status } = await billing.retrieveSubscription(tenant.stripeSubscriptionId));
    } catch (err) {
      logger.warn(`[stripe-reconcile] Statusabfrage fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
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
      logger.warn(`[stripe-reconcile] Heilung fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
      errors++;
    }
  }
  return { checked: candidates.length, healed, errors };
}
