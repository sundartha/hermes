import {
  tenantHasLiveNumber,
  tenantGeo,
  requestNumber,
  redriveAgeHoldReason,
} from "../store/state-ops.js";
import { PROVIDER, NEEDS_MANUAL_RECONCILE_REASON } from "../begriffe/nummern-vergabe.ts";
import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../begriffe/nummern.ts";
import { kauflandFuer } from "../begriffe/rufnummern.ts";
import { ok, fehler, type Ergebnis } from "../utils/ergebnis.ts";

type Zustand = Parameters<typeof tenantGeo>[0] & {
  provisioningJobs: { id: string; numberId: string; status: string; createdAt?: string | null }[];
};

interface Neuanfrage {
  reason?: undefined;
  number: Zustand["numbers"][number];
}

interface Wiederaufnahme {
  reason: "redrive";
  numberId: string;
  jobId: string;
  job: Zustand["provisioningJobs"][number];
}

export function requestNumberForPaidTenant(
  state: Zustand,
  { tenantId, maxNumbers, maxNumbersPerTenant }: { tenantId: string; maxNumbers: number; maxNumbersPerTenant: number },
): Ergebnis<Neuanfrage> {
  if (tenantHasLiveNumber(state, tenantId))
    return fehler("already_provisioned");
  const tenantCountry: string | null | undefined = tenantGeo(state, tenantId).country;
  return requestNumber(state, {
    tenantId,
    provider: PROVIDER.TELNYX,
    country: kauflandFuer(tenantCountry),
    maxNumbers,
    maxNumbersPerTenant,
  });
}

export function resolveProvisionRetry(
  state: Zustand,
  opts: { tenantId: string; nowMs: number; maxAgeMs: number; maxNumbers: number; maxNumbersPerTenant: number },
): Ergebnis<Neuanfrage | Wiederaufnahme> {
  const stuck = findStuckRequestedProvision(state, opts.tenantId);
  if (!stuck) return requestNumberForPaidTenant(state, opts);
  if (redriveAgeHoldReason(stuck.job, opts.nowMs, opts.maxAgeMs))
    return fehler(NEEDS_MANUAL_RECONCILE_REASON);
  return ok({ reason: "redrive", numberId: stuck.number.id, jobId: stuck.job.id, job: stuck.job });
}

function findStuckRequestedProvision(
  state: Zustand,
  tenantId: string,
): { number: Zustand["numbers"][number]; job: Zustand["provisioningJobs"][number] } | null {
  for (const number of state.numbers) {
    if (number.tenantId !== tenantId || number.status !== NUMBER_STATUS.REQUESTED) continue;
    const job = state.provisioningJobs.find(
      (j) => j.numberId === number.id && j.status === PROVISIONING_JOB_STATUS.QUEUED,
    );
    if (job) return { number, job };
  }
  return null;
}
