import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { surfacesInCleanEnvironment } from "./flaechen.mjs";
import { kartenLesen } from "./funktionskarte/karten.mjs";
import { kartenSpielen } from "./funktionskarte/lauf.mjs";
import { zuordnungPruefen } from "./funktionskarte/zuordnung.mjs";

const EXIT_SAUBER = 0;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const EXIT_BLOCKIERT = 3;
const AUFRUF =
  "Aufruf: node tools/funktionskarte.mjs pruefen [--basis <commit>] [--flaechen-datei <json>]";

function flaechenLesen(datei) {
  if (datei === undefined) return surfacesInCleanEnvironment(".");
  return JSON.parse(readFileSync(datei, "utf8"));
}

function melden(ergebnis, befunde) {
  for (const befund of befunde) console.error(befund);
  console.log(`Funktionskarte: ${ergebnis}, ${befunde.length} Befunde.`);
}

async function pruefen({ basis, "flaechen-datei": flaechenDatei }) {
  const flaechen = flaechenLesen(flaechenDatei);
  const karten = kartenLesen(".");
  const zuordnung = zuordnungPruefen({ wurzel: ".", karten, flaechen, basis });
  console.log(`Flächen: ${flaechen.length}, Karten: ${karten.length}.`);
  if (zuordnung.length > 0) {
    melden("rot", zuordnung);
    return EXIT_ROT;
  }
  const ergebnisse = await kartenSpielen(karten, flaechen);
  for (const { pfad, ms, befunde } of ergebnisse) {
    console.log(`${pfad}: ${befunde.length === 0 ? "sauber" : "rot"}, ${ms ?? "-"} ms`);
  }
  const blockiert = ergebnisse.flatMap((ergebnis) => ergebnis.blockiert);
  if (blockiert.length > 0) {
    melden("blockiert", blockiert);
    return EXIT_BLOCKIERT;
  }
  const befunde = ergebnisse.flatMap((ergebnis) => ergebnis.befunde);
  melden(befunde.length > 0 ? "rot" : "sauber", befunde);
  return befunde.length > 0 ? EXIT_ROT : EXIT_SAUBER;
}

async function hauptprogramm() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { basis: { type: "string" }, "flaechen-datei": { type: "string" } },
  });
  if (positionals.length !== 1 || positionals[0] !== "pruefen") {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  return pruefen(values);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  try {
    process.exitCode = await hauptprogramm();
  } catch (fehler) {
    console.error(`Abbruch: ${fehler.message}`);
    console.error(AUFRUF);
    process.exitCode = EXIT_AUFRUF;
  }
}
