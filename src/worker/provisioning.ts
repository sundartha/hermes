import { findNumber } from "../store/state-ops.js";
import { provisionNumber } from "../onboarding.ts";
import { NUMBER_STATUS } from "../begriffe/nummern.js";

type ProvisionArgumente = Parameters<typeof provisionNumber>;
type ProvisionState = ProvisionArgumente extends [infer Zustand, unknown, unknown]
  ? Zustand
  : never;
type ProvisionDeps = ProvisionArgumente extends [unknown, infer Abhaengigkeiten, unknown]
  ? Abhaengigkeiten
  : never;
type ProvisionAuftrag = ProvisionArgumente extends [unknown, unknown, infer Auftrag]
  ? Auftrag
  : never;
type ProvisionErgebnis =
  | { skipped: true; status: string | null }
  | { number: Awaited<ReturnType<typeof provisionNumber>> };

interface ProvisionJob {
  payload: { numberId: string };
}

type ProvisionOptionen = Omit<ProvisionAuftrag, "numberId">;

export async function handleProvisionJob(
  state: ProvisionState,
  job: ProvisionJob,
  { opts, ...deps }: ProvisionDeps & { opts: ProvisionOptionen },
): Promise<ProvisionErgebnis> {
  const { numberId } = job.payload;
  const number = findNumber(state, numberId);
  if (number?.status !== NUMBER_STATUS.REQUESTED)
    return { skipped: true, status: number?.status ?? null };
  const result = await provisionNumber(state, deps, { numberId, ...opts });
  return { number: result };
}
