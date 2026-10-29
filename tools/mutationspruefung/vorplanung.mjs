import { readFileSync } from "node:fs";

import { Instrumenter } from "@stryker-mutator/instrumenter";

import { zeilenOhneMutant } from "./zeilen-loeschen.mjs";

const STUMM = { debug() {}, info() {}, warn() {}, isDebugEnabled: () => false };
const OPTIONEN = { plugins: null, ignorers: [], excludedMutations: [] };
const ZEILENENDE = Number.MAX_SAFE_INTEGER;

function strykerBereich([von, bis]) {
  return { start: { line: von - 1, column: 0 }, end: { line: bis - 1, column: ZEILENENDE } };
}

async function instrumentiere(datei, bereiche) {
  const quelle = { name: datei, content: readFileSync(datei, "utf8"), mutate: bereiche.map(strykerBereich) };
  const { mutants } = await new Instrumenter(STUMM).instrument([quelle], OPTIONEN);
  return mutants;
}

async function zaehle(datei, bereiche) {
  return (await instrumentiere(datei, bereiche)).length;
}

function alsErgebnisse(mutanten) {
  return mutanten.map(({ mutatorName, location: { start, end } }) => ({ zeilen: [start.line + 1, end.line + 1], art: mutatorName }));
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

export async function teilumfang(dateien, { mitLoeschprobe }) {
  const umfang = [];
  for (const { datei, bereiche } of dateien) {
    try {
      const mutanten = await instrumentiere(datei, bereiche);
      const loeschzeilen = mitLoeschprobe ? zeilenOhneMutant(datei, bereiche, alsErgebnisse(mutanten)).length : 0;
      umfang.push({ datei, mutanten: mutanten.length, loeschzeilen });
    } catch (fehler) {
      console.log(`${datei}: Mutanten und Löschprobe-Zeilen für die Hochrechnung nicht zählbar (${fehler.message}); die Hochrechnung ist eine Untergrenze.`);
    }
  }
  return { dateien: umfang };
}
