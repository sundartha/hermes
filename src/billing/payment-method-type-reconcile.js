import { bindPaymentMethodOnTenant } from "./card-setup.js";
import { tenantsForPaymentMethodTypeReconcile } from "../store/state-ops.js";

export const PM_TYPE_OUTCOME = Object.freeze({
  FILLED: "filled",
  UNKNOWN: "unknown",
  LOOKUP_FAILED: "lookup_failed",
});

export async function fillPaymentMethodType({ store, billing, tenant, apply = false, logger = console }) {
  let paymentMethodType;
  try {
    paymentMethodType = await billing.retrievePaymentMethodType(tenant.stripePaymentMethodId);
  } catch (err) {
    logger.warn(`[pm-type] Typ-Abfrage fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
    return { outcome: PM_TYPE_OUTCOME.LOOKUP_FAILED, paymentMethodType: null };
  }
  if (typeof paymentMethodType !== "string" || !paymentMethodType)
    return { outcome: PM_TYPE_OUTCOME.UNKNOWN, paymentMethodType: null };
  if (apply)
    bindPaymentMethodOnTenant(store, tenant.id, {
      paymentMethodId: tenant.stripePaymentMethodId,
      paymentMethodType,
    });
  return { outcome: PM_TYPE_OUTCOME.FILLED, paymentMethodType };
}

export async function reconcilePaymentMethodTypes({ store, billing, apply = false, logger = console }) {
  const candidates = tenantsForPaymentMethodTypeReconcile(store.load());
  const report = { apply, scanned: candidates.length, filled: [], unknown: [], errors: [] };
  for (const tenant of candidates) {
    const { outcome, paymentMethodType } = await fillPaymentMethodType({
      store,
      billing,
      tenant,
      apply,
      logger,
    });
    if (outcome === PM_TYPE_OUTCOME.LOOKUP_FAILED) report.errors.push({ id: tenant.id, reason: outcome });
    else if (outcome === PM_TYPE_OUTCOME.UNKNOWN) report.unknown.push({ id: tenant.id, reason: outcome });
    else report.filled.push({ id: tenant.id, paymentMethodType });
  }
  return report;
}
