import { createHash } from "node:crypto";

import { GRUPPE } from "./gruppen.mjs";

export const MATRIX_HOECHSTENS = 256;
export const TESTDATEIEN_JE_ANTEIL = GRUPPE;

export function anteile(testdateien) {
  return Math.max(1, Math.ceil(testdateien / TESTDATEIEN_JE_ANTEIL));
}

export function einheitName({ pruefung, datei, anteil, von }) {
  return `${pruefung === 0 ? "" : `Umbau ${pruefung}: `}${datei} (Testdateien ${anteil} von ${von})`;
}

export function aufteilen(einheiten) {
  const anzahl = Math.min(einheiten.length, MATRIX_HOECHSTENS);
  const teile = Array.from({ length: anzahl }, () => []);
  einheiten.forEach((einheit, index) => teile[index % anzahl].push(einheit));
  return teile;
}

export function pruefsumme(teile, kopf) {
  return createHash("sha256").update(JSON.stringify({ kopf, teile })).digest("hex");
}

export function anteilig({ erste, alle }, { anteil, von }) {
  const eigene = alle.filter((_test, index) => index % von === anteil - 1);
  return { erste: erste.filter((test) => eigene.includes(test)), alle: eigene };
}

export function matrix(teile) {
  return teile.length === 0 ? [0] : teile.map((_teil, index) => index + 1);
}
