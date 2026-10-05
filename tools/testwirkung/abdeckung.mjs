import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { quellstruktur } from "./aufrufe.mjs";

const DATEIADRESSE = "file:";

function funktionenJeDatei(ordner, verzeichnis) {
  const jeDatei = new Map();
  for (const name of readdirSync(ordner)) {
    const { result } = JSON.parse(readFileSync(join(ordner, name), "utf8"));
    for (const { url, functions } of result.filter((eintrag) => eintrag.url.startsWith(DATEIADRESSE))) {
      const datei = relative(verzeichnis, fileURLToPath(url));
      jeDatei.set(datei, [...(jeDatei.get(datei) ?? []), functions.map(({ ranges }) => ranges)]);
    }
  }
  return jeDatei;
}

function spanne({ startOffset, endOffset }) {
  return endOffset - startOffset;
}

function enthaelt({ startOffset, endOffset }, versatz) {
  return startOffset <= versatz && versatz < endOffset;
}

function innerster(bereiche, versatz) {
  return bereiche
    .filter((bereich) => enthaelt(bereich, versatz))
    .reduce((enger, bereich) => (enger === undefined || spanne(bereich) <= spanne(enger) ? bereich : enger), undefined);
}

function nieErreicht(bereiche, anweisungsenden) {
  return bereiche
    .filter(({ count }) => count === 0)
    .flatMap((bereich) => anweisungsenden.filter(([ende]) => enthaelt(bereich, ende)))
    .map(([ende, [, blockende]]) => ({ startOffset: ende, endOffset: blockende }));
}

function gelaufen(funktionen, anweisungsenden) {
  const alle = funktionen.flat();
  const luecken = new Map(funktionen.map((bereiche) => [bereiche[0], nieErreicht(bereiche, anweisungsenden)]));
  return ({ versatz }) => {
    const funktion = innerster(funktionen.map(([gesamt]) => gesamt), versatz);
    const zaehlt = (innerster(alle, versatz)?.count ?? 0) > 0;
    return zaehlt && !(luecken.get(funktion) ?? []).some((luecke) => enthaelt(luecke, versatz));
  };
}

function gelaufeneZeilen(datei, laeufe, verzeichnis) {
  const { aufrufe, anweisungsenden } = quellstruktur(datei, readFileSync(join(verzeichnis, datei), "utf8"));
  const enden = [...anweisungsenden].flatMap(([ende, bloecke]) => bloecke.map((block) => [ende, block]));
  const pruefer = laeufe.map((funktionen) => gelaufen(funktionen, enden));
  return new Set(aufrufe.filter((stelle) => pruefer.some((pruefe) => pruefe(stelle))).map(({ zeile }) => zeile));
}

export function gelaufeneAufrufzeilen(ordner, { verzeichnis, dateien }) {
  const jeDatei = funktionenJeDatei(ordner, verzeichnis);
  return new Map(dateien.map((datei) => [datei, gelaufeneZeilen(datei, jeDatei.get(datei) ?? [], verzeichnis)]));
}
