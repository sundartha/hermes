import { NUMBER_SWAP_JOB } from "../../begriffe/nummern-vergabe.js";

interface TauschJob {
  kind: string;
  numberId: string;
  idempotencyKey: string;
}

const SWAP_KEY_PREFIX = "tausch_";
export const swapKey = (oldNumberId: string): string => `${SWAP_KEY_PREFIX}${oldNumberId}`;

export function ersatzZuAlterNummer(state: { provisioningJobs?: TauschJob[] }): Map<string, string> {
  const paare = new Map<string, string>();
  for (const job of state.provisioningJobs ?? [])
    if (job.kind === NUMBER_SWAP_JOB) paare.set(job.numberId, job.idempotencyKey.slice(SWAP_KEY_PREFIX.length));
  return paare;
}
