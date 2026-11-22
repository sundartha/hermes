import { findNumber } from "../store/state-ops.js";
import { provisionNumber } from "../onboarding.ts";
import { NUMBER_STATUS } from "../begriffe/nummern.js";

export async function handleProvisionJob(state, job, { opts, ...deps }) {
  const { numberId } = job.payload;
  const number = findNumber(state, numberId);
  if (number?.status !== NUMBER_STATUS.REQUESTED)
    return { skipped: true, status: number?.status ?? null };
  const result = await provisionNumber(state, deps, { numberId, ...opts });
  return { number: result };
}
