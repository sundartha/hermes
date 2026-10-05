import { readFileSync } from "node:fs";

import { Instrumenter } from "@stryker-mutator/instrumenter";

import { MAX_PAKETE } from "./entscheiden.mjs";

const MAX_MUTANTEN_JE_PAKET = 3000;
const STILL = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};
const OPTIONEN = { plugins: null, ignorers: [], excludedMutations: [], noHeader: false };

async function geschaetzteMutanten(datei) {
  const quelle = { name: datei, content: readFileSync(datei, "utf8"), mutate: true };
  try {
    const { mutants } = await new Instrumenter(STILL).instrument([quelle], OPTIONEN);
    return mutants.length;
  } catch {
    return MAX_MUTANTEN_JE_PAKET;
  }
}

export async function zaehle(dateien) {
  const zahlen = [];
  for (const datei of dateien) zahlen.push({ datei, mutanten: await geschaetzteMutanten(datei) });
  return zahlen;
}

export function packe(zahlen) {
  const pakete = [];
  const absteigend = zahlen.toSorted((links, rechts) => rechts.mutanten - links.mutanten);
  for (const eintrag of absteigend) {
    const passend = pakete.find(({ summe }) => summe + eintrag.mutanten <= MAX_MUTANTEN_JE_PAKET);
    if (passend === undefined) pakete.push({ summe: eintrag.mutanten, dateien: [eintrag.datei] });
    else {
      passend.summe += eintrag.mutanten;
      passend.dateien.push(eintrag.datei);
    }
  }
  if (pakete.length > MAX_PAKETE) {
    throw new Error(
      `Zu viel auf einmal geändert: die Messung bräuchte ${pakete.length} Pakete, höchstens ${MAX_PAKETE} sind erlaubt. In kleineren Pushes ausmisten.`,
    );
  }
  return pakete.map(({ summe, dateien }) => ({ mutanten: summe, dateien: dateien.sort() }));
}
