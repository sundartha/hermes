import { env } from "node:process";

const AKTIVER_MUTANT = "__STRYKER_ACTIVE_MUTANT__";

export function mitAktivemMutanten(kindUmgebung) {
  const mutant = env[AKTIVER_MUTANT];
  return mutant === undefined ? kindUmgebung : { ...kindUmgebung, [AKTIVER_MUTANT]: mutant };
}
