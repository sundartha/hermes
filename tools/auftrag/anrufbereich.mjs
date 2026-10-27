import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { imBereich } from "./format.mjs";
import { MELDUNG, zweckBlock } from "./zweck.mjs";

export const VORBEREITUNG_BEREICH = fileURLToPath(new URL("vorbereitung-bereich.json", import.meta.url));

function anrufbereich() {
  return JSON.parse(readFileSync(VORBEREITUNG_BEREICH, "utf8"));
}

export function anrufbereichHinweis(hinweise) {
  if (hinweise.length === 0) return [];
  return [...hinweise.map((hinweis) => `Hinweis: ${hinweis}`), ...zweckBlock(MELDUNG.VORBEREITUNG)];
}

export function umbauImAnrufbereich(auftraege) {
  const liste = anrufbereich();
  return auftraege.filter(({ art }) => art === "umbau").flatMap(({ id, bereich }) => {
    const dateien = liste.filter((datei) => imBereich(bereich, datei));
    return dateien.length > 0 ? [`Umbau ${id} ändert Dateien des Anrufbereichs: ${dateien.join(", ")}.`] : [];
  });
}

export function dateiImAnrufbereich(datei) {
  return anrufbereichHinweis(anrufbereich().includes(datei) ? [`${datei} gehört zum Anrufbereich.`] : []);
}
