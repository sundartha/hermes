import { ABSCHALTUNG_VERSTOSS } from "./gleichwertig.mjs";
import { saetze } from "./neuschnitt.mjs";

const KENNUNG = /^\[NIE([1-9]\d*)\] /;
const KENNUNG_ANFANG = /^\[nie/i;
export const SCHUTZFAELLE_MUSTER = KENNUNG.source;
export const ALTER_SCHUTZ = /^(\[NIE[1-9]\d*\]) (src\/\S+\.[cm]?[jt]s):([1-9]\d*)$/;
export const SCHUTZ_ANSPRUCH = /^Alter Schutz: (\[NIE[1-9]\d*\] src\/\S+\.[cm]?[jt]s:[1-9]\d*), weil \S.*$/gm;
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

const VERSTOSS = "Verstoß: ";
const ROT_ANFANG = "rot: ";
export const OHNE_WIRKUNG_MUSTER = `^${VERSTOSS}((?:${SCHUTZ_WIRKUNGSLOS}|${ALTER_SCHUTZ_NICHT_BELEGT} \\([^)]*\\)): .+)$`;
const SCHUTZ_ZEILE = new RegExp(OHNE_WIRKUNG_MUSTER);
const ZUSAMMENFASSUNG_MITTE = " Schutztests, ";
const SCHUTZ_ZUSAMMENFASSUNG = new RegExp(`^${ROT_ANFANG}\\d+${ZUSAMMENFASSUNG_MITTE}`);

export function schutzZusammenfassung(anzahl, verstoesse) {
  return `${verstoesse === 0 ? "grün: " : ROT_ANFANG}${anzahl}${ZUSAMMENFASSUNG_MITTE}${verstoesse} ohne nachgewiesene Wirkung.`;
}

export function nurSchutzRot(ausgabe) {
  const zeilen = ausgabe.split("\n");
  const verstoesse = zeilen.filter((zeile) => zeile.startsWith(VERSTOSS));
  const abgeschaltet = zeilen.some((zeile) => zeile.startsWith(ABSCHALTUNG_VERSTOSS));
  const andereRot = zeilen.some((zeile) => zeile.startsWith(ROT_ANFANG) && !SCHUTZ_ZUSAMMENFASSUNG.test(zeile));
  return verstoesse.length > 0 && verstoesse.every((zeile) => SCHUTZ_ZEILE.test(zeile)) && !abgeschaltet && !andereRot;
}
