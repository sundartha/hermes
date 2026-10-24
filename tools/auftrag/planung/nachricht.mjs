import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const EXIT_GRUEN = 0;
export const EXIT_ABBRUCH = 1;
export const EXIT_AUFRUF = 2;
export const EXIT_PASST_NICHT = 3;
export const EXIT_BEFUNDE = 4;
export const EXIT_DECKEL = 5;
export const EXIT_ALTFUNKTIONEN = 6;
export const PLANER_KONTEXT = ["CLAUDE.md", ".github/CODEOWNERS", "tools/bereiche.json"];
const JSON_EINRUECKUNG = 2;

export function json(wert) {
  return `\`\`\`json\n${JSON.stringify(wert, null, JSON_EINRUECKUNG)}\n\`\`\``;
}

export function abschnitt(titel, inhalt) {
  return `### ${titel}\n\n${String(inhalt).trimEnd()}\n`;
}

export function nachricht(ueberschrift, teile) {
  return [`## ${ueberschrift}`, "", ...teile].join("\n");
}

export function dateiText(root, pfad) {
  const datei = join(root, pfad);
  return existsSync(datei) ? readFileSync(datei, "utf8") : `${pfad} gibt es nicht.`;
}

export function nummernText(soll, nummern) {
  return nummern.map((nummer) => `#### ${nummer} (${soll.get(nummer)?.quelle})\n\n${soll.get(nummer)?.text}\n`).join("\n");
}
