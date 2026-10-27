import { readFileSync } from "node:fs";

import { Instrumenter } from "@stryker-mutator/instrumenter";

const STUMM = { debug() {}, info() {}, warn() {}, isDebugEnabled: () => false };
const OPTIONEN = { plugins: null, ignorers: [], excludedMutations: [] };
const ZEILENENDE = Number.MAX_SAFE_INTEGER;

function strykerBereich([von, bis]) {
  return { start: { line: von - 1, column: 0 }, end: { line: bis - 1, column: ZEILENENDE } };
}

async function zaehle(datei, bereiche) {
  const quelle = { name: datei, content: readFileSync(datei, "utf8"), mutate: bereiche.map(strykerBereich) };
  const { mutants } = await new Instrumenter(STUMM).instrument([quelle], OPTIONEN);
  return mutants.length;
}

export async function hatMutanten(datei, bereiche) {
  try {
    return (await zaehle(datei, bereiche)) > 0;
  } catch (fehler) {
    console.log(`${datei}: Mutanten vorab nicht zählbar (${fehler.message}), Prüfung mit Sperre wie bisher.`);
    return true;
  }
}

export async function mutantenzahl(dateien) {
  const summe = { mutanten: 0, unzaehlbar: 0 };
  for (const { datei, bereiche } of dateien) {
    try {
      summe.mutanten += await zaehle(datei, bereiche);
    } catch (fehler) {
      console.log(`${datei}: Mutanten für die Vorschau nicht zählbar (${fehler.message}); die Schätzung ist eine Untergrenze, das Budget gilt.`);
      summe.unzaehlbar += 1;
    }
  }
  return summe;
}
