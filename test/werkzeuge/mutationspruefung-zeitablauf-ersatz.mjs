import { registerHooks } from "node:module";
import { join } from "node:path";
import { cwd, env } from "node:process";

const PAKET = "@stryker-mutator/core";
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
const GENAU = /:(\d+):(\d+)-\d+:\d+$/;
const ZEILENBEREICH = /:(\d+)-(\d+)$/;
const aufrufe = new Map();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === PAKET) return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

function gefragt(muster) {
  const genau = GENAU.exec(muster);
  if (genau) return MUTANTEN.filter(({ spalte }) => Number(genau[1]) === ZEILE && Number(genau[2]) === spalte - 1);
  const [, von, bis] = ZEILENBEREICH.exec(muster);
  return Number(von) <= ZEILE && ZEILE <= Number(bis) ? MUTANTEN : [];
}

function mutant({ art, spalte, abbruch, abbruchBis }, tests) {
  const aufruf = (aufrufe.get(art) ?? 0) + 1;
  aufrufe.set(art, aufruf);
  const abgebrochen = aufruf <= abbruchBis;
  return {
    fileName: join(cwd(), QUELLE),
    location: { start: { line: ZEILE, column: spalte }, end: { line: ZEILE, column: spalte + BREITE } },
    mutatorName: "EqualityOperator",
    replacement: art,
    status: abgebrochen ? abbruch : "Killed",
    killedBy: abgebrochen ? undefined : [tests[0]],
  };
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
      .flatMap(gefragt)
      .filter(({ art }) => arten === undefined || arten.includes(art))
      .map((eintrag) => mutant(eintrag, tap.testFiles));
  }
}
