import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Instrumenter } from "@stryker-mutator/instrumenter";

import { mutantenOrt } from "./mutantenort.mjs";

const STUMM = { debug() {}, info() {}, warn() {}, isDebugEnabled: () => false };
const KONFIGURATIONSDATEI = fileURLToPath(new URL("../../stryker.config.json", import.meta.url));
const ZEILENENDE = Number.MAX_SAFE_INTEGER;

function strykerBereich([von, bis]) {
  return { start: { line: von - 1, column: 0 }, end: { line: bis - 1, column: ZEILENENDE } };
}

export function instrumenterOptionen({ mutator = {}, ignorers = [] }) {
  if (ignorers.length > 0 || (mutator.plugins ?? []).length > 0) throw new Error("die Stryker-Konfiguration nennt Ignorer oder Mutator-Plugins, die die Planung nicht nachbildet");
  return { plugins: null, ignorers: [], excludedMutations: mutator.excludedMutations ?? [] };
}

async function instrumentiert(datei, bereiche) {
  const quelle = { name: datei, content: readFileSync(datei, "utf8"), mutate: bereiche.map(strykerBereich) };
  const optionen = instrumenterOptionen(JSON.parse(readFileSync(KONFIGURATIONSDATEI, "utf8")));
  const { mutants } = await new Instrumenter(STUMM).instrument([quelle], optionen);
  return mutants;
}

async function zaehle(datei, bereiche) {
  return (await instrumentiert(datei, bereiche)).length;
}

function berichtsPosition({ line, column }) {
  return { line: line + 1, column: column + 1 };
}

function eintragAus({ fileName, location, mutatorName, replacement }) {
  const lage = { start: berichtsPosition(location.start), end: berichtsPosition(location.end) };
  return { ...mutantenOrt({ fileName, location: lage, mutatorName, replacement }), lage, art: mutatorName };
}

export async function mutantenListe(datei, bereiche) {
  try {
    return (await instrumentiert(datei, bereiche)).map(eintragAus);
  } catch (fehler) {
    console.log(`${datei}: Mutanten für den Plan nicht aufzählbar (${fehler.message}), die Datei bleibt ungeteilt und ohne Übernahme.`);
    return null;
  }
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
