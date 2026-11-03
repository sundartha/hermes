import {
  tenantHasLiveNumber,
  tenantGeo,
  requestNumber,
  redriveAgeHoldReason,
} from "../store/state-ops.js";
import { languageForCountry } from "../i18n/locales.js";
import {
  PROVIDER,
  NUMBER_STATUS,
  PROVISIONING_JOB_STATUS,
  NEEDS_MANUAL_RECONCILE_REASON,
} from "../store/defaults.js";
import { resolveNumberCountry } from "../geo/resolve.js";
import { PURCHASABLE_COUNTRIES } from "../telephony/provisioning-geo.js";

export function requestNumberForPaidTenant(state, { tenantId, maxNumbers, maxNumbersPerTenant }) {
  if (tenantHasLiveNumber(state, tenantId)) return { ok: false, reason: "already_provisioned" };
  const tenantCountry = tenantGeo(state, tenantId).country;
  const numberCountry = resolveNumberCountry(tenantCountry, PURCHASABLE_COUNTRIES);
  return requestNumber(state, {
    tenantId,
    provider: PROVIDER.TELNYX,
    country: numberCountry,
    language: languageForCountry(tenantCountry),
    maxNumbers,
    maxNumbersPerTenant,
  });
}

export function resolveProvisionRetry(s, opts) {
  const stuck = findStuckRequestedProvision(s, opts.tenantId);
  if (!stuck) return requestNumberForPaidTenant(s, opts);
  if (redriveAgeHoldReason(stuck.job, opts.nowMs, opts.maxAgeMs))
    return { ok: false, reason: NEEDS_MANUAL_RECONCILE_REASON };
  return { ok: true, reason: "redrive", numberId: stuck.number.id, jobId: stuck.job.id, job: stuck.job };
}

function findStuckRequestedProvision(s, tenantId) {
  for (const number of s.numbers) {
    if (number.tenantId !== tenantId || number.status !== NUMBER_STATUS.REQUESTED) continue;
    const job = s.provisioningJobs.find(
      (j) => j.numberId === number.id && j.status === PROVISIONING_JOB_STATUS.QUEUED,
    );
    if (job) return { number, job };
  }
  return null;
}
