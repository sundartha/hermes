import { findNumber } from "../store/state-ops.js";
import { provisionNumber } from "../onboarding.ts";
import { NUMBER_STATUS } from "../begriffe/nummern.js";

type ProvisionState = Parameters<typeof provisionNumber>[0];
type ProvisionDeps = Parameters<typeof provisionNumber>[1];
type ProvisionAuftrag = Parameters<typeof provisionNumber>[2];

interface ProvisionJob {
  payload: { numberId: string };
}

type ProvisionOptionen = Omit<ProvisionAuftrag, "numberId">;

export async function handleProvisionJob(
  s: ProvisionState,
  job: ProvisionJob,
  { opts, ...deps }: ProvisionDeps & { opts: ProvisionOptionen },
) {
  const { numberId } = job.payload;
  const number = findNumber(s, numberId);
  if (!number || number.status !== NUMBER_STATUS.REQUESTED)
    return { skipped: true, status: number?.status ?? null };
  const result = await provisionNumber(s, deps, { numberId, ...opts });
  return { number: result };
}
