import { saetze } from "./neuschnitt.mjs";

const KENNUNG = /^\[NIE([1-9]\d*)\] /;
const KENNUNG_ANFANG = /^\[nie/i;

export function schutzSaetze(auftrag) {
  return saetze(auftrag?.wasDarfNiePassieren);
}

export function satzKennung(nummer) {
  return `[NIE${nummer}]`;
}

export function traegtKennung(name) {
  return KENNUNG_ANFANG.test(name);
}

export function satzNummer(name, anzahl) {
  const treffer = KENNUNG.exec(name);
  const nummer = treffer === null ? null : Number(treffer[1]);
  return nummer !== null && nummer <= anzahl ? nummer : null;
}
