import { env } from "node:process";

import { ersetzeStryker, gefragteMutanten, mutantenergebnis } from "./mutationspruefung-ersatz-gemeinsam.mjs";

const QUELLE = "src/zahl.js";
const ZEILE = 3;
const BREITE = 8;
const UEBERLEBENDER = "ueberlebender";
const MUTANTEN = [
  { art: "erster", spalte: 2 },
  { art: "zweiter", spalte: 12 },
  { art: "dritter", spalte: 22 },
  { art: UEBERLEBENDER, spalte: 32 },
];

ersetzeStryker(import.meta.url);

function mutant({ art, spalte }, tests) {
  const toeter = art === UEBERLEBENDER ? tests.find((datei) => datei === env.TOETER) : tests[0];
  return mutantenergebnis(
    { quelle: QUELLE, zeile: ZEILE, spalte, breite: BREITE, art },
    { status: toeter === undefined ? "Survived" : "Killed", toeter },
  );
}

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
  }

  async runMutationTest() {
    const { mutate, tap } = this.#optionen;
    return mutate
      .flatMap((muster) => gefragteMutanten(muster, { zeile: ZEILE, mutanten: MUTANTEN }))
      .map((eintrag) => mutant(eintrag, tap.testFiles));
  }
}
