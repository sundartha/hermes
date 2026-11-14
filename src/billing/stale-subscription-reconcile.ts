import { clearSubscriptionReference } from "./subscribe.ts";
import { speicherBereiche } from "../store.js";

const bereicheVon: (store: Store) => Bereiche = speicherBereiche;

const DEAD_SUBSCRIPTION_STATUS: ReadonlySet<string | undefined> = Object.freeze(new Set(["canceled", "incomplete_expired"]));

export const STALE_SUB_OUTCOME = Object.freeze({
  CLEARED: "cleared",
  ALIVE: "alive",
  LOOKUP_FAILED: "lookup_failed",
});

interface Store {
  load: () => unknown;
  tenantSubscription: (tenant: string) => { subscriptionId?: string | null };
  setTenantSubscription: (tenant: string, patch: { subscriptionId: null }) => unknown;
}

interface Candidate {
  id: string;
  stripeSubscriptionId: string;
}

interface Bereiche {
  abgleich: { veralteteAboKandidaten: () => Promise<Candidate[]> };
}

interface Report {
  apply: boolean;
  scanned: number;
  cleared: { id: string; status: string | undefined }[];
  alive: { id: string; status: string | null }[];
  errors: { id: string; reason: string }[];
}

export async function reconcileStaleSubscriptions({
  store,
  billing,
  apply = false,
  logger = console,
}: {
  store: Store;
  billing: { retrieveSubscription: (subscriptionId: string) => Promise<{ status?: string }> };
  apply?: boolean;
  logger?: { warn: (message: string) => void };
}): Promise<Report> {
  const bereiche = bereicheVon(store);
  const candidates = await bereiche.abgleich.veralteteAboKandidaten();
  const report: Report = { apply, scanned: candidates.length, cleared: [], alive: [], errors: [] };
  for (const tenant of candidates) {
    let status: string | undefined;
    try {
      ({ status } = await billing.retrieveSubscription(tenant.stripeSubscriptionId));
    } catch (err) {
      logger.warn(
        `[stale-subs] Statusabfrage fehlgeschlagen tenant=${tenant.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
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
