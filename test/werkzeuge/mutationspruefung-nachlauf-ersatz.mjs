import { appendFileSync } from "node:fs";
import { env } from "node:process";

import { ersetzeStryker, gefragteMutanten, mutantenergebnis } from "./mutationspruefung-ersatz-gemeinsam.mjs";

const QUELLE = "src/zahl.js";
const SPALTE = 2;
const BREITE = 10;
const ERSTE_ZEILE = 2;
const KURZE_GRENZE_MS = 60_000;
const KOSTEN_OHNE_ZEITABLAUF_MS = 1000;
const HAENGT = "haengt";
const LANG_GETOETET = "lang getoetet";
const LANG_UEBERLEBT = "lang ueberlebt";
const NICHT_BESTAETIGT = "nicht bestaetigt";
const GETOETET = "getoetet";
const UEBERLEBT = "ueberlebt";
const NACHBAR = "nur lang rot";
const JE_ART = 4;
const HAENGER = 20;
const ARTEN = [...Array(HAENGER).fill(HAENGT), ...[LANG_GETOETET, LANG_UEBERLEBT, NICHT_BESTAETIGT, GETOETET, UEBERLEBT].flatMap((art) => Array(JE_ART).fill(art))];
const ZEITLOS = { [HAENGT]: GETOETET, [LANG_GETOETET]: GETOETET, [LANG_UEBERLEBT]: UEBERLEBT, [NICHT_BESTAETIGT]: UEBERLEBT };
const ZEILE_MIT_NACHBAR = ERSTE_ZEILE + HAENGER;
const MUTANTEN = [
  ...ARTEN.map((art, index) => ({ art: env.OHNE_ZEITGRENZE === undefined ? art : (ZEITLOS[art] ?? art), name: `m${index}`, zeile: ERSTE_ZEILE + index, spalte: SPALTE })),
  { art: NACHBAR, name: `m${ARTEN.length}`, zeile: ZEILE_MIT_NACHBAR, spalte: SPALTE },
];
const ZEITABLAUF = { status: "Timeout" };
const AM_LEBEN = { status: "Survived" };

ersetzeStryker(import.meta.url);

function rot(tests) {
  return { status: "Killed", toeter: tests[0] };
}

function ergebnis(art, tests, lang) {
  if (art === NACHBAR) return lang ? rot(tests) : AM_LEBEN;
  if (art === HAENGT) return ZEITABLAUF;
  if (art === GETOETET) return rot(tests);
  if (art === UEBERLEBT) return AM_LEBEN;
  if (!lang) return ZEITABLAUF;
  if (art === LANG_GETOETET) return rot(tests);
  if (art === LANG_UEBERLEBT) return AM_LEBEN;
  return tests.length > 1 ? rot(tests) : AM_LEBEN;
}

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
  }

  async runMutationTest() {
    const { mutate, tap, timeoutMS } = this.#optionen;
    const gefragt = mutate.flatMap((muster) => MUTANTEN.flatMap((eintrag) => gefragteMutanten(muster, { zeile: eintrag.zeile, mutanten: [eintrag] })));
    const ergebnisse = gefragt.map((eintrag) => ({ eintrag, ausgang: ergebnis(eintrag.art, tap.testFiles, timeoutMS > KURZE_GRENZE_MS) }));
    const kosten = ergebnisse.reduce((summe, { ausgang }) => summe + (ausgang === ZEITABLAUF ? timeoutMS : KOSTEN_OHNE_ZEITABLAUF_MS), 0);
    appendFileSync(env.KOSTEN_DATEI, `${kosten}\n`);
    return ergebnisse.map(({ eintrag, ausgang }) => mutantenergebnis({ quelle: QUELLE, zeile: eintrag.zeile, spalte: eintrag.spalte, breite: BREITE, art: eintrag.name }, ausgang));
  }
}
