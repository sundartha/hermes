import { findNumber } from "../store/state-ops.js";
import { provisionNumber } from "../onboarding.ts";
import { NUMBER_STATUS } from "../begriffe/nummern.ts";

type ProvisionArgs = Parameters<typeof provisionNumber>;
type ProvisionState = ProvisionArgs[0];
type ProvisionDeps = ProvisionArgs[1];
type ProvisionAuftrag = ProvisionArgs extends [unknown, unknown, infer Auftrag] ? Auftrag : never;
type ProvisionNumber = Awaited<ReturnType<typeof provisionNumber>>;

interface ProvisionJob {
  payload: { numberId: string };
}

type ProvisionDepsMitOpts = ProvisionDeps & { opts: Omit<ProvisionAuftrag, "numberId"> };

type ProvisionErgebnis = { skipped: true; status: string | null } | { number: ProvisionNumber };

export async function handleProvisionJob(
  state: ProvisionState,
  job: ProvisionJob,
  { opts, ...deps }: ProvisionDepsMitOpts,
): Promise<ProvisionErgebnis> {
  const { numberId } = job.payload;
  const number = findNumber(state, numberId);
  if (number?.status !== NUMBER_STATUS.REQUESTED)
    return { skipped: true, status: number?.status ?? null };
  const result = await provisionNumber(state, deps, { numberId, ...opts });
  return { number: result };
}
