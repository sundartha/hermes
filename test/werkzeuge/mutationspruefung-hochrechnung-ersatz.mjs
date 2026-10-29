import { appendFileSync } from "node:fs";
import { env } from "node:process";

import { echtWarten } from "../echt-warten.js";
import { MINDEST_MUTANTEN, strykerPlugins } from "../../tools/mutationspruefung/zeitlog.mjs";
import { ersetzeStryker, mutantenergebnis } from "./mutationspruefung-ersatz-gemeinsam.mjs";

const QUELLE = "src/zahl.js";
const GEPLANT = Number(env.GEPLANT ?? 25);
const BREITE = 8;
const SPALTENABSTAND = 10;
const PAUSE_MS = 50;
const echteUhr = Date.now;
let verschoben = 0;
let laeufe = 0;

ersetzeStryker(import.meta.url);
Date.now = () => echteUhr() + verschoben;

function ergebnis(stelle, tests, status) {
  return mutantenergebnis(
    { quelle: QUELLE, zeile: 1, spalte: stelle * SPALTENABSTAND, breite: BREITE, art: `mutant${stelle}` },
    { status, toeter: status === "Killed" ? tests[0] : undefined },
  );
}

function msJeMutant(stelle, folge) {
  if (folge) return Number(env.FOLGE_MS_JE_MUTANT);
  return stelle < MINDEST_MUTANTEN ? Number(env.MS_JE_MUTANT) : Number(env.MS_JE_MUTANT_SPAETER ?? env.MS_JE_MUTANT);
}

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
  }

  async runMutationTest() {
    laeufe += 1;
    const folge = env.ZEITUEBERSCHREITUNG === "1" && laeufe > 1;
    const anzahl = folge ? 1 : GEPLANT;
    const berichter = strykerPlugins[0].factory(this.#optionen);
    verschoben += Number(env.ERSTLAUF_MS);
    berichter.onDryRunCompleted({ result: { tests: [] }, timing: { net: Number(env.ERSTLAUF_MS), overhead: 0 } });
    berichter.onMutationTestingPlanReady({ mutantPlans: Array.from({ length: anzahl }, () => ({ plan: "Run" })) });
    for (let stelle = 0; stelle < anzahl; stelle += 1) {
      verschoben += msJeMutant(stelle, folge);
      berichter.onMutantTested({ status: "Killed" });
      appendFileSync(env.GETESTET, "x\n");
      await echtWarten(PAUSE_MS);
    }
    const zeitueberschreitung = !folge && env.ZEITUEBERSCHREITUNG === "1" && laeufe === 1;
    return Array.from({ length: anzahl }, (_leer, stelle) => ergebnis(stelle, this.#optionen.tap.testFiles, zeitueberschreitung && stelle === 0 ? "Timeout" : "Killed"));
  }
}
