import { findNumber } from "../store/state-ops.js";
import { provisionNumber } from "../onboarding.js";
import { NUMBER_STATUS } from "../store/defaults.js";

export async function handleProvisionJob(s, job, deps, opts) {
  const { numberId } = job.payload;
  const number = findNumber(s, numberId);
  if (!number || number.status !== NUMBER_STATUS.REQUESTED)
    return { skipped: true, status: number?.status ?? null };
  const result = await provisionNumber(s, deps, { numberId, ...opts });
  return { number: result };
}
