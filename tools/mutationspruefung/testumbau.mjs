import { readFileSync } from "node:fs";
import { cwd, env } from "node:process";

import { cruise } from "dependency-cruiser";

import { aenderungsReichweite } from "../auftrag/reichweite.mjs";
import { betroffeneTests, beruehrteTestdateienSamtHilfen } from "../auftrag/testumbau.mjs";
import { POSTGRES_VARIABLE } from "../auftrag/werkzeuge.mjs";

import { bestaetigungAbgestuerzt, nurHaenger } from "./bestaetigung.mjs";
import { gruppen } from "./gruppen.mjs";
import { auslagerungsZeile, reineAuslagerung, reineVerschiebung, verschiebungsZeile } from "./verschiebung.mjs";
import { mitVorherSpeicher } from "./vorher-speicher.mjs";
import { mutantenzahl } from "./vorplanung.mjs";
import { weitergeleitet } from "./weiterleitung.mjs";

const QUELLDATEI = /^src\/.+\.[cm]?[jt]s$/;
const TESTSEITE = /^test\//;
const CRUISE_OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const POSTGRES_AUFRUF = /(?<!function )\bechteDatenbank\(/;

async function importe() {
  const { output } = await cruise(["src", "test"], CRUISE_OPTIONEN);
  const abhaengigkeiten = new Map(output.modules.map(({ source, dependencies }) => [source, dependencies]));
  const graph = new Map([...abhaengigkeiten].map(([source, dependencies]) => [source, dependencies.map(({ resolved }) => resolved)]));
  return { graph, weiterleitung: (datei) => weitergeleitet(datei, abhaengigkeiten.get(datei) ?? []) };
}

export function direkteQuellen(tests, { graph, weiterleitung = () => [] }) {
  const besucht = new Set(tests);
  const quellen = new Set();
  for (const datei of besucht) {
    for (const ziel of graph.get(datei) ?? []) {
      if (QUELLDATEI.test(ziel)) quellen.add(ziel);
      else if (TESTSEITE.test(ziel)) besucht.add(ziel);
    }
  }
  for (const quelle of quellen) for (const ziel of weiterleitung(quelle)) quellen.add(ziel);
  return [...quellen].sort();
}

export function ganzeDatei(datei) {
  return [[1, readFileSync(datei, "utf8").split("\n").length]];
}

export async function imVorherStand({ basis, tests: geaendert, reichweite = aenderungsReichweite(basis, geaendert, cwd()) }, werkzeug, arbeit) {
  const zurueck = werkzeug.alterStand(basis);
  try {
    const tests = await betroffeneTests(geaendert, cwd(), reichweite);
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

async function freigeben(werkzeug, seite, { tests, quellen, mutanten }) {
  if (werkzeug.freigabe === undefined) return;
  const testgruppen = gruppen(tests).length;
  const umfang = { seite, quelldateien: quellen.length, testdateien: tests.length, testgruppen, aufrufe: quellen.length * testgruppen };
  await werkzeug.freigabe({ ...umfang, ...(await mutanten()) });
}

function mutantenGanzerDateien(quellen) {
  return mutantenzahl(quellen.map((datei) => ({ datei, bereiche: ganzeDatei(datei) })));
}

export function vorherGetoetet(basis, geaendert, werkzeug) {
  return imVorherStand({ basis, tests: geaendert }, werkzeug, async ({ tests, quellen }) => {
    await freigeben(werkzeug, "Vorher-Seite", { tests, quellen, mutanten: () => mutantenGanzerDateien(quellen) });
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

async function schluesselNachLage(eintraege, { tests, werkzeug }, auswahl) {
  const treffer = new Map();
  if (tests.length === 0) return treffer;
  for (const datei of new Set(eintraege.map((eintrag) => eintrag.datei))) {
    const dort = eintraege.filter((eintrag) => eintrag.datei === datei);
    for (const eintrag of await werkzeug.durchgang(datei, dort.map(({ lage }) => lage), tests)) {
      if (auswahl(eintrag)) treffer.set(eintrag.schluessel, eintrag);
    }
  }
  return treffer;
}

async function nachherVerloren(getoetet, tests, werkzeug) {
  brichAbOhneLage(getoetet);
  const weiter = await schluesselNachLage(getoetet, { tests, werkzeug }, (eintrag) => !werkzeug.ueberlebt(eintrag));
  const abgestuerzte = [...weiter.values()].filter(bestaetigungAbgestuerzt);
  return { verloren: getoetet.filter(({ schluessel }) => !weiter.has(schluessel)), abgestuerzte };
}

async function vorherNieGetoetet(verloren, vorherStand, werkzeug) {
  if (verloren.length === 0) return [];
  const ueberlebt = await imVorherStand(vorherStand, werkzeug, ({ tests }) => schluesselNachLage(verloren, { tests, werkzeug }, werkzeug.ueberlebt));
  return verloren.filter(({ schluessel }) => ueberlebt.has(schluessel));
}

export async function nachherSeite(getoetet, vorherStand, werkzeug) {
  const tests = await betroffeneTests(vorherStand.tests, cwd(), vorherStand.reichweite ?? aenderungsReichweite(vorherStand.basis, vorherStand.tests, cwd()));
  const { verloren, abgestuerzte } = await nachherVerloren(getoetet, tests, werkzeug);
  const haenger = verloren.filter(nurHaenger);
  const echteVerluste = verloren.length - haenger.length;
  const entfallenMoeglich = echteVerluste === 0 ? await vorherNieGetoetet(haenger, vorherStand, werkzeug) : [];
  return {
    getoetet: getoetet.length,
    verloren: verloren.map(({ schluessel }) => schluessel),
    echteVerluste,
    entfallenMoeglich: entfallenMoeglich.map(({ schluessel }) => schluessel),
    abgestuerzte: abgestuerzte.map(({ befund }) => befund),
  };
}

export function urteilsMengen(berichte) {
  const alle = (feld) => berichte.flatMap((bericht) => bericht[feld]);
  const entfallen = berichte.every(({ echteVerluste }) => echteVerluste === 0) ? alle("entfallenMoeglich") : [];
  return { entfallen, verloren: alle("verloren").filter((schluessel) => !entfallen.includes(schluessel)) };
}

function rotGruende(verloren, abgestuerzte, umfang) {
  return [
    ...(verloren.length > 0 ? [`${verloren.length} von ${umfang} überleben nach dem Testumbau; die umgebauten Tests prüfen weniger als vorher`] : []),
    ...(abgestuerzte.length > 0 ? [`bei ${abgestuerzte.length} von ${umfang} brach die Bestätigung ab (Absturz), Ursache im Testaufbau prüfen`] : []),
  ];
}

function gruenZeile(umfang, getoetet, entfallen) {
  if (entfallen === 0) return `grün: ${umfang} werden nach dem Testumbau weiter getötet.`;
  const weiter = getoetet - entfallen;
  return `grün: ${weiter} von ${umfang} werden nach dem Testumbau weiter getötet; ${entfallen} waren vorher nur Hänger und überleben in der Neuberechnung.`;
}

export function ohneQuelleZeile(tests) {
  return `grün: die betroffenen Tests (${tests}) importieren keine Quelldatei unter src/; es gibt keinen Mutanten zu vergleichen.`;
}

export function meldeUrteil({ quellen, getoetet, entfallen, verloren, abgestuerzte }) {
  for (const schluessel of entfallen) console.log(`Kein Verstoß (vorher nur Hänger, Neuberechnung: überlebt): ${schluessel}`);
  for (const schluessel of verloren) console.log(`Verstoß: Mutant nicht mehr getötet: ${schluessel}`);
  for (const befund of abgestuerzte) console.log(befund);
  const umfang = `${getoetet} vorher getötete Mutanten in ${quellen.length} Quelldateien (${quellen.join(", ")})`;
  if (verloren.length + abgestuerzte.length === 0) {
    console.log(gruenZeile(umfang, getoetet, entfallen.length));
    return EXIT_GRUEN;
  }
  console.log(`rot: ${rotGruende(verloren, abgestuerzte, umfang).join("; ")}.`);
  return EXIT_ROT;
}

export async function ohneMutanten(basis) {
  const verschiebung = await reineVerschiebung(basis, cwd());
  if (verschiebung !== null) return verschiebungsZeile(verschiebung);
  const auslagerung = await reineAuslagerung(basis, cwd());
  return auslagerung === null ? null : auslagerungsZeile(auslagerung);
}

async function postgresDateien(tests) {
  const { graph } = await importe();
  const besucht = new Set(tests);
  for (const datei of besucht) {
    for (const ziel of graph.get(datei) ?? []) if (TESTSEITE.test(ziel)) besucht.add(ziel);
  }
  return [...besucht].filter((datei) => POSTGRES_AUFRUF.test(readFileSync(datei, "utf8"))).sort();
}

export async function ohnePostgresPruefbar(basis, geaendert, werkzeug) {
  if (env[POSTGRES_VARIABLE]) return;
  const vorher = await imVorherStand({ basis, tests: geaendert }, werkzeug, ({ tests }) => postgresDateien(tests));
  const nachher = await betroffeneTests(geaendert, cwd(), aenderungsReichweite(basis, geaendert, cwd()));
  const dateien = [...new Set([...vorher, ...(await postgresDateien(nachher))])].sort();
  if (dateien.length === 0) return;
  throw new Error(`${dateien.join(", ")} brauchen Postgres und überspringen ohne ${POSTGRES_VARIABLE}; der Testumbau wäre dort nicht aussagekräftig, kein Urteil.`);
}

export async function testumbauPruefung(basis, werkzeug) {
  const ohne = await ohneMutanten(basis);
  if (ohne !== null) {
    console.log(ohne);
    return EXIT_GRUEN;
  }
  const geaendert = beruehrteTestdateienSamtHilfen(basis, cwd());
  const vorher = await mitVorherSpeicher({ basis, geaendert, root: cwd() }, () => vorherGetoetet(basis, geaendert, werkzeug));
  if (vorher.quellen.length === 0) {
    console.log(ohneQuelleZeile(vorher.tests.length));
    return EXIT_GRUEN;
  }
  const tests = await betroffeneTests(geaendert, cwd(), aenderungsReichweite(basis, geaendert, cwd()));
  const quellen = [...new Set(vorher.getoetet.map(({ datei }) => datei))];
  await freigeben(werkzeug, "Nachher-Seite", { tests, quellen, mutanten: () => ({ mutanten: vorher.getoetet.length, unzaehlbar: 0 }) });
  const seite = await nachherSeite(vorher.getoetet, { basis, tests: geaendert }, werkzeug);
  return meldeUrteil({
    quellen: vorher.quellen,
    getoetet: seite.getoetet,
    ...urteilsMengen([seite]),
    abgestuerzte: seite.abgestuerzte,
  });
}
