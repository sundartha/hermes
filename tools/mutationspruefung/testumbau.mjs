import { readFileSync } from "node:fs";
import { cwd } from "node:process";

import { cruise } from "dependency-cruiser";

import { betroffeneTests, beruehrteTestdateienSamtHilfen } from "../auftrag/testumbau.mjs";

import { mitVorherSpeicher } from "./vorher-speicher.mjs";

const QUELLDATEI = /^src\/.+\.[cm]?[jt]s$/;
const TESTSEITE = /^test\//;
const CRUISE_OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

async function importe() {
  const { output } = await cruise(["src", "test"], CRUISE_OPTIONEN);
  return new Map(output.modules.map(({ source, dependencies }) => [source, dependencies.map(({ resolved }) => resolved)]));
}

export function direkteQuellen(tests, graph) {
  const besucht = new Set(tests);
  const quellen = new Set();
  for (const datei of besucht) {
    for (const ziel of graph.get(datei) ?? []) {
      if (QUELLDATEI.test(ziel)) quellen.add(ziel);
      else if (TESTSEITE.test(ziel)) besucht.add(ziel);
    }
  }
  return [...quellen].sort();
}

export function ganzeDatei(datei) {
  return [[1, readFileSync(datei, "utf8").split("\n").length]];
}

export async function imVorherStand({ basis, tests: geaendert }, werkzeug, arbeit) {
  const zurueck = werkzeug.alterStand(basis);
  try {
    const tests = await betroffeneTests(geaendert, cwd());
    return await arbeit({ tests, quellen: direkteQuellen(tests, await importe()) });
  } finally {
    zurueck();
  }
}

export async function getoetetIn({ datei, zeilen }, tests, werkzeug) {
  const ergebnisse = await werkzeug.durchgang(datei, zeilen, tests);
  const getoetet = ergebnisse.filter((eintrag) => !werkzeug.ueberlebt(eintrag)).map((eintrag) => ({ ...eintrag, datei }));
  return { anzahl: ergebnisse.length, getoetet };
}

export function vorherGetoetet(basis, geaendert, werkzeug) {
  return imVorherStand({ basis, tests: geaendert }, werkzeug, async ({ tests, quellen }) => {
    const getoetet = [];
    for (const datei of quellen) getoetet.push(...(await getoetetIn({ datei, zeilen: ganzeDatei(datei) }, tests, werkzeug)).getoetet);
    return { tests, quellen, getoetet };
  });
}

function brichAbOhneLage(getoetet) {
  const fehlend = getoetet.filter(({ lage }) => lage === undefined);
  if (fehlend.length === 0) return;
  throw new Error(
    `die Vorher-Seite nennt für ${fehlend.length} getötete Mutanten keine Lage (älteres Werkzeug, z. B. ${fehlend[0].schluessel}); die Vorher-Seite ist neu zu rechnen`,
  );
}

async function nachherVerloren(getoetet, tests, werkzeug) {
  brichAbOhneLage(getoetet);
  const verloren = [];
  for (const datei of [...new Set(getoetet.map((eintrag) => eintrag.datei))]) {
    const vorher = getoetet.filter((eintrag) => eintrag.datei === datei);
    const nachher = tests.length === 0 ? [] : await werkzeug.durchgang(datei, vorher.map(({ lage }) => lage), tests);
    const weiter = new Set(nachher.filter((eintrag) => !werkzeug.ueberlebt(eintrag)).map(({ schluessel }) => schluessel));
    verloren.push(...vorher.filter(({ schluessel }) => !weiter.has(schluessel)));
  }
  return verloren;
}

export async function testumbauPruefung(basis, werkzeug) {
  const geaendert = beruehrteTestdateienSamtHilfen(basis, cwd());
  const vorher = await mitVorherSpeicher({ basis, geaendert, root: cwd() }, () => vorherGetoetet(basis, geaendert, werkzeug));
  if (vorher.quellen.length === 0) {
    console.log(`grün: die betroffenen Tests (${vorher.tests.length}) importieren keine Quelldatei unter src/; es gibt keinen Mutanten zu vergleichen.`);
    return EXIT_GRUEN;
  }
  const tests = await betroffeneTests(geaendert, cwd());
  const verloren = await nachherVerloren(vorher.getoetet, tests, werkzeug);
  for (const { schluessel } of verloren) console.log(`Verstoß: Mutant nicht mehr getötet: ${schluessel}`);
  const umfang = `${vorher.getoetet.length} vorher getötete Mutanten in ${vorher.quellen.length} Quelldateien (${vorher.quellen.join(", ")})`;
  if (verloren.length === 0) {
    console.log(`grün: ${umfang} werden nach dem Testumbau weiter getötet.`);
    return EXIT_GRUEN;
  }
  console.log(`rot: ${verloren.length} von ${umfang} überleben nach dem Testumbau; die umgebauten Tests prüfen weniger als vorher.`);
  return EXIT_ROT;
}
