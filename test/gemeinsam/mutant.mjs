import { env } from "node:process";

const AKTIVER_MUTANT = "__STRYKER_ACTIVE_MUTANT__";

export function mitAktivemMutanten(kindUmgebung) {
  const mutant = env[AKTIVER_MUTANT];
  if (mutant === undefined) return kindUmgebung;
  const optionen = [env.NODE_OPTIONS, kindUmgebung.NODE_OPTIONS].filter(Boolean).join(" ");
  return { ...kindUmgebung, [AKTIVER_MUTANT]: mutant, NODE_OPTIONS: optionen };
}
