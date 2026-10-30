import { parseArgs } from "node:util";

import { alleTestdateien, MESSDATEI, waehleTeil } from "./teilung.mjs";

const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const EXIT_AUFRUF = 2;
const AUFRUF = "Aufruf: node tools/testlaufzeit/teil-dateien.mjs --teil <k> --teile <n> [--ohne-werkzeugtests] [--messdatei <json>]";

function optionen() {
  return parseArgs({
    options: {
      teil: { type: "string" },
      teile: { type: "string" },
      "ohne-werkzeugtests": { type: "boolean", default: false },
      messdatei: { type: "string", default: MESSDATEI },
    },
  }).values;
}

function ganzeZahl(text) {
  return /^[1-9]\d*$/.test(text ?? "") ? Number(text) : null;
}

function main() {
  const werte = optionen();
  const teil = ganzeZahl(werte.teil);
  const anzahl = ganzeZahl(werte.teile);
  if (teil === null || anzahl === null || teil > anzahl) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  const dateien = alleTestdateien({ ohneWerkzeugtests: werte["ohne-werkzeugtests"] });
  const gewaehlt = waehleTeil({ dateien, teil, anzahl, messdatei: werte.messdatei });
  if (gewaehlt === null) return EXIT_FEHLER;
  console.log(gewaehlt.join("\n"));
  return EXIT_OK;
}

process.exitCode = main();
