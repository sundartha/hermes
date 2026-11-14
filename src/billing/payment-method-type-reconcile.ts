import { bindPaymentMethodOnTenant } from "./card-setup.ts";
import { speicherBereiche } from "../store.js";

const bereicheVon: (store: Store) => Bereiche = speicherBereiche;

export const PM_TYPE_OUTCOME = Object.freeze({
  FILLED: "filled",
  UNKNOWN: "unknown",
  LOOKUP_FAILED: "lookup_failed",
});

interface Report {
  apply: boolean;
  scanned: number;
  filled: { id: string; paymentMethodType: string | null }[];
  unknown: { id: string; reason: string }[];
  errors: { id: string; reason: string }[];
}

type Store = Parameters<typeof bindPaymentMethodOnTenant>[0] & {
  load: () => unknown;
};

interface Tenant { id: string; stripePaymentMethodId: string }

interface Bereiche {
  abgleich: { zahlartTypKandidaten: () => Promise<Tenant[]> };
}

interface Billing { retrievePaymentMethodType: (paymentMethodId: string) => Promise<unknown> }

interface Logger { warn: (message: string) => void }

export async function fillPaymentMethodType({
  store,
  billing,
  tenant,
  apply = false,
  logger = console,
}: {
  store: Store;
  billing: Billing;
  tenant: Tenant;
  apply?: boolean;
  logger?: Logger;
}): Promise<{ outcome: string; paymentMethodType: string | null }> {
  let paymentMethodType: unknown;
  try {
    paymentMethodType = await billing.retrievePaymentMethodType(tenant.stripePaymentMethodId);
  } catch (err) {
    logger.warn(`[pm-type] Typ-Abfrage fehlgeschlagen tenant=${tenant.id}: ${err instanceof Error ? err.message : String(err)}`);
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

export async function reconcilePaymentMethodTypes({
  store,
  billing,
  apply = false,
  logger = console,
}: {
  store: Store;
  billing: Billing;
  apply?: boolean;
  logger?: Logger;
}): Promise<Report> {
  const bereiche = bereicheVon(store);
  const candidates = await bereiche.abgleich.zahlartTypKandidaten();
  const report: Report = { apply, scanned: candidates.length, filled: [], unknown: [], errors: [] };
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
