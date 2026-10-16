import { ABSICHT, absichtBefunde } from "../format.mjs";

const ZEILENUMBRUCH = /\r?\n/;
const ABSICHT_KOPF = /^##\s+Absicht\s*$/;
const ABSCHNITT = /^##\s/;

export function absichtAusPitch(text) {
  const zeilen = text.split(ZEILENUMBRUCH);
  const start = zeilen.findIndex((zeile) => ABSICHT_KOPF.test(zeile));
  if (start === -1) return undefined;
  const rest = zeilen.slice(start + 1);
  const ende = rest.findIndex((zeile) => ABSCHNITT.test(zeile));
  return (ende === -1 ? rest : rest.slice(0, ende)).join("\n").trim();
}

export function pitchAbsichtBefunde(text) {
  const absicht = absichtAusPitch(text);
  if (absicht === undefined) return [`pitch.md hat keinen Abschnitt „## ${ABSICHT}“`];
  return absichtBefunde(absicht).map((befund) => `pitch.md: ${befund}`);
}

export function phasenAbsichtBefunde(pitch, phase) {
  if (!Object.hasOwn(phase, "absicht")) return [];
  const befunde = pitchAbsichtBefunde(pitch);
  if (befunde.length > 0 || absichtAusPitch(pitch) === phase.absicht) return befunde;
  return ["phase.json: absicht weicht vom Abschnitt „## Absicht“ in pitch.md ab; sie wird wörtlich übernommen"];
}
