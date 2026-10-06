import { basename } from "node:path";

import { BASIS, JSCPD } from "./sorten.mjs";

const MAX_BETREFF = 72;
const DATUM_LAENGE = 10;

const BETREFF = new Map([
  [BASIS, (datei) => `Kürze die Basislinie ${datei}`],
  [JSCPD, (datei) => `Fasse Kopien in ${datei} zusammen`],
  ["knip", (datei) => `Entferne toten Code aus ${datei}`],
]);

const WARUM = new Map([
  [
    BASIS,
    (datei, anzahl) =>
      `${anzahl} Einträge der Basislinie ${datei} sind auf master behoben. Die Liste wird nur kürzer, damit diese Befunde nicht still zurückkommen.`,
  ],
  [
    JSCPD,
    (datei, anzahl) =>
      `jscpd meldet ${anzahl} Kopien innerhalb von ${datei}. Doppelter Code muss an mehreren Stellen gleich gepflegt werden; das Verhalten bleibt gleich.`,
  ],
  [
    "knip",
    (datei, anzahl) =>
      `knip meldet ${anzahl} Befunde toten Codes in ${datei}. Toter Code erschwert Lesen und Prüfen; das Verhalten bleibt gleich.`,
  ],
]);

export function betreff(sorte, datei) {
  return BETREFF.get(sorte)(basename(datei)).slice(0, MAX_BETREFF);
}

export function commitNachricht(ziel, zeitpunkt) {
  const datum = zeitpunkt.toISOString().slice(0, DATUM_LAENGE);
  return [
    betreff(ziel.sorte, ziel.datei),
    "",
    `Warum: ${WARUM.get(ziel.sorte)(ziel.datei, ziel.zielbefunde.length)}`,
    "",
    `Auftrag: aufraeumen/${datum}-${ziel.sorte}`,
    "Art: aufraeumen",
    `Sorte: ${ziel.sorte}`,
    "",
  ].join("\n");
}
