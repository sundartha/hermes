import { appendFileSync } from "node:fs";
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
  { art: "lebt", spalte: 42, abbruch: "Timeout", abbruchBis: 1, danach: "Survived", nurGewaehlt: true },
  { art: "getoetet", spalte: 52, abbruch: "Timeout", abbruchBis: 1, nurGewaehlt: true },
];
const aufrufe = new Map();

ersetzeStryker(import.meta.url);

function mutant({ art, spalte, abbruch, abbruchBis, danach = "Killed" }, tests) {
  const aufruf = (aufrufe.get(art) ?? 0) + 1;
  aufrufe.set(art, aufruf);
  const abgebrochen = aufruf <= abbruchBis;
  return mutantenergebnis(
    { quelle: QUELLE, zeile: ZEILE, spalte, breite: BREITE, art },
    { status: abgebrochen ? abbruch : danach, toeter: abgebrochen || danach !== "Killed" ? undefined : tests[0] },
  );
}

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
  }

  async runMutationTest() {
    const arten = env.MUTANTEN_ARTEN?.split(",");
    const { mutate, tap, timeoutMS } = this.#optionen;
    const gefragt = mutate
      .flatMap((muster) => gefragteMutanten(muster, { zeile: ZEILE, mutanten: MUTANTEN }))
      .filter(({ art, nurGewaehlt }) => (arten === undefined ? nurGewaehlt !== true : arten.includes(art)));
    if (env.AUFRUFPROTOKOLL !== undefined) {
      const zeile = { zeitgrenzeMS: timeoutMS, mutanten: gefragt.map(({ art }) => art), tests: tap.testFiles };
      appendFileSync(env.AUFRUFPROTOKOLL, `${JSON.stringify(zeile)}\n`);
    }
    return gefragt.map((eintrag) => mutant(eintrag, tap.testFiles));
  }
}
