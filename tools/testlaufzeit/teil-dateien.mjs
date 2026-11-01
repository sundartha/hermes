import { parseArgs } from "node:util";

import { planToolTests } from "../werkzeugtests/auswahl.mjs";
import { alleTestdateien, MESSDATEI, waehleTeil } from "./teilung.mjs";

const EXIT_OK = 0;
const EXIT_FEHLER = 1;
const EXIT_AUFRUF = 2;
const AUFRUF = "Aufruf: node tools/testlaufzeit/teil-dateien.mjs --teil <k> --teile <n> [--ohne-werkzeugtests | --werkzeugtests-aus-liste --basis <ref>] [--messdatei <json>]";
const WERKZEUGORDNER = "test/werkzeuge/";

function optionen() {
  return parseArgs({
    options: {
      teil: { type: "string" },
      teile: { type: "string" },
      "ohne-werkzeugtests": { type: "boolean", default: false },
      "werkzeugtests-aus-liste": { type: "boolean", default: false },
      basis: { type: "string" },
      messdatei: { type: "string", default: MESSDATEI },
    },
  }).values;
}

function ganzeZahl(text) {
  return /^[1-9]\d*$/.test(text ?? "") ? Number(text) : null;
}

function falscherAufruf(werte, teil, anzahl) {
  const mitListe = werte["werkzeugtests-aus-liste"];
  const listeOhneBasis = mitListe && (werte.basis ?? "") === "";
  return teil === null || anzahl === null || teil > anzahl || listeOhneBasis || (mitListe && werte["ohne-werkzeugtests"]);
}

async function mitWerkzeugtestsAusDerListe(dateien, basis) {
  const plan = await planToolTests(basis);
  if (plan.art !== "liste") return dateien;
  const ausgewaehlt = new Set(plan.dateien);
  console.error(`Werkzeugtests: nur die ${plan.dateien.length} Dateien der Liste, reiner Produkt-Stand gegenüber ${basis}.`);
  return dateien.filter((datei) => !datei.startsWith(WERKZEUGORDNER) || ausgewaehlt.has(datei));
}

async function main() {
  const werte = optionen();
  const teil = ganzeZahl(werte.teil);
  const anzahl = ganzeZahl(werte.teile);
  if (falscherAufruf(werte, teil, anzahl)) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  const alle = alleTestdateien({ ohneWerkzeugtests: werte["ohne-werkzeugtests"] });
  const dateien = werte["werkzeugtests-aus-liste"] ? await mitWerkzeugtestsAusDerListe(alle, werte.basis) : alle;
  const gewaehlt = waehleTeil({ dateien, teil, anzahl, messdatei: werte.messdatei });
  if (gewaehlt === null) return EXIT_FEHLER;
  console.log(gewaehlt.join("\n"));
  return EXIT_OK;
}

process.exitCode = await main();
