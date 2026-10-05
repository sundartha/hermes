import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { TESTDATEI, maskiert, testaufrufe } from "./testwirkung/aufrufe.mjs";
import { vergleicheErreichtes } from "./testwirkung/erreicht.mjs";
import { geaenderteBestehendeTests, pruefeGeaenderte } from "./testwirkung/geaendert.mjs";
import { git, inBasis } from "./testwirkung/git.mjs";
import { katalogtests } from "./testwirkung/katalog.mjs";
import { UNTER_ATTRAPPE, testlauf } from "./testwirkung/testlauf.mjs";

const WIEDERHOLUNGEN = 5;
const LAUF_OHNE_PRUEFUNG = "A";
const WIEDERHOLUNGSLAUF = "B";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const AUFRUF = "Aufruf: node tools/testwirkung.mjs --basis <commit>";
const VERGLEICHBAR = /\.[cm]?js$/;

function geaenderteTestdateien(basis) {
  const liste = git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=d", basis, "--", "test/"]);
  return liste.split("\0").filter((datei) => TESTDATEI.test(datei));
}

function geaenderteSkripte(basis) {
  const liste = git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=M", basis, "--", "test/"]);
  return liste.split("\0").filter((datei) => VERGLEICHBAR.test(datei));
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
  return [...namen].map((name) => `^${maskiert(name)}$`);
}

function lauf(tests, vorspann) {
  const dateien = [...new Set(tests.map(({ datei }) => datei))];
  const jeTest = new Map(tests.map((test) => [schluessel(test), []]));
  for (const gelaufen of testlauf({ dateien, muster: namensmuster(tests), vorspann })) {
    jeTest.get(schluessel(gelaufen))?.push(gelaufen.bestanden);
  }
  return jeTest;
}

function erreichbarkeit(basis, { bestehende, katalog }) {
  const vergleich = geaenderteSkripte(basis);
  const mitHilfsdatei = vergleich.some((datei) => !TESTDATEI.test(datei));
  const aufrufmuster = (aufrufe) => aufrufe.flatMap(({ muster }) => muster);
  const geaenderte = bestehende.map(({ datei, alt, neu }) => ({ datei, alt: aufrufmuster(alt), neu: aufrufmuster(neu) }));
  const katalogtests = mitHilfsdatei ? katalog.map((test) => ({ datei: test.datei, alt: namensmuster([test]), neu: namensmuster([test]) })) : [];
  return vergleicheErreichtes(basis, { tests: [...geaenderte, ...katalogtests], vergleich });
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

function befunde(tests, wiederholt) {
  if (tests.length === 0) return [];
  const ohnePruefung = lauf(tests, UNTER_ATTRAPPE);
  const wiederholungen = wiederholt.length === 0 ? [] : Array.from({ length: WIEDERHOLUNGEN }, () => lauf(wiederholt, []));
  const zuWiederholen = new Set(wiederholt.map(schluessel));
  return tests.map((test) =>
    befund(test, { ohnePruefung, wiederholungen: zuWiederholen.has(schluessel(test)) ? wiederholungen : [] }),
  );
}

function vereint(...listen) {
  return [...new Map(listen.flat().map((test) => [schluessel(test), test])).values()];
}

function nurDie(ergebnisse, tests) {
  const gesucht = new Set(tests.map(schluessel));
  return ergebnisse.filter(({ kennung }) => gesucht.has(kennung));
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

function zaehlung(ergebnisse) {
  const zahl = (merkmal) => ergebnisse.filter(merkmal).length;
  return {
    leer: zahl(({ leer: ohneWirkung }) => ohneWirkung),
    wackeln: zahl(({ wackelt }) => wackelt),
    fehlen: zahl(({ fehlt }) => fehlt.length > 0),
  };
}

function zusammenfassung(urteil, ergebnisse) {
  const { leer, wackeln, fehlen } = zaehlung(ergebnisse);
  return `${urteil}: ${ergebnisse.length} neue Tests, ${leer} ohne wirksame Prüfung, ${wackeln} wackeln in ${WIEDERHOLUNGEN} Läufen, ${fehlen} nicht gelaufen.`;
}

function katalogzeile(ergebnisse, wiederholt) {
  const { leer, wackeln, fehlen } = zaehlung(ergebnisse);
  return `Katalogtests: ${ergebnisse.length} geprüft, ${leer} ohne wirksame Prüfung, ${wackeln} von ${wiederholt.length} geänderten wackeln in ${WIEDERHOLUNGEN} Läufen, ${fehlen} nicht gelaufen.`;
}

function einfuegungszeile({ geprueft, verstoesse: ohneWirkung, hinweise }) {
  return `Geänderte bestehende Tests: ${geprueft} geprüft, ${ohneWirkung.length} ohne Wirkung nach der Änderung, ${hinweise.length} schon auf der Basis ohne Wirkung.`;
}

function erreichbarZeile({ verglichen, verstoesse: luecken }) {
  return `Erreichte Zeilen: ${verglichen} geänderte Dateien unter test/ verglichen, ${luecken.length} Tests oder Hilfsdateien erreichen Zeilen der Basis nicht mehr.`;
}

function main() {
  const { values } = parseArgs({ options: { basis: { type: "string" } } });
  if (values.basis === undefined) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  const { tests, ohneNamen } = neueTests(values.basis);
  const katalog = katalogtests(values.basis);
  const geaendert = new Set(geaenderteTestdateien(values.basis));
  const beruehrt = katalog.tests.filter(({ datei }) => geaendert.has(datei));
  const ergebnisse = befunde(vereint(tests, katalog.tests), vereint(tests, beruehrt));
  const bestehende = geaenderteBestehendeTests(values.basis, [...geaendert]);
  const eingefuegt = pruefeGeaenderte(values.basis, bestehende);
  const erreichbar = erreichbarkeit(values.basis, { bestehende, katalog: katalog.tests });
  const gefunden = [...katalog.verstoesse, ...verstoesse(ohneNamen, ergebnisse), ...eingefuegt.verstoesse, ...erreichbar.verstoesse];
  for (const verstoss of gefunden) console.log(`Verstoß: ${verstoss}`);
  for (const hinweis of eingefuegt.hinweise) console.log(`Hinweis: ${hinweis}`);
  const urteil = gefunden.length === 0 ? "grün" : "rot";
  console.log(katalogzeile(nurDie(ergebnisse, katalog.tests), nurDie(ergebnisse, beruehrt)));
  console.log(einfuegungszeile(eingefuegt));
  console.log(erreichbarZeile(erreichbar));
  console.log(zusammenfassung(urteil, nurDie(ergebnisse, tests)));
  return urteil === "grün" ? EXIT_GRUEN : EXIT_ROT;
}

try {
  process.exitCode = main();
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
}
