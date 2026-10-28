import { saetze } from "./neuschnitt.mjs";

const KENNUNG = /^\[NIE([1-9]\d*)\] /;
const KENNUNG_ANFANG = /^\[nie/i;
export const SCHUTZFAELLE_MUSTER = KENNUNG.source;
export const ALTER_SCHUTZ = /^(\[NIE[1-9]\d*\]) (src\/\S+\.[cm]?[jt]s):([1-9]\d*)$/;
export const SCHUTZ_WIRKSAM = "Schutztest wirksam";
export const SCHUTZ_WIRKUNGSLOS = "Schutztest wirkungslos";
export const SCHUTZ_NICHT_PRUEFBAR = "Hinweis: Wirkung der Schutztests nicht prüfbar";
export const SCHUTZ_UNERREICHT = "Hinweis: Schutztest erreicht keine neue Zeile, Wirkung nicht prüfbar";
export const ALTER_SCHUTZ_BELEGT = "Hinweis: Schutz im alten Code belegt";
export const ALTER_SCHUTZ_NICHT_BELEGT = "Alter Schutz nicht belegt";
export const ALTER_SCHUTZ_UNGEPRUEFT = "Alter Schutz nicht geprüft";

export function schutzSaetze(auftrag) {
  return saetze(auftrag?.wasDarfNiePassieren);
}

export function satzKennung(nummer) {
  return `[NIE${nummer}]`;
}

export function alterSchutzBeleg(datei, zeile, name) {
  return `${ALTER_SCHUTZ_BELEGT} (${datei}:${zeile}): ${name}`;
}

export function traegtKennung(name) {
  return KENNUNG_ANFANG.test(name);
}

export function satzNummer(name, anzahl) {
  const treffer = KENNUNG.exec(name);
  const nummer = treffer === null ? null : Number(treffer[1]);
  return nummer !== null && nummer <= anzahl ? nummer : null;
}
