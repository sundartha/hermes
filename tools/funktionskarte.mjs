import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { normalize } from "node:path";
import { parseArgs } from "node:util";

import { zweckBlock } from "./auftrag/zweck.mjs";
import { surfacesInCleanEnvironment } from "./flaechen.mjs";
import { budgetZuordnung, budgetsLesen, markierungen } from "./funktionskarte/antwortzeiten.mjs";
import { kartenLesen } from "./funktionskarte/karten.mjs";
import { kartenSpielen } from "./funktionskarte/lauf.mjs";
import { messen } from "./funktionskarte/messen.mjs";
import { zuordnungPruefen } from "./funktionskarte/zuordnung.mjs";

const EXIT_SAUBER = 0;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const EXIT_BLOCKIERT = 3;
const ZWECK = "uebrige/funktionskarte";
const ROT = "rot";
const STANDARD_WIEDERHOLUNGEN = "30";
const STANDARD_REIHEN = "3";
const AUFRUF = [
  "Aufruf: node tools/funktionskarte.mjs pruefen [--basis <commit>] [--flaechen-datei <json>]",
  "          [--karte <pfad>]... [--antwortzeiten <json>] [--verzoegern <webhook>=<ms>]...",
  "       node tools/funktionskarte.mjs messen [--wiederholungen 30] [--reihen 3] [--karte <pfad>]...",
].join("\n");

function flaechenLesen(datei) {
  if (datei === undefined) return surfacesInCleanEnvironment(".");
  return JSON.parse(readFileSync(datei, "utf8"));
}

function melden(ergebnis, befunde) {
  for (const befund of befunde) console.error(befund);
  console.log(`Funktionskarte: ${ergebnis}, ${befunde.length} Befunde.`);
  if (ergebnis === ROT) console.log(zweckBlock(ZWECK).join("\n"));
}

function kartenWaehlen(karten, gewaehlt = []) {
  if (gewaehlt.length === 0) return karten;
  const gewuenscht = gewaehlt.map((pfad) => normalize(pfad));
  const unbekannt = gewuenscht.filter((pfad) => !karten.some((karte) => karte.pfad === pfad));
  if (unbekannt.length > 0) throw new Error(`Keine solche Karte: ${unbekannt.join(", ")}`);
  return karten.filter((karte) => gewuenscht.includes(karte.pfad));
}

async function pruefen({
  basis,
  "flaechen-datei": flaechenDatei,
  karte,
  antwortzeiten,
  verzoegern,
}) {
  const flaechen = flaechenLesen(flaechenDatei);
  const alle = kartenLesen(".");
  const karten = kartenWaehlen(alle, karte);
  const { budgets, fehler: budgetFehler } = budgetsLesen(antwortzeiten);
  const zuordnung = [
    ...zuordnungPruefen({ wurzel: ".", karten: alle, flaechen, basis }),
    ...budgetFehler,
    ...(budgetFehler.length > 0
      ? []
      : budgetZuordnung({ alle: markierungen(alle), gespielt: markierungen(karten), budgets })),
  ];
  console.log(`Flächen: ${flaechen.length}, Karten: ${karten.length}.`);
  if (zuordnung.length > 0) {
    melden(ROT, zuordnung);
    return EXIT_ROT;
  }
  const ergebnisse = await kartenSpielen(karten, flaechen, { budgets, verzoegern });
  for (const { pfad, ms, befunde } of ergebnisse) {
    console.log(`${pfad}: ${befunde.length === 0 ? "sauber" : "rot"}, ${ms ?? "-"} ms`);
  }
  const blockiert = ergebnisse.flatMap((ergebnis) => ergebnis.blockiert);
  if (blockiert.length > 0) {
    melden("blockiert", blockiert);
    return EXIT_BLOCKIERT;
  }
  const befunde = ergebnisse.flatMap((ergebnis) => ergebnis.befunde);
  melden(befunde.length > 0 ? ROT : "sauber", befunde);
  return befunde.length > 0 ? EXIT_ROT : EXIT_SAUBER;
}

function anzahl(text, name) {
  const wert = Number(text);
  if (!Number.isInteger(wert) || wert < 1) throw new Error(`${name} braucht eine ganze Zahl ab 1.`);
  return wert;
}

async function messenBefehl({ karte, wiederholungen, reihen }) {
  const karten = kartenWaehlen(kartenLesen("."), karte);
  const ergebnis = await messen({
    karten,
    flaechen: flaechenLesen(undefined),
    wiederholungen: anzahl(wiederholungen, "--wiederholungen"),
    reihen: anzahl(reihen, "--reihen"),
    melden: console.log,
  });
  for (const [name, ms] of Object.entries(ergebnis.budgets)) {
    console.log(`Abgeleitetes Budget ${name}: ${ms} ms (höchstes p95 × 1,5, aufgerundet auf 10 ms)`);
  }
  console.log(JSON.stringify({ attrappen: ergebnis.budgets }));
  for (const text of ergebnis.verworfen) console.error(`Lauf verworfen: ${text}`);
  for (const name of ergebnis.fehlend) console.error(`Keine Messung für ${name}.`);
  return EXIT_SAUBER;
}

async function hauptprogramm() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      basis: { type: "string" },
      "flaechen-datei": { type: "string" },
      karte: { type: "string", multiple: true },
      antwortzeiten: { type: "string" },
      verzoegern: { type: "string", multiple: true },
      wiederholungen: { type: "string", default: STANDARD_WIEDERHOLUNGEN },
      reihen: { type: "string", default: STANDARD_REIHEN },
    },
  });
  if (positionals.length === 1 && positionals[0] === "pruefen") return pruefen(values);
  if (positionals.length === 1 && positionals[0] === "messen") return messenBefehl(values);
  console.error(AUFRUF);
  return EXIT_AUFRUF;
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
