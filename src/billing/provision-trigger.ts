import {
  tenantHasLiveNumber,
  tenantGeo,
  requestNumber,
  redriveAgeHoldReason,
} from "../store/state-ops.js";
import { languageForCountry } from "../i18n/locales.js";
import { PROVIDER, NEEDS_MANUAL_RECONCILE_REASON } from "../begriffe/nummern-vergabe.js";
import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../begriffe/nummern.js";
import { kauflandFuer } from "../begriffe/rufnummern.js";

interface Ergebnis {
  ok: boolean;
  reason?: string;
  [feld: string]: unknown;
}

interface Zustand {
  numbers: { id: string; tenantId: string; status: string }[];
  provisioningJobs: { id: string; numberId: string; status: string }[];
}

export function requestNumberForPaidTenant(
  state: Zustand,
  { tenantId, maxNumbers, maxNumbersPerTenant }: { tenantId: string; maxNumbers?: number; maxNumbersPerTenant?: number },
): Ergebnis {
  if (tenantHasLiveNumber(state, tenantId))
    return { ok: false, reason: "already_provisioned" };
  const tenantCountry: unknown = tenantGeo(state, tenantId).country;
  const language: unknown = languageForCountry(tenantCountry);
  return requestNumber(state, {
    tenantId,
    provider: PROVIDER.TELNYX,
    country: kauflandFuer(tenantCountry),
    language,
    maxNumbers,
    maxNumbersPerTenant,
  });
}

export function resolveProvisionRetry(
  state: Zustand,
  opts: { tenantId: string; nowMs: number; maxAgeMs: number; maxNumbers?: number; maxNumbersPerTenant?: number },
): Ergebnis {
  const stuck = findStuckRequestedProvision(state, opts.tenantId);
  if (!stuck) return requestNumberForPaidTenant(state, opts);
  if (redriveAgeHoldReason(stuck.job, opts.nowMs, opts.maxAgeMs))
    return { ok: false, reason: NEEDS_MANUAL_RECONCILE_REASON };
  return { ok: true, reason: "redrive", numberId: stuck.number.id, jobId: stuck.job.id, job: stuck.job };
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
