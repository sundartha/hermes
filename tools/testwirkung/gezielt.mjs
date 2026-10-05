import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { nachbau } from "./attrappe.mjs";

export const ZIELE = "TESTWIRKUNG_ZIELE";
const DATEIADRESSE = "file:";
const MODULLADER = "node:internal/modules/";
const TESTORDNER = "test/";
let ziele;

export function festlegen({ wurzel, bereiche, ganz }) {
  ziele = { wurzel, bereiche: new Map(Object.entries(bereiche)), ganz: new Set(ganz) };
}

function pfad(name) {
  return name.startsWith(DATEIADRESSE) ? fileURLToPath(name) : name;
}

function aufrufstellen() {
  const { prepareStackTrace, stackTraceLimit } = Error;
  Error.prepareStackTrace = (_fehler, stellen) => stellen;
  Error.stackTraceLimit = Number.POSITIVE_INFINITY;
  try {
    const halter = {};
    Error.captureStackTrace(halter);
    return halter.stack.map((stelle) => ({ datei: pfad(stelle.getFileName() ?? ""), zeile: stelle.getLineNumber() }));
  } finally {
    Error.prepareStackTrace = prepareStackTrace;
    Error.stackTraceLimit = stackTraceLimit;
  }
}

function imTestordner({ datei }) {
  return isAbsolute(datei) && relative(ziele.wurzel, datei).startsWith(TESTORDNER);
}

function unveraendert({ datei, zeile }) {
  const eigen = relative(ziele.wurzel, datei);
  if (ziele.ganz.has(eigen)) return false;
  return !(ziele.bereiche.get(eigen) ?? []).some(([start, laenge]) => start <= zeile && zeile < start + laenge);
}

function beimLadenUnveraendert(stellen) {
  const lader = stellen.findIndex(({ datei }) => datei.startsWith(MODULLADER));
  if (lader < 1) return false;
  const oberste = stellen[lader - 1];
  return imTestordner(oberste) && unveraendert(oberste);
}

function scheitert() {
  if (ziele === undefined) return false;
  const stellen = aufrufstellen();
  if (beimLadenUnveraendert(stellen)) return false;
  const innerste = stellen.find(imTestordner);
  return innerste !== undefined && unveraendert(innerste);
}

export const attrappeVon = nachbau(scheitert);
