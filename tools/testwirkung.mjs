import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { zweckBlock } from "./auftrag/zweck.mjs";
import { TESTDATEI, maskiert, testaufrufe } from "./testwirkung/aufrufe.mjs";
import { vergleicheErreichtes } from "./testwirkung/erreicht.mjs";
import { geaenderteBestehendeTests, pruefeGeaenderte } from "./testwirkung/geaendert.mjs";
import { git, inBasis } from "./testwirkung/git.mjs";
import { katalogtests } from "./testwirkung/katalog.mjs";
import { UNTER_ATTRAPPE, laeufeAbbrechen, testlaufGleichzeitig } from "./testwirkung/testlauf.mjs";
import { nimmSperreAuchFuerKindprozesse } from "./schwerlauf/sperre.mjs";
import { pruefeWeitergabe } from "./testwirkung/weitergabe.mjs";
import { umbenennungen } from "./umbenennung.mjs";

const WIEDERHOLUNGEN = 5;
const LAUF_OHNE_PRUEFUNG = "A";
const WIEDERHOLUNGSLAUF = "B";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const AUFRUF = "Aufruf: node tools/testwirkung.mjs --basis <commit>";
const VERGLEICHBAR = /\.[cm]?[jt]s$/;
const WEB_PRAEFIX = /^apps\/web\//;
const TESTLAUF_ORDNER = ["test/"];
const ALLE_TEST_ORDNER = [...TESTLAUF_ORDNER, "apps/web/test/"];
const KEIN_LAUF = { ergebnisse: new Map(), uebersprungen: new Set() };

function geaenderteTestdateien(basis, ordner) {
  const liste = git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=d", basis, "--", ...ordner]);
  return liste.split("\0").filter((datei) => TESTDATEI.test(datei.replace(WEB_PRAEFIX, "")));
}

async function wieAufDerBasis(datei, umbenannt) {
  return umbenannt.nurTypen(datei) !== undefined || (await umbenannt.nurQuellenNachgezogen(datei));
}

async function ohneNurTypen(umbenannt, dateien) {
  const geaendert = [];
  for (const datei of dateien) {
    if (await wieAufDerBasis(datei, umbenannt)) {
      console.log(`Wie auf der Basis: ${datei} (nur Typen ergänzt oder nur Importendungen nachgezogen).`);
    } else geaendert.push(datei);
  }
  return geaendert;
}

function geaenderteSkripte(basis) {
  const liste = git(["diff", "--name-only", "-z", "--no-renames", "--diff-filter=M", basis, "--", "test/"]);
  return liste.split("\0").filter((datei) => VERGLEICHBAR.test(datei));
}

function aufrufeJetzt(datei) {
  return testaufrufe(datei, readFileSync(datei, "utf8"));
}

function aufrufeVorherNachher(basis, datei, altDatei = datei) {
  const vorher = inBasis(basis, altDatei);
  return { aufBasis: vorher !== undefined, alt: testaufrufe(datei, vorher ?? ""), neu: aufrufeJetzt(datei) };
}

