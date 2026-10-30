import { existsSync, globSync, readFileSync } from "node:fs";

export const MESSDATEI = "tools/basis/testlaufzeiten.json";
const TESTDATEIEN = "test/**/*.test.{js,ts}";
const WERKZEUGORDNER = "test/werkzeuge/";

const HALB = 2;

function vergleich(links, rechts) {
  return Number(links > rechts) - Number(links < rechts);
}

function istTabelle(wert) {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function ohneDauern(grund) {
  return { dauern: null, grund };
}

function tabelleAus(pfad) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch {
    return null;
  }
}

export function leseDauern(pfad = MESSDATEI) {
  if (!existsSync(pfad)) return ohneDauern(`Messdatei fehlt: ${pfad}`);
  const tabelle = tabelleAus(pfad);
  if (!istTabelle(tabelle?.dauern)) return ohneDauern(`Messdatei unlesbar: ${pfad}`);
  const gueltig = Object.entries(tabelle.dauern).filter(([, ms]) => Number.isFinite(ms) && ms >= 0);
  if (gueltig.length === 0) return ohneDauern(`Messdatei ohne gültige Dauer: ${pfad}`);
  return { dauern: new Map(gueltig), grund: null };
}

function median(werte) {
  const sortiert = [...werte].sort((links, rechts) => links - rechts);
  const mitte = Math.floor(sortiert.length / HALB);
  return sortiert.length % HALB === 1 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / HALB;
}

function reihum(dateien, anzahl) {
  return Array.from({ length: anzahl }, (_leer, teil) => dateien.filter((_datei, index) => index % anzahl === teil));
}

function leichtester(teile) {
  return teile.reduce((bisher, teil) => (teil.last < bisher.last ? teil : bisher));
}

function ausgeglichen(dateien, anzahl, dauern) {
  const schaetzwert = median(dateien.filter((datei) => dauern.has(datei)).map((datei) => dauern.get(datei)));
  const gewicht = (datei) => dauern.get(datei) ?? schaetzwert;
  const teile = Array.from({ length: anzahl }, () => ({ dateien: [], last: 0 }));
  const grosseZuerst = [...dateien].sort((links, rechts) => gewicht(rechts) - gewicht(links) || vergleich(links, rechts));
  for (const datei of grosseZuerst) {
    const teil = leichtester(teile);
    teil.dateien.push(datei);
    teil.last += gewicht(datei);
  }
  return teile.map((teil) => teil.dateien.sort(vergleich));
}

export function schneide(dateien, anzahl, dauern) {
  const sortiert = [...new Set(dateien)].sort(vergleich);
  if (dauern === null || dauern === undefined) return { teile: reihum(sortiert, anzahl), rueckfall: "keine Messwerte" };
  if (!sortiert.some((datei) => dauern.has(datei))) return { teile: reihum(sortiert, anzahl), rueckfall: "keine Messwerte für diese Testdateien" };
  return { teile: ausgeglichen(sortiert, anzahl, dauern), rueckfall: null };
}

export function dateienDesTeils({ dateien, teil, anzahl, messdatei = MESSDATEI }) {
  const { dauern, grund } = leseDauern(messdatei);
  const { teile, rueckfall } = schneide(dateien, anzahl, dauern);
  return { dateien: teile[teil - 1], rueckfall: rueckfall === null ? null : (grund ?? rueckfall) };
}

export function rueckfallZeile(grund) {
  return `Testteile: reihum statt nach Laufzeit (${grund})`;
}

export function leererTeilZeile(teil, anzahl) {
  return `Teil ${teil}/${anzahl} enthält keine Testdatei; ein leerer Teil liefe sonst die ganze Suite.`;
}

export function alleTestdateien({ ohneWerkzeugtests = false } = {}) {
  const dateien = globSync(TESTDATEIEN);
  return ohneWerkzeugtests ? dateien.filter((datei) => !datei.startsWith(WERKZEUGORDNER)) : dateien;
}
