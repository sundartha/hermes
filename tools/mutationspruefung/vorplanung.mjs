import { readFileSync } from "node:fs";

import { Instrumenter } from "@stryker-mutator/instrumenter";

const STUMM = { debug() {}, info() {}, warn() {}, isDebugEnabled: () => false };
const OPTIONEN = { plugins: null, ignorers: [], excludedMutations: [] };
const ZEILENENDE = Number.MAX_SAFE_INTEGER;

function strykerBereich([von, bis]) {
  return { start: { line: von - 1, column: 0 }, end: { line: bis - 1, column: ZEILENENDE } };
}

export async function hatMutanten(datei, bereiche) {
  try {
    const quelle = { name: datei, content: readFileSync(datei, "utf8"), mutate: bereiche.map(strykerBereich) };
    const { mutants } = await new Instrumenter(STUMM).instrument([quelle], OPTIONEN);
    return mutants.length > 0;
  } catch (fehler) {
    console.log(`${datei}: Mutanten vorab nicht zählbar (${fehler.message}), Prüfung mit Sperre wie bisher.`);
    return true;
  }
}