function neuIn(basis, datei) {
  const { alt: vorher, neu: nachher } = aufrufeVorherNachher(basis, datei);
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

function neueTests(basis, geaendert) {
  const jeDatei = geaendert.map((datei) => neuIn(basis, datei));
  return {
    tests: jeDatei.flatMap(({ benannt }) => benannt),
    ohneNamen: jeDatei.flatMap(({ unbenannt }) => unbenannt),
  };
}

async function neueTestsSeit(basis, ordner) {
  const umbenannt = await umbenennungen({ von: basis });
  const geaendert = await ohneNurTypen(umbenannt, geaenderteTestdateien(basis, ordner));
  return { umbenannt, geaendert: new Set(geaendert), ...neueTests(basis, geaendert) };
}

export async function testsOhneFestenNamen(basis) {
  const { ohneNamen } = await neueTestsSeit(basis, ALLE_TEST_ORDNER);
  return neueTestsVerstoesse(ohneNamen, []).flatMap(([, liste]) => liste);
}

function alleTestsIn(dateien) {
  return dateien.flatMap((datei) =>
    aufrufeJetzt(datei)
      .filter(({ name }) => name !== undefined)
      .map(({ name, vorfahren }) => ({ datei, name, vorfahren })),
  );
}

function schluessel({ datei, name }) {
  return `${datei} › ${name}`;
}

function namensmuster(tests) {
  return [...new Set(tests.flatMap(({ name, vorfahren }) => [`^${maskiert(name)}$`, ...vorfahren]))];
}

async function lauf(name, tests, vorspann) {
  const dateien = [...new Set(tests.map(({ datei }) => datei))];
  const ergebnisse = new Map(tests.map((test) => [schluessel(test), []]));
  const uebersprungen = new Set();
  const gelaufene = await testlaufGleichzeitig({ name, dateien, muster: namensmuster(tests), vorspann, mitUebersprungenen: true });
  for (const gelaufen of gelaufene) {
    if (gelaufen.uebersprungen) uebersprungen.add(schluessel(gelaufen));
    else ergebnisse.get(schluessel(gelaufen))?.push(gelaufen.bestanden);
  }
  return { ergebnisse, uebersprungen };
}

function mitAltemPfad(katalog, umbenannt) {
  const altDatei = (datei) => umbenannt.nurTypen(datei) ?? datei;
  return { ...katalog, tests: katalog.tests.map((test) => ({ ...test, altDatei: altDatei(test.datei) })) };
}

function mitHilfsdatei(vergleich) {
  return vergleich.some((datei) => !TESTDATEI.test(datei));
}

function erreichbarkeit(basis, { geaenderteDateien, katalog, vergleich, umbenannt }) {
  const aufrufmuster = (aufrufe) => aufrufe.flatMap(({ muster }) => muster);
  const geaenderte = geaenderteDateien
    .map((datei) => ({ datei, ...aufrufeVorherNachher(basis, datei) }))
    .filter(({ aufBasis }) => aufBasis)
    .map(({ datei, alt, neu }) => ({ datei, alt: aufrufmuster(alt), neu: aufrufmuster(neu) }));
  const katalogtests = mitHilfsdatei(vergleich)
    ? katalog.map((test) => ({ datei: test.datei, altDatei: test.altDatei, alt: namensmuster([test]), neu: namensmuster([test]) }))
    : [];
  return vergleicheErreichtes(basis, { tests: [...geaenderte, ...katalogtests], vergleich, umbenannt });
}

function katalogeintraege(basis, katalog) {
  const jeDatei = new Map();
  const aufrufeIn = (datei, altDatei) => {
    if (!jeDatei.has(datei)) jeDatei.set(datei, aufrufeVorherNachher(basis, datei, altDatei));
    return jeDatei.get(datei);
  };
  return katalog.map(({ datei, altDatei, name }) => {
    const { alt, neu } = aufrufeIn(datei, altDatei);
    const benannt = (aufrufe) => aufrufe.filter((aufruf) => aufruf.name === name);
    return { datei, altDatei, kennung: `${datei} › ${name}`, alt: benannt(alt), neu: benannt(neu) };
  });
}

function weitergabe(basis, { bestehende, katalog, vergleich }) {
  const zusaetzlich = mitHilfsdatei(vergleich) ? katalogeintraege(basis, katalog).filter(({ alt }) => alt.length > 0) : [];
  const tests = new Map([...zusaetzlich, ...bestehende].map((test) => [test.kennung, test]));
  return pruefeWeitergabe(basis, [...tests.values()]);
}

function laufname(index) {
  return index === 0 ? LAUF_OHNE_PRUEFUNG : `${WIEDERHOLUNGSLAUF}${index}`;
}

function fehlendeLaeufe(laeufe, kennung, ueberspringenErlaubt) {
  const erlaubt = ({ uebersprungen }) => ueberspringenErlaubt && uebersprungen.has(kennung);
  return laeufe.flatMap((lauf, index) => (lauf.ergebnisse.get(kennung)?.length === 0 && !erlaubt(lauf) ? [laufname(index)] : []));
}

function befund(test, { ueberspringenErlaubt, ohnePruefung, wiederholungen }) {
  const kennung = schluessel(test);
  const [ersterLauf, ...weitere] = [ohnePruefung, ...wiederholungen].map(({ ergebnisse }) => ergebnisse.get(kennung));
  const rot = weitere.filter((ergebnisse) => ergebnisse.includes(false)).length;
  const gruen = weitere.filter((ergebnisse) => ergebnisse.length > 0 && !ergebnisse.includes(false)).length;
  return {
    kennung,
    fehlt: fehlendeLaeufe([ohnePruefung, ...wiederholungen], kennung, ueberspringenErlaubt),
    leer: ersterLauf?.includes(true) === true,
    wackelt: rot > 0 && gruen > 0,
    rot,
  };
}

function wiederholungslaeufe(wiederholt) {
  if (wiederholt.length === 0) return [];
  return Array.from({ length: WIEDERHOLUNGEN }, (_leer, index) => lauf(laufname(index + 1), wiederholt, []));
}

async function befunde(tests, wiederholt) {
  const alle = vereint(tests, wiederholt);
  if (alle.length === 0) return [];
  const [ohnePruefung, ...wiederholungen] = await Promise.all([
    tests.length === 0 ? KEIN_LAUF : lauf(laufname(0), tests, UNTER_ATTRAPPE),
    ...wiederholungslaeufe(wiederholt),
  ]);
  const zuWiederholen = new Set(wiederholt.map(schluessel));
  const imLaufA = new Set(tests.map(schluessel));
  return alle.map((test) =>
    befund(test, {
      ueberspringenErlaubt: !imLaufA.has(schluessel(test)),
      ohnePruefung,
      wiederholungen: zuWiederholen.has(schluessel(test)) ? wiederholungen : [],
    }),
  );
}

function vereint(...listen) {
  return [...new Map(listen.flat().map((test) => [schluessel(test), test])).values()];
}

function nurDie(ergebnisse, tests) {
  const gesucht = new Set(tests.map(schluessel));
  return ergebnisse.filter(({ kennung }) => gesucht.has(kennung));
}

const WIRKUNG_ZWECK = {
  KATALOG: "tests/wirkung-katalog",
  OHNE_WIRKUNG: "tests/wirkung-leer",
  WACKELN: "tests/wirkung-wackeln",
  GEAENDERT: "tests/wirkung-geaendert",
  ERREICHT: "tests/wirkung-erreicht",
};

function neueTestsVerstoesse(ohneNamen, ergebnisse) {
  const mit = (merkmal) => ergebnisse.filter(merkmal);
  const ohneName = ohneNamen.map((aufruf) => `Test ohne festen Namen: ${aufruf}`);
  const leer = mit(({ leer: ohneWirkung }) => ohneWirkung).map(({ kennung }) => `Test bleibt grün, obwohl jede Prüfung scheitert: ${kennung}`);
  const wackeln = mit(({ wackelt }) => wackelt).map(({ kennung, rot }) => `Test wackelt: ${kennung} (${rot} von ${WIEDERHOLUNGEN} Läufen rot)`);
  const fehlen = mit(({ fehlt }) => fehlt.length > 0).map(({ kennung, fehlt }) => `Test nicht gelaufen: ${kennung} (Lauf ${fehlt.join(", ")})`);
  return [
    [WIRKUNG_ZWECK.OHNE_WIRKUNG, [...ohneName, ...leer]],
    [WIRKUNG_ZWECK.WACKELN, wackeln],
    [WIRKUNG_ZWECK.OHNE_WIRKUNG, fehlen],
  ];
}

function zweckeDer(gruppen) {
  return [...new Set(gruppen.filter(([, liste]) => liste.length > 0).map(([id]) => id))];
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

function wiederholtZeile(ergebnisse, wiederholt) {
  const { wackeln, fehlen } = zaehlung(ergebnisse);
  return `Tests geänderter Testdateien: ${wiederholt.length} in ${WIEDERHOLUNGEN} Läufen wiederholt, ${wackeln} wackeln, ${fehlen} nicht gelaufen.`;
}

function einfuegungszeile({ geprueft, verstoesse: ohneWirkung, hinweise }) {
  return `Geänderte bestehende Tests: ${geprueft} geprüft, ${ohneWirkung.length} ohne Wirkung nach der Änderung, ${hinweise.length} schon auf der Basis ohne Wirkung.`;
}

function weitergabeZeile({ geprueft, verstoesse: abgefangen }) {
  return `Scheitern weitergegeben: ${geprueft} Tests geprüft, ${abgefangen.length} geben das Scheitern unveränderter Prüfungen nicht mehr weiter.`;
}

function erreichbarZeile({ verglichen, verstoesse: luecken }) {
  return `Erreichte Zeilen: ${verglichen} geänderte Dateien unter test/ verglichen, ${luecken.length} Tests oder Hilfsdateien erreichen Zeilen der Basis nicht mehr.`;
}

async function gemeinsam(pruefungen) {
  try {
    return await Promise.all(pruefungen);
  } catch (fehler) {
    throw laeufeAbbrechen(fehler);
  }
}

async function main() {
  const { values } = parseArgs({ options: { basis: { type: "string" } } });
  if (values.basis === undefined) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  await nimmSperreAuchFuerKindprozesse(`test:wirkung --basis ${values.basis}`);
  const { umbenannt, geaendert, tests, ohneNamen } = await neueTestsSeit(values.basis, TESTLAUF_ORDNER);
  const katalog = mitAltemPfad(katalogtests(values.basis), umbenannt);
  const beruehrt = katalog.tests.filter(({ datei }) => geaendert.has(datei));
  const inGeaenderten = alleTestsIn([...geaendert]);
  const bestehende = geaenderteBestehendeTests(values.basis, [...geaendert]);
  const auftrag = {
    bestehende,
    geaenderteDateien: [...geaendert],
    katalog: katalog.tests,
    vergleich: geaenderteSkripte(values.basis),
    umbenannt,
  };
  const [ergebnisse, eingefuegt, erreichbar, weitergegeben] = await gemeinsam([
    befunde(vereint(tests, katalog.tests), vereint(tests, beruehrt, inGeaenderten)),
    pruefeGeaenderte(values.basis, bestehende),
    erreichbarkeit(values.basis, auftrag),
    weitergabe(values.basis, auftrag),
  ]);
  const gruppen = [
    [WIRKUNG_ZWECK.KATALOG, katalog.verstoesse],
    ...neueTestsVerstoesse(ohneNamen, ergebnisse),
    [WIRKUNG_ZWECK.GEAENDERT, eingefuegt.verstoesse],
    [WIRKUNG_ZWECK.ERREICHT, erreichbar.verstoesse],
    [WIRKUNG_ZWECK.GEAENDERT, weitergegeben.verstoesse],
  ];
  const gefunden = gruppen.flatMap(([, liste]) => liste);
  for (const verstoss of gefunden) console.log(`Verstoß: ${verstoss}`);
  for (const hinweis of eingefuegt.hinweise) console.log(`Hinweis: ${hinweis}`);
  const urteil = gefunden.length === 0 ? "grün" : "rot";
  console.log(katalogzeile(nurDie(ergebnisse, katalog.tests), nurDie(ergebnisse, beruehrt)));
  console.log(wiederholtZeile(nurDie(ergebnisse, inGeaenderten), inGeaenderten));
  console.log(einfuegungszeile(eingefuegt));
  console.log(erreichbarZeile(erreichbar));
  console.log(weitergabeZeile(weitergegeben));
  console.log(zusammenfassung(urteil, nurDie(ergebnisse, tests)));
  for (const id of zweckeDer(gruppen)) console.log(zweckBlock(id).join("\n"));
  return urteil === "grün" ? EXIT_GRUEN : EXIT_ROT;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? ".")).href) {
  try {
    process.exitCode = await main();
  } catch (fehler) {
    console.error(`Abbruch: ${fehler.message}`);
    process.exitCode = EXIT_ABBRUCH;
  }
}
