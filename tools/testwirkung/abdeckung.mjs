import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { aufrufstellen } from "./aufrufe.mjs";

const DATEIADRESSE = "file:";

function bereicheJeDatei(ordner, verzeichnis) {
  const jeDatei = new Map();
  for (const name of readdirSync(ordner)) {
    const { result } = JSON.parse(readFileSync(join(ordner, name), "utf8"));
    for (const { url, functions } of result.filter((eintrag) => eintrag.url.startsWith(DATEIADRESSE))) {
      const datei = relative(verzeichnis, fileURLToPath(url));
      jeDatei.set(datei, [...(jeDatei.get(datei) ?? []), functions.flatMap(({ ranges }) => ranges)]);
    }
  }
  return jeDatei;
}

function spanne({ startOffset, endOffset }) {
  return endOffset - startOffset;
}

function zaehlung(bereiche, versatz) {
  const umfassend = bereiche.filter(({ startOffset, endOffset }) => startOffset <= versatz && versatz < endOffset);
  const innerster = umfassend.reduce((enger, bereich) => (enger === undefined || spanne(bereich) <= spanne(enger) ? bereich : enger), undefined);
  return innerster?.count ?? 0;
}

function gelaufeneZeilen(datei, laeufe, verzeichnis) {
  const stellen = aufrufstellen(datei, readFileSync(join(verzeichnis, datei), "utf8"));
  const gelaufen = stellen.filter(({ versatz }) => laeufe.some((bereiche) => zaehlung(bereiche, versatz) > 0));
  return new Set(gelaufen.map(({ zeile }) => zeile));
}

export function gelaufeneAufrufzeilen(ordner, { verzeichnis, dateien }) {
  const jeDatei = bereicheJeDatei(ordner, verzeichnis);
  return new Map(dateien.map((datei) => [datei, gelaufeneZeilen(datei, jeDatei.get(datei) ?? [], verzeichnis)]));
}
