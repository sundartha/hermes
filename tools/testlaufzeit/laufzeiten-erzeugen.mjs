import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { holeLaufzeiten } from "../mutationspruefung/laufzeiten.mjs";
import { entferneTempOrdner, neuerTempOrdner } from "../temp-ordner.mjs";
import { MESSDATEI } from "./teilung.mjs";

const EINRUECKUNG = 2;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

function geholt() {
  const ordner = neuerTempOrdner("testdauern-");
  try {
    const ziel = join(ordner, "laufzeiten.json");
    holeLaufzeiten(ziel);
    return JSON.parse(readFileSync(ziel, "utf8"));
  } finally {
    entferneTempOrdner(ordner);
  }
}

function main() {
  const { lauf, dauern, grund } = geholt();
  if (lauf === null) {
    console.error(`Keine Messwerte geholt (${grund}); ${MESSDATEI} bleibt unverändert.`);
    return EXIT_FEHLER;
  }
  const gerundet = Object.fromEntries(Object.entries(dauern).map(([datei, ms]) => [datei, Math.round(ms)]));
  writeFileSync(MESSDATEI, `${JSON.stringify({ lauf, dauern: gerundet }, null, EINRUECKUNG)}\n`);
  console.log(`${MESSDATEI}: ${Object.keys(gerundet).length} Testdateien aus Lauf ${lauf}`);
  return EXIT_OK;
}

process.exitCode = main();
