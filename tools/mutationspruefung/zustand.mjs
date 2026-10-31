import { argv, env } from "node:process";

export const MUTANTEN_ZUSTAND = [
  /__stryker|stryker_|stry(?:mutact|cov|ns)_|active_?mutant|mutant__/i,
  /STRYKER/,
];

export const KINDABDECKUNG_ORDNER = "MUTATIONSPRUEFUNG_KINDABDECKUNG";
export const KINDABDECKUNG_TESTDATEI = "MUTATIONSPRUEFUNG_KINDABDECKUNG_TESTDATEI";
export const EINBETTUNG_VORSPANN = "MUTATIONSPRUEFUNG_EINBETTUNG_VORSPANN";

const AKTIVER_MUTANT = "__STRYKER_ACTIVE_MUTANT__";
const KINDABDECKUNG_HOOK = new URL("./kindabdeckung-hook.mjs", import.meta.url).href;

function mitKindabdeckung(kindUmgebung) {
  const ordner = env[KINDABDECKUNG_ORDNER];
  if (ordner === undefined) return kindUmgebung;
  return {
    ...kindUmgebung,
    NODE_OPTIONS: [kindUmgebung.NODE_OPTIONS, `--import=${KINDABDECKUNG_HOOK}`].filter(Boolean).join(" "),
    [KINDABDECKUNG_ORDNER]: ordner,
    [KINDABDECKUNG_TESTDATEI]: env[KINDABDECKUNG_TESTDATEI] ?? argv[1],
  };
}

function mitEinbettung(kindUmgebung) {
  const vorspann = env[EINBETTUNG_VORSPANN];
  if (vorspann === undefined) return kindUmgebung;
  return { ...kindUmgebung, NODE_OPTIONS: [kindUmgebung.NODE_OPTIONS, `--import=${vorspann}`].filter(Boolean).join(" ") };
}

export function mitAktivemMutanten(kindUmgebung) {
  const mutant = env[AKTIVER_MUTANT];
  return mitKindabdeckung(mitEinbettung(mutant === undefined ? kindUmgebung : { ...kindUmgebung, [AKTIVER_MUTANT]: mutant }));
}
