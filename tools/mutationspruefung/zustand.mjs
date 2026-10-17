import { env } from "node:process";

export const MUTANTEN_ZUSTAND = [
  /__stryker|stryker_|stry(?:mutact|cov|ns)_|active_?mutant|mutant__/i,
  /STRYKER/,
];

const AKTIVER_MUTANT = "__STRYKER_ACTIVE_MUTANT__";

export function mitAktivemMutanten(kindUmgebung) {
  const mutant = env[AKTIVER_MUTANT];
  return mutant === undefined ? kindUmgebung : { ...kindUmgebung, [AKTIVER_MUTANT]: mutant };
}
