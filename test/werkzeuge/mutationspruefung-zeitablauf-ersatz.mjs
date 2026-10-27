import { env } from "node:process";

import { ersetzeStryker, gefragteMutanten, mutantenergebnis } from "./mutationspruefung-ersatz-gemeinsam.mjs";

const QUELLE = "src/zahl.js";
const ZEILE = 3;
const BREITE = 8;
const IMMER = Infinity;
const MUTANTEN = [
  { art: "flink", spalte: 2, abbruch: "Timeout", abbruchBis: 0 },
  { art: "haenger", spalte: 12, abbruch: "Timeout", abbruchBis: IMMER },
  { art: "langsam", spalte: 22, abbruch: "Timeout", abbruchBis: 2 },
  { art: "absturz", spalte: 32, abbruch: "RuntimeError", abbruchBis: IMMER },
];
const aufrufe = new Map();

ersetzeStryker(import.meta.url);

function mutant({ art, spalte, abbruch, abbruchBis }, tests) {
  const aufruf = (aufrufe.get(art) ?? 0) + 1;
  aufrufe.set(art, aufruf);
  const abgebrochen = aufruf <= abbruchBis;
  return mutantenergebnis(
    { quelle: QUELLE, zeile: ZEILE, spalte, breite: BREITE, art },
    { status: abgebrochen ? abbruch : "Killed", toeter: abgebrochen ? undefined : tests[0] },
  );
}

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
  }

  async runMutationTest() {
    const arten = env.MUTANTEN_ARTEN?.split(",");
    const { mutate, tap } = this.#optionen;
    return mutate
      .flatMap((muster) => gefragteMutanten(muster, { zeile: ZEILE, mutanten: MUTANTEN }))
      .filter(({ art }) => arten === undefined || arten.includes(art))
      .map((eintrag) => mutant(eintrag, tap.testFiles));
  }
}
