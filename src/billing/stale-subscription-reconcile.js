import { clearSubscriptionReference } from "./subscribe.js";
import { tenantsForStaleSubscriptionReconcile } from "../store/state-ops.js";

const DEAD_SUBSCRIPTION_STATUS = Object.freeze(new Set(["canceled", "incomplete_expired"]));

export const STALE_SUB_OUTCOME = Object.freeze({
  CLEARED: "cleared",
  ALIVE: "alive",
  LOOKUP_FAILED: "lookup_failed",
});

export async function reconcileStaleSubscriptions({ store, billing, apply = false, logger = console }) {
  const candidates = tenantsForStaleSubscriptionReconcile(store.load());
  const report = { apply, scanned: candidates.length, cleared: [], alive: [], errors: [] };
  for (const tenant of candidates) {
    let status;
    try {
      ({ status } = await billing.retrieveSubscription(tenant.stripeSubscriptionId));
    } catch (err) {
      logger.warn(`[stale-subs] Statusabfrage fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
      report.errors.push({ id: tenant.id, reason: STALE_SUB_OUTCOME.LOOKUP_FAILED });
      continue;
    }
    if (!DEAD_SUBSCRIPTION_STATUS.has(status)) {
      report.alive.push({ id: tenant.id, status: status ?? null });
      continue;
    }
    report.cleared.push({ id: tenant.id, status });
    if (apply) clearSubscriptionReference(store, tenant.id);
  }
  return report;
}
