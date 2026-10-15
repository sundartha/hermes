import { readFileSync } from "node:fs";

const MUSTER = JSON.parse(readFileSync(new URL("musterdateien.json", import.meta.url), "utf8"));

export const MUSTER_REGEL = MUSTER.regel;

function laengstesPraefix(liste, pfad) {
  const passend = liste.filter(({ praefix }) => pfad.startsWith(praefix));
  return passend.reduce((bestes, eintrag) => (eintrag.praefix.length > (bestes?.praefix.length ?? -1) ? eintrag : bestes), null);
}

export function musterFuer(bereich) {
  return laengstesPraefix(MUSTER.bau, bereich);
}

export function testMusterFuer(abnahme) {
  return laengstesPraefix(MUSTER.test, abnahme);
}

export function alleMuster() {
  return [...MUSTER.bau, ...MUSTER.test];
}
