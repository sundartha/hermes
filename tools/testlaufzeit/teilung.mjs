import { existsSync, globSync } from "node:fs";

import { leseLaufzeiten } from "../mutationspruefung/laufzeiten.mjs";
import { nachGewicht } from "../mutationspruefung/teile.mjs";

export const MESSDATEI = "tools/testlaufzeit/laufzeiten.json";
const TESTDATEIEN = "test/**/*.test.{js,ts}";
const WERKZEUGORDNER = "test/werkzeuge/";

function vergleich(links, rechts) {
  return Number(links > rechts) - Number(links < rechts);
}

function ohneDauern(grund) {
  return { dauern: null, grund };
}

export function leseDauern(pfad = MESSDATEI) {
  if (!existsSync(pfad)) return ohneDauern(`Messdatei fehlt: ${pfad}`);
  const { dauern, grund } = leseLaufzeiten(pfad);
  return dauern === null ? ohneDauern(`${grund}: ${pfad}`) : { dauern, grund: null };
}

function reihum(dateien, anzahl) {
  return Array.from({ length: anzahl }, (_leer, teil) => dateien.filter((_datei, index) => index % anzahl === teil));
}

function ausgeglichen(dateien, anzahl, dauern) {
  const zuordnung = nachGewicht(dateien, anzahl, dauern);
  return Array.from({ length: anzahl }, (_leer, teil) => dateien.filter((datei) => zuordnung.get(datei) === teil));
}

export function schneide(dateien, anzahl, dauern) {
  const sortiert = [...new Set(dateien)].sort(vergleich);
  if (dauern === null || dauern === undefined) return { teile: reihum(sortiert, anzahl), rueckfall: "keine Messwerte" };
  if (!sortiert.some((datei) => Object.hasOwn(dauern, datei))) return { teile: reihum(sortiert, anzahl), rueckfall: "keine Messwerte für diese Testdateien" };
  return { teile: ausgeglichen(sortiert, anzahl, dauern), rueckfall: null };
}

export function dateienDesTeils({ dateien, teil, anzahl, messdatei = MESSDATEI }) {
  const { dauern, grund } = leseDauern(messdatei);
  const { teile, rueckfall } = schneide(dateien, anzahl, dauern);
  return { dateien: teile[teil - 1], rueckfall: rueckfall === null ? null : (grund ?? rueckfall) };
}

export function waehleTeil({ dateien, teil, anzahl, messdatei, meldung = console.error }) {
  const gewaehlt = dateienDesTeils({ dateien, teil, anzahl, messdatei });
  if (gewaehlt.rueckfall !== null) meldung(`Testteile: reihum statt nach Laufzeit (${gewaehlt.rueckfall})`);
  if (gewaehlt.dateien.length > 0) return gewaehlt.dateien;
  meldung(`Teil ${teil}/${anzahl} enthält keine Testdatei; ein leerer Teil liefe sonst die ganze Suite.`);
  return null;
}

export function gerundeteTabelle({ lauf, dauern }) {
  return { lauf, dauern: Object.fromEntries(Object.entries(dauern).map(([datei, ms]) => [datei, Math.round(ms)])) };
}

export function alleTestdateien({ ohneWerkzeugtests = false } = {}) {
  const dateien = globSync(TESTDATEIEN);
  return ohneWerkzeugtests ? dateien.filter((datei) => !datei.startsWith(WERKZEUGORDNER)) : dateien;
}
