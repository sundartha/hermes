import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { TESTDATEI, testaufrufe } from "./testwirkung/aufrufe.mjs";
import { git, inBasis } from "./testwirkung/git.mjs";
import { testlauf } from "./testwirkung/testlauf.mjs";

const REGEX_ZEICHEN = /[.*+?^${}()|[\]\\]/g;
const WIEDERHOLUNGEN = 5;
const OHNE_PRUEFUNG = fileURLToPath(new URL("testwirkung/ohne-pruefung.mjs", import.meta.url));
const LAUF_OHNE_PRUEFUNG = "A";
const WIEDERHOLUNGSLAUF = "B";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const AUFRUF = "Aufruf: node tools/testwirkung.mjs --basis <commit>";

function geaenderteTestdateien(basis) {
  const liste = git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=d", basis, "--", "test/"]);
  return liste.split("\0").filter((datei) => TESTDATEI.test(datei));
}

function neuIn(basis, datei) {
  const vorher = testaufrufe(datei, inBasis(basis, datei) ?? "");
  const nachher = testaufrufe(datei, readFileSync(datei, "utf8"));
  const alteNamen = new Set(vorher.map(({ name }) => name));
  const alteTexte = new Set(vorher.map(({ text }) => text));
  const benannt = new Map();
  const unbenannt = new Set();
  for (const { name, text, vorfahren } of nachher) {
    if (name === undefined && !alteTexte.has(text)) unbenannt.add(`${datei} › ${text}`);
    if (name !== undefined && !alteNamen.has(name)) benannt.set(name, { datei, name, vorfahren });
  }
  return { benannt: [...benannt.values()], unbenannt: [...unbenannt] };
}

function neueTests(basis) {
  const jeDatei = geaenderteTestdateien(basis).map((datei) => neuIn(basis, datei));
  return {
    tests: jeDatei.flatMap(({ benannt }) => benannt),
    ohneNamen: jeDatei.flatMap(({ unbenannt }) => unbenannt),
  };
}

function schluessel({ datei, name }) {
  return `${datei} › ${name}`;
}

function namensmuster(tests) {
  const namen = new Set(tests.flatMap(({ name, vorfahren }) => [name, ...vorfahren]));
  return [...namen].map((name) => `^${name.replace(REGEX_ZEICHEN, "\\$&")}$`);
}

function lauf(tests, vorspann) {
  const dateien = [...new Set(tests.map(({ datei }) => datei))];
  const jeTest = new Map(tests.map((test) => [schluessel(test), []]));
  for (const gelaufen of testlauf({ dateien, muster: namensmuster(tests), vorspann })) {
    jeTest.get(schluessel(gelaufen))?.push(gelaufen.bestanden);
  }
  return jeTest;
}

function laufname(index) {
  return index === 0 ? LAUF_OHNE_PRUEFUNG : `${WIEDERHOLUNGSLAUF}${index}`;
}

function befund(test, { ohnePruefung, wiederholungen }) {
  const kennung = schluessel(test);
  const laeufe = [ohnePruefung, ...wiederholungen].map((ergebnisse) => ergebnisse.get(kennung));
  const [ersterLauf, ...weitere] = laeufe;
  const rot = weitere.filter((ergebnisse) => ergebnisse.includes(false)).length;
  const gruen = weitere.filter((ergebnisse) => ergebnisse.length > 0 && !ergebnisse.includes(false)).length;
  return {
    kennung,
    fehlt: laeufe.flatMap((ergebnisse, index) => (ergebnisse.length === 0 ? [laufname(index)] : [])),
    leer: ersterLauf.includes(true),
    wackelt: rot > 0 && gruen > 0,
    rot,
  };
}

function befunde(tests) {
  if (tests.length === 0) return [];
  const ohnePruefung = lauf(tests, ["--import", OHNE_PRUEFUNG]);
  const wiederholungen = Array.from({ length: WIEDERHOLUNGEN }, () => lauf(tests, []));
  return tests.map((test) => befund(test, { ohnePruefung, wiederholungen }));
}

function verstoesse(ohneNamen, ergebnisse) {
  const mit = (merkmal) => ergebnisse.filter(merkmal);
  return [
    ...ohneNamen.map((aufruf) => `Test ohne festen Namen: ${aufruf}`),
    ...mit(({ leer }) => leer).map(({ kennung }) => `Test bleibt grün, obwohl jede Prüfung scheitert: ${kennung}`),
    ...mit(({ wackelt }) => wackelt).map(({ kennung, rot }) => `Test wackelt: ${kennung} (${rot} von ${WIEDERHOLUNGEN} Läufen rot)`),
    ...mit(({ fehlt }) => fehlt.length > 0).map(({ kennung, fehlt }) => `Test nicht gelaufen: ${kennung} (Lauf ${fehlt.join(", ")})`),
  ];
}

function zusammenfassung(urteil, ergebnisse) {
  const zahl = (merkmal) => ergebnisse.filter(merkmal).length;
  const leer = zahl(({ leer: ohneWirkung }) => ohneWirkung);
  const wackeln = zahl(({ wackelt }) => wackelt);
  const fehlen = zahl(({ fehlt }) => fehlt.length > 0);
  return `${urteil}: ${ergebnisse.length} neue Tests, ${leer} ohne wirksame Prüfung, ${wackeln} wackeln in ${WIEDERHOLUNGEN} Läufen, ${fehlen} nicht gelaufen.`;
}

function main() {
  const { values } = parseArgs({ options: { basis: { type: "string" } } });
  if (values.basis === undefined) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  const { tests, ohneNamen } = neueTests(values.basis);
  const ergebnisse = befunde(tests);
  const gefunden = verstoesse(ohneNamen, ergebnisse);
  for (const verstoss of gefunden) console.log(`Verstoß: ${verstoss}`);
  const urteil = gefunden.length === 0 ? "grün" : "rot";
  console.log(zusammenfassung(urteil, ergebnisse));
  return urteil === "grün" ? EXIT_GRUEN : EXIT_ROT;
}

try {
  process.exitCode = main();
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
}
