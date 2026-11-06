import { appendFileSync } from "node:fs";
import { env } from "node:process";

import { ersetzeStryker, gefragteMutanten, mutantenergebnis } from "./mutationspruefung-ersatz-gemeinsam.mjs";

const QUELLE = "src/zahl.js";
const ZEILE = 3;
const BREITE = 8;
const ERSTE_ZEITGRENZE_MS = 60_000;
const MUTANTEN = [
  { art: "ueberlebt", spalte: 2, danach: "Survived" },
  { art: "haenger", spalte: 12, danach: "Timeout" },
  { art: "getoetet", spalte: 22, danach: "Killed" },
];

ersetzeStryker(import.meta.url);

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
  }

  async runMutationTest() {
    const { mutate, tap, timeoutMS } = this.#optionen;
    const faktor = timeoutMS / ERSTE_ZEITGRENZE_MS;
    const gefragt = mutate.flatMap((muster) => gefragteMutanten(muster, { zeile: ZEILE, mutanten: MUTANTEN }));
    appendFileSync(env.STRYKER_AUFRUFE, `${JSON.stringify({ faktor, mutanten: gefragt.map(({ art }) => art), tests: tap.testFiles })}\n`);
    return gefragt.map(({ art, spalte, danach }) => {
      const status = faktor === 1 ? "Timeout" : danach;
      return mutantenergebnis({ quelle: QUELLE, zeile: ZEILE, spalte, breite: BREITE, art }, { status, toeter: status === "Killed" ? tap.testFiles[0] : undefined });
    });
  }
}
