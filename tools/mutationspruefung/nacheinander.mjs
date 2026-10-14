import { bestaetigt } from "./bestaetigung.mjs";

export const UEBERLEBT = "Survived";
export const ABGESCHALTET = new Set(["Ignored", "CheckFailed"]);
export const UEBERLEBEND = new Set([UEBERLEBT, "NoCoverage", ...ABGESCHALTET]);

export function ueberlebt({ status }) {
  return UEBERLEBEND.has(status);
}

export function staerker(eintrag, anderer) {
  if (anderer === undefined) return eintrag;
  if (!ueberlebt(eintrag)) return bestaetigt(eintrag) || ueberlebt(anderer) ? eintrag : anderer;
  return ueberlebt(anderer) && eintrag.status === UEBERLEBT ? eintrag : anderer;
}

export function vereine(ergebnisse, laeufe) {
  const nachSchluessel = new Map();
  for (const eintrag of laeufe.flat()) {
    nachSchluessel.set(eintrag.schluessel, staerker(nachSchluessel.get(eintrag.schluessel) ?? eintrag, eintrag));
  }
  return ergebnisse.map((eintrag) => staerker(eintrag, nachSchluessel.get(eintrag.schluessel)));
}

export async function nacheinander(testgruppen, zeilen, gruppenlauf) {
  let ergebnisse = null;
  for (const tests of testgruppen) {
    const offen = ergebnisse === null ? zeilen : ergebnisse.filter((eintrag) => !bestaetigt(eintrag)).map((eintrag) => eintrag.zeilen);
    if (offen.length === 0) break;
    const lauf = await gruppenlauf(offen, tests);
    ergebnisse = ergebnisse === null ? lauf : vereine(ergebnisse, [lauf]);
  }
  return ergebnisse;
}
