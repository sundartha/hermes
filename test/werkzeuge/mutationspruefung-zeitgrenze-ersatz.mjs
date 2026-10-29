import { registerHooks } from "node:module";
import { join } from "node:path";
import { cwd, env } from "node:process";

const PAKET = "@stryker-mutator/core";
const GESCHEITERT = "Something went wrong in the initial test run";
const ZEITGRENZE = "Initial test run timed out! Ran 0 tests\n";
const FEHLER_STATUS = "One or more tests resulted in an error:\n\ttest/zahl.test.js\n";
const UEBERLEBENDE_TESTDATEI = "test/zahl-zwei.test.js";
const QUELLE = "src/zahl.js";
const ZEILE = 3;
const SPALTE_VON = 2;
const SPALTE_BIS = 10;
const ZEITUEBERSCHREITUNG = "Timeout";

let erstesTimeout;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === PAKET) return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

function mutant(tests) {
  const ueberlebt = tests.includes(UEBERLEBENDE_TESTDATEI);
  return {
    fileName: join(cwd(), QUELLE),
    location: { start: { line: ZEILE, column: SPALTE_VON }, end: { line: ZEILE, column: SPALTE_BIS } },
    mutatorName: "EqualityOperator",
    replacement: "zahl !== 0",
    status: ueberlebt ? "Survived" : "Killed",
    killedBy: ueberlebt ? undefined : [tests[0]],
  };
}

export class Stryker {
  #optionen;

  constructor(optionen) {
    this.#optionen = optionen;
    erstesTimeout ??= optionen.timeoutMS;
  }

  async runMutationTest() {
    const tests = this.#optionen.tap.testFiles;
    if (tests.length > Number(env.ZEITGRENZE_AB)) {
      process.stdout.write(ZEITGRENZE);
      if (env.ZEITGRENZE_FEHLER !== undefined) process.stdout.write(FEHLER_STATUS);
      throw new Error(GESCHEITERT);
    }
    const wiederholung = this.#optionen.timeoutMS > erstesTimeout;
    if (wiederholung && env.FOLGELAUF_ZEITGRENZE !== undefined) {
      process.stdout.write(ZEITGRENZE);
      throw new Error(GESCHEITERT);
    }
    const ergebnisse = this.#optionen.mutate.map(() => mutant(tests));
    if (wiederholung || env.ERSTLAUF_ZEITUEBERSCHREITUNG === undefined) return ergebnisse;
    return ergebnisse.map((ergebnis) => ({ ...ergebnis, status: ZEITUEBERSCHREITUNG, killedBy: undefined }));
  }
}
