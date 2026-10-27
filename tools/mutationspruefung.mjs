import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, join, normalize } from "node:path";
import { chdir, cwd, env } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Stryker } from "@stryker-mutator/core";
import { cruise } from "dependency-cruiser";

import { omitKeys } from "../src/utils/object.js";
import { patternFlagsFor } from "../test/testbaenke-run.mjs";
import { ABGESCHALTET, ABSCHALTUNG_VERSTOSS, angenommen, GLEICHWERTIG_ANGENOMMEN, gleichwertigGemeldet, MUTANT_UEBERLEBT, ohneTestdatei } from "./auftrag/gleichwertig.mjs";
import { zweckBlock } from "./auftrag/zweck.mjs";
import { nimmSperreAuchFuerKindprozesse, plaetze } from "./schwerlauf/sperre.mjs";
import { kindprozesseInEigenemTempOrdner } from "./temp-ordner.mjs";
import { bestaetige, bestaetigt, bestaetigungAbgestuerzt, bilanz } from "./mutationspruefung/bestaetigung.mjs";
import { GENAU, NICHT_GEFRAGT, spaltenbereich } from "./mutationspruefung/genau.mjs";
import { KINDABDECKUNG, kindabdeckungsBericht } from "./mutationspruefung/kindabdeckung.mjs";
import { mutantenOrt } from "./mutationspruefung/mutantenort.mjs";
import { ERSTLAUF_FEHLER, ERSTLAUF_ZEITGRENZE, geteiltBeiZeitgrenze, gruppen, zeitgrenzeGemeldet } from "./mutationspruefung/gruppen.mjs";
import { anteile, anteilig, aufteilen, einheitName, matrix, pruefsumme } from "./mutationspruefung/teile.mjs";
import { testumbauPruefung } from "./mutationspruefung/testumbau.mjs";
import { postgresDa, vorherAusCi } from "./mutationspruefung/vorher-aus-ci.mjs";
import { SCHLUESSEL_ANZEIGE, werkzeugStand } from "./mutationspruefung/vorher-speicher.mjs";
import { ERGEBNISDATEI, planZeilen, stueckAus, testsAus, vorherPlan, vorherStueck, vorherZusammen, zusammenZeilen } from "./mutationspruefung/vorher-verteilt.mjs";
import { vorlageEinstellen } from "./mutationspruefung/vorlage.mjs";
import { ZEITUEBERSCHREITUNG, zeitablaufZeile } from "./mutationspruefung/zeitablauf.mjs";
import { mitAktivemMutanten } from "./mutationspruefung/zustand.mjs";
import { beendeLog, beginneLog, dateiBeginnt, dateiEndet, ERSTER_LAUF, LOGORDNER, notiereLoeschprobe, notiereSperre, notiereTestauswahl, strykerLauf } from "./mutationspruefung/zeitlog.mjs";
import { logAuswertung } from "./mutationspruefung/zeitlog-auswertung.mjs";
import { loeschbareZeilen, loeschprobe } from "./mutationspruefung/zeilen-loeschen.mjs";
import { hatMutanten, mutantenzahl } from "./mutationspruefung/vorplanung.mjs";
import { anDerSperre, beimHalt, budgetLaeuft, starteBudget, vorschau } from "./mutationspruefung/rechenzeit.mjs";
import { SANDBOXORDNER, entferneArbeitsordner, legeArbeitsordnerAn, legeSandboxordnerAn } from "./tests-ausmisten/arbeitsordner.mjs";
import { inhalt, umbenennungen } from "./umbenennung.mjs";

const KONFIGURATIONSDATEI = fileURLToPath(new URL("../stryker.config.json", import.meta.url));
const GENAU_PLUGIN = fileURLToPath(new URL("./mutationspruefung/genau.mjs", import.meta.url));
const KINDABDECKUNG_PLUGIN = fileURLToPath(new URL("./mutationspruefung/kindabdeckung.mjs", import.meta.url));
const ZEITLOG_PLUGIN = fileURLToPath(new URL("./mutationspruefung/zeitlog.mjs", import.meta.url));
const KONFIGURATION = omitKeys(JSON.parse(readFileSync(KONFIGURATIONSDATEI, "utf8")), ["$schema"]);
const WURZEL = cwd();
const BANK = "regression";
const QUELLDATEI = /^src\/.+\.[cm]?[jt]s$/;
const TESTDATEI = /^test\/.+\.test\.[cm]?[jt]s$/;
const GRAPH_WURZELN = ["src", "test"];
const CRUISE_OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const PFADNENNUNG = /(?:[\w.-]+\/)+[\w-]+(?:\.[\w-]+)*\.[cm]?[jt]s\b/g;
const NENNENDE_DATEI = /^(?!src\/|tools\/).+\.[cm]?[jt]s$/;
const LITERALFOLGE = /(["'])[^"'\n]*\1(?:\s*,\s*(["'])[^"'\n]*\2)+/g;
const LITERAL = /(["'])([^"'\n]*)\1/g;
const CODEPFAD = /\.[cm]?[jt]s$/;
const STARTAUFRUF = /\b(?:spawn|spawnSync|fork|exec|execFile|execFileSync|execSync|import)\s*\(/g;
const KONSTANTE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?![=>])/g;
const BEZEICHNER = /[A-Za-z_$][\w$]*/g;
const VERANKERT = /\bREPO_ROOT\b|\bimport\.meta\.url\b/;
const ANFUEHRUNG = new Set(["'", '"', "`"]);
const OEFFNEND = new Set(["(", "[", "{"]);
const SCHLIESSEND = new Set([")", "]", "}"]);
const ANWEISUNGSENDE = ";";
const GANZER_TEXT = (text) => text;
const FREMDE_PAKETE = "node_modules";
const AUSSERHALB = "..";
const DIFF_ALS_TEXT = ["diff", "--text", "-U0", "--no-renames", "--no-color", "--no-ext-diff"];
const DIFF_KOPF = "diff --git ";
const GEAENDERTE_DATEIEN = ["diff", "--name-only", "-z", "--no-renames"];
const NUR_GELOESCHTE = "--diff-filter=D";
const CODEDATEIEN = ["*.js", "*.mjs", "*.cjs", "*.ts", "*.mts", "*.cts"];
const KEINE_BENUTZUNG = [":(exclude)*.md", ":(exclude)tools/basis/"];
const GREP_GEFUNDEN = 0;
const GREP_NICHT_GEFUNDEN = 1;
const VERZEICHNISEINSTIEG = "index";
const UNBENUTZT_GELOESCHT = "übersprungen: gelöscht, auf der Basis von keinem Modul importiert.";
const DATEIKOPF = { neu: /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/, alt: /^--- (?:a\/(.+)|\/dev\/null)$/ };
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const UEBERLEBT = "Survived";
const UEBERLEBEND = new Set([UEBERLEBT, "NoCoverage", ...ABGESCHALTET]);
const ABSCHALTUNG = /Stryker disable /;
const ABSCHALTKOMMENTAR = "Kommentar „Stryker disable“";
const ZUSTANDSBEREICH = [
  ".",
  ":(exclude)tools/mutationspruefung.mjs",
  ":(exclude)tools/mutationspruefung/",
  ":(exclude)test/werkzeuge/ausmisten/stryker-ersatz.mjs",
  ":(exclude)test/werkzeuge/ausmisten/totcode.mjs",
];
const STRYKER_ZUSTAND = [/__stryker|stryker_|stry(?:mutact|cov|ns)_|active_?mutant|mutant__/i, /STRYKER/];
const WEITERGABE_ERLAUBT = new Set(["test/helpers.js", "test/gemeinsam/gebaute-konfiguration.js"]);
const WEITERGABE_MODUL = "mutationspruefung/zustand.mjs";
const ZWECK_UEBERLEBT = "tests/mutation";
const ZWECK_ZUSTAND = "tests/stryker-zustand";
const ZUSTAND_VERSTOSS = "Verstoß: Zeile fragt Strykers Zustand ab, ein Test darf nicht erkennen, ob ein Mutant aktiv ist";
const ZEITFAKTOR_WIEDERHOLUNG = 3;
const BESTAETIGUNGSLAUF = " im Bestätigungslauf";
const BESTAETIGUNG = "Bestätigung";
const ABGELEHNT = "rejected";
const UMBAU_ZEILE = "^Art: umbau$";
const AUFTRAGSWEG = /^Auftrag: [^\s/]+\/\S+$/m;
const KURZ = 7;
const MS_JE_SEKUNDE = 1000;
const ZEITGRENZEN = {
  erste: KONFIGURATION.timeoutMS / MS_JE_SEKUNDE,
  wiederholung: (KONFIGURATION.timeoutMS * ZEITFAKTOR_WIEDERHOLUNG) / MS_JE_SEKUNDE,
};
const MAX_GIT_AUSGABE = 268_435_456;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const GANZ = { anteil: 1, von: 1 };
const TEILANGABEN = 3;
const BETRIEBSARTEN_HOECHSTENS = 1;
const ERSTLAUF_ROT = "One or more tests failed in the initial test run:";
const ERSTLAUF_ABBRUCH = "There were failed tests in the initial test run.";
const ROTE_TESTDATEI = /^\t([^\t].*)\n\t\t(.*)$/gm;
const ROTER_TEST = /(?:^|, )((?:.+? > )?(.+?)): \2(?=, |$)/g;
const ERSTLAUF_MITSCHRIFT = [];
const SPERRE = { anlass: undefined, genommen: undefined };
const VORHER_ARTEN = ["vorher-plan", "vorher-stueck", "vorher-zusammen"];
const VORHER_AUS_CI = "vorher-aus-ci";
const NUR_COMMIT = "^{commit}";
const NUR_VORHER = ["tests", "stueck-sekunden"];
const SEKUNDEN = /^[1-9]\d*$/;
const EINRUECKUNG = 2;
const AUFRUF = [
  "Aufruf: node tools/mutationspruefung.mjs --basis <commit> [--alter-stand | --testumbau] [--gleichwertig <mutant>] [--plan <datei> | --teil <n> --teile <anzahl> --ergebnis <datei> | --urteil <ordner>]",
  "   oder: node tools/mutationspruefung.mjs --basis <commit> --tests <a,b> (--vorher-plan <datei> [--stueck-sekunden <s>] | --vorher-stueck <json> --ergebnis <datei>)",
  "   oder: node tools/mutationspruefung.mjs --vorher-zusammen <ordner> --ergebnis <datei>",
  "   oder: node tools/mutationspruefung.mjs --basis <commit> --vorher-aus-ci <lauf>",
  "   oder: node tools/mutationspruefung.mjs --log-auswertung <datei>",
].join("\n");
const LOG_AUSWERTUNG = "log-auswertung";
const TESTUMBAU = "testumbau";
const BETRIEBSARTEN = [...VORHER_ARTEN, VORHER_AUS_CI, TESTUMBAU, "plan", "teil", "urteil", "alter-stand"];
const NORMAL = "normal";
const SEITENNAME = { neu: "Seite neu", alt: "alter Stand" };
const WIEDERHOLUNG = "Wiederholung mit längerer Zeitgrenze";

function git(args, verzeichnis = cwd()) {
  const lauf = spawnSync("git", args, { cwd: verzeichnis, encoding: "utf8", maxBuffer: MAX_GIT_AUSGABE });
  if (lauf.status !== 0) throw new Error(`git ${args.join(" ")}: ${lauf.stderr.trim()}`);
  return lauf.stdout;
}

function arbeitsverzeichnis(praefix) {
  return mkdtempSync(join(legeSandboxordnerAn(WURZEL), praefix));
}

function zeilenbereich(hunk, seite) {
  const [start, laenge] = seite === "neu" ? [hunk[3], hunk[4]] : [hunk[1], hunk[2]];
  const anzahl = laenge === undefined ? 1 : Number(laenge);
  return anzahl === 0 ? null : [Number(start), Number(start) + anzahl - 1];
}

function dateikopf(zeile, seite, zustand) {
  if (zeile.startsWith(DIFF_KOPF)) return { datei: null, imKopf: true };
  const kopf = zustand.imKopf ? DATEIKOPF[seite].exec(zeile) : null;
  return kopf ? { ...zustand, datei: kopf[1] ?? null } : zustand;
}

function geaenderteZeilen(diff, seite) {
  const zeilen = new Map();
  let zustand = { datei: null, imKopf: false };
  for (const zeile of diff.split("\n")) {
    zustand = dateikopf(zeile, seite, zustand);
    const hunk = HUNK.exec(zeile);
    if (!hunk) continue;
    zustand = { ...zustand, imKopf: false };
    const bereich = QUELLDATEI.test(zustand.datei ?? "") ? zeilenbereich(hunk, seite) : null;
    if (bereich) zeilen.set(zustand.datei, [...(zeilen.get(zustand.datei) ?? []), bereich]);
  }
  return zeilen;
}

function eigeneDatei(pfad) {
  return !pfad.startsWith(AUSSERHALB) && !pfad.split("/").includes(FREMDE_PAKETE) && existsSync(pfad) && statSync(pfad).isFile();
}

function segmentpfade(text) {
  return [...text.matchAll(LITERALFOLGE)].flatMap(([folge]) => {
    const teile = [...folge.matchAll(LITERAL)].map(([, , teil]) => teil);
    return teile.flatMap((_teil, von) => teile.map((_rest, bis) => teile.slice(von, bis + 1).join("/")).slice(von + 1));
  });
}

function ausdruck(text, von, bisAnweisungsende) {
  let tiefe = 0;
  for (let stelle = von; stelle < text.length; stelle += 1) {
    const zeichen = text[stelle];
    if (ANFUEHRUNG.has(zeichen)) {
      stelle = literalende(text, stelle);
    } else if (OEFFNEND.has(zeichen)) {
      tiefe += 1;
    } else if (SCHLIESSEND.has(zeichen)) {
      tiefe -= 1;
      if (tiefe < 0) return text.slice(von, stelle);
    } else if (bisAnweisungsende && tiefe === 0 && zeichen === ANWEISUNGSENDE) {
      return text.slice(von, stelle);
    }
  }
  return text.slice(von);
}

function literalende(text, anfang) {
  const zeichen = text[anfang];
  for (let stelle = anfang + 1; stelle < text.length; stelle += 1) {
    if (text[stelle] === "\\") stelle += 1;
    else if (text[stelle] === zeichen || (zeichen !== "`" && text[stelle] === "\n")) return stelle;
  }
  return text.length;
}

function gestartet(text) {
  const werte = new Map();
  for (const treffer of text.matchAll(KONSTANTE)) {
    werte.set(treffer[1], [...(werte.get(treffer[1]) ?? []), ausdruck(text, treffer.index + treffer[0].length, true)]);
  }
  const aufrufe = [...text.matchAll(STARTAUFRUF)].flatMap((treffer) => {
    const aufruf = ausdruck(text, treffer.index + treffer[0].length, false);
    return [aufruf, ...[...aufruf.matchAll(BEZEICHNER)].flatMap(([name]) => werte.get(name) ?? [])];
  });
  return [...aufrufe, ...text.split("\n").filter((zeile) => VERANKERT.test(zeile))].join("\n");
}

function genannteDateien(modul, auswahl) {
  const text = auswahl(readFileSync(modul, "utf8"));
  const nennungen = [...[...text.matchAll(PFADNENNUNG)].map(([pfad]) => pfad), ...segmentpfade(text).filter((pfad) => CODEPFAD.test(pfad))];
  const ziele = nennungen.flatMap((pfad) => [normalize(pfad), join(dirname(modul), pfad)]);
  return [...new Set(ziele)].filter((ziel) => ziel !== modul && eigeneDatei(ziel));
}

async function abhaengigkeiten(wurzeln, { nennend = NENNENDE_DATEI, auswahl = gestartet } = {}) {
  const { output } = await cruise(wurzeln, CRUISE_OPTIONEN);
  return new Map(
    output.modules.map(({ source, dependencies }) => [
      source,
      { importe: dependencies.map(({ resolved }) => resolved), genannt: nennend.test(source) && eigeneDatei(source) ? genannteDateien(source, auswahl) : [] },
    ]),
  );
}

function umkehren(nachQuelle, kanten) {
  const nachZiel = new Map();
  for (const [quelle, ziele] of nachQuelle) {
    for (const ziel of kanten(ziele)) nachZiel.set(ziel, [...(nachZiel.get(ziel) ?? []), quelle]);
  }
  return nachZiel;
}

async function importierer() {
  let wurzeln = GRAPH_WURZELN;
  let nachQuelle = await abhaengigkeiten(wurzeln);
  for (;;) {
    const genannt = [...nachQuelle.values()].flatMap((ziele) => ziele.genannt);
    const einstiege = [...new Set(genannt)].filter((ziel) => !nachQuelle.has(ziel) && !wurzeln.includes(ziel));
    if (einstiege.length === 0) break;
    wurzeln = [...wurzeln, ...einstiege];
    nachQuelle = await abhaengigkeiten(wurzeln);
  }
  return {
    importe: umkehren(nachQuelle, (ziele) => ziele.importe),
    gesamt: umkehren(nachQuelle, (ziele) => [...ziele.importe, ...ziele.genannt]),
  };
}

function erreichendeTests(datei, nachZiel) {
  const erreicht = new Set([datei]);
  for (const ziel of erreicht) {
    for (const quelle of nachZiel.get(ziel) ?? []) erreicht.add(quelle);
  }
  const tests = (dateien) => [...new Set(dateien)].filter((pfad) => TESTDATEI.test(pfad)).sort();
  return { direkt: tests(nachZiel.get(datei) ?? []), alle: tests(erreicht) };
}

function mutant({ location, mutatorName, status, killedBy, ...ergebnis }) {
  return { ...mutantenOrt({ ...ergebnis, location, mutatorName }), status, lage: location, art: mutatorName, toeter: killedBy ?? [] };
}

function muster(datei, bereich) {
  return Array.isArray(bereich) ? `${datei}:${bereich[0]}-${bereich[1]}` : spaltenbereich(datei, bereich);
}

function laufart(faktor, anlass) {
  if (anlass !== "") return anlass.trim();
  return faktor === 1 ? ERSTER_LAUF : WIEDERHOLUNG;
}

async function gemessenerStryker(optionen, zeitlog) {
  try {
    return await new Stryker({ ...optionen, ...zeitlog.optionen }).runMutationTest();
  } catch (fehler) {
    zeitlog.abgebrochen(fehler);
    throw fehler;
  }
}

async function stryker({ datei, zeilen, tests, faktor, concurrency, anlass = "" }) {
  const zeitlog = strykerLauf({ datei, anlass: laufart(faktor, anlass), testdateien: tests.length }, ueberlebt);
  console.log(await vorlageEinstellen(datei));
  legeSandboxordnerAn(cwd());
  const beginn = Date.now();
  const genau = zeilen.every((bereich) => !Array.isArray(bereich));
  const kindbericht = kindabdeckungsBericht();
  const optionen = {
    ...KONFIGURATION,
    ...kindbericht.option,
    testRunner: KINDABDECKUNG,
    appendPlugins: [KINDABDECKUNG_PLUGIN, ZEITLOG_PLUGIN, ...(genau ? [GENAU_PLUGIN] : [])],
    ...(genau ? { ignorers: [GENAU] } : {}),
    mutate: zeilen.map((bereich) => muster(datei, bereich)),
    tap: { ...KONFIGURATION.tap, testFiles: tests, nodeArgs: [...KONFIGURATION.tap.nodeArgs, ...patternFlagsFor(BANK)] },
    timeoutMS: KONFIGURATION.timeoutMS * faktor,
    configFile: KONFIGURATIONSDATEI,
    concurrency,
    tempDirName: SANDBOXORDNER,
  };
  const ergebnisse = (await gemessenerStryker(optionen, zeitlog)).filter(({ statusReason }) => statusReason !== NICHT_GEFRAGT).map(mutant);
  zeitlog.fertig(ergebnisse);
  const sekunden = Math.round((Date.now() - beginn) / MS_JE_SEKUNDE);
  console.log(`${datei}: ${ergebnisse.length} Mutanten${anlass} gegen ${tests.length} Testdateien in ${sekunden} s`);
  const uebersprungen = kindbericht.ohneTestdatei();
  if (uebersprungen > 0) console.log(`${datei}: Kind-Abdeckung ohne Testdatei dieses Probelaufs übersprungen: ${uebersprungen}`);
  return ergebnisse;
}

function ueberlebt({ status }) {
  return UEBERLEBEND.has(status);
}

function ersetze(ergebnisse, neu, betroffen) {
  const nachSchluessel = new Map(neu.map((eintrag) => [eintrag.schluessel, eintrag]));
  return ergebnisse.map((eintrag) => (betroffen.includes(eintrag) && nachSchluessel.get(eintrag.schluessel)) || eintrag);
}

async function ersterLauf(lauf) {
  const ergebnisse = await stryker({ ...lauf, faktor: 1 });
  const zeitueber = ergebnisse.filter(({ status }) => status === ZEITUEBERSCHREITUNG);
  if (zeitueber.length === 0) return ergebnisse;
  const wiederholt = await stryker({
    ...lauf,
    zeilen: zeitueber.map((eintrag) => eintrag.lage),
    faktor: ZEITFAKTOR_WIEDERHOLUNG,
  });
  return ersetze(ergebnisse, wiederholt, zeitueber);
}

async function gruppenlauf(lauf) {
  const nachlauf = ({ zeilen, tests }) =>
    stryker({ ...lauf, zeilen, tests, faktor: ZEITFAKTOR_WIEDERHOLUNG, anlass: BESTAETIGUNGSLAUF });
  return bestaetige(await ersterLauf(lauf), nachlauf, lauf.tests);
}

function staerker(eintrag, anderer) {
  if (anderer === undefined || bestaetigungAbgestuerzt(eintrag)) return eintrag;
  if (bestaetigungAbgestuerzt(anderer)) return anderer;
  if (!ueberlebt(eintrag)) return bestaetigt(eintrag) || ueberlebt(anderer) ? eintrag : anderer;
  return ueberlebt(anderer) && eintrag.status === UEBERLEBT ? eintrag : anderer;
}

function vereine(ergebnisse, laeufe) {
  const nachSchluessel = new Map();
  for (const eintrag of laeufe.flat()) {
    nachSchluessel.set(eintrag.schluessel, staerker(nachSchluessel.get(eintrag.schluessel) ?? eintrag, eintrag));
  }
  return ergebnisse.map((eintrag) => staerker(eintrag, nachSchluessel.get(eintrag.schluessel)));
}

function gleichzeitig() {
  return env.CI ? KONFIGURATION.concurrency : Math.max(KONFIGURATION.concurrency, Math.floor(availableParallelism() / plaetze()));
}

function wellen(testgruppen) {
  const breite = gleichzeitig();
  return Array.from({ length: Math.ceil(testgruppen.length / breite) }, (_leer, welle) =>
    testgruppen.slice(welle * breite, (welle + 1) * breite),
  );
}

function zeitgrenzeSeit(beginn) {
  return (fehler) => zeitgrenzeGemeldet(fehler, ERSTLAUF_MITSCHRIFT.slice(beginn));
}

async function geteilterGruppenlauf(lauf) {
  const ueberZeitgrenze = zeitgrenzeSeit(ERSTLAUF_MITSCHRIFT.length);
  const laufen = async (tests) => {
    try {
      return await gruppenlauf({ ...lauf, tests });
    } catch (fehler) {
      if (tests.length === 1 && ueberZeitgrenze(fehler)) console.error(`Abbruch: Erstlauf über der Zeitgrenze: ${tests[0]}`);
      throw fehler;
    }
  };
  const teile = await geteiltBeiZeitgrenze(lauf.tests, laufen, ueberZeitgrenze);
  if (teile.length > 1) console.log(`${lauf.datei}: Erstlauf über der Zeitgrenze, ${lauf.tests.length} Testdateien in ${teile.length} Teilen geprüft`);
  return vereine(teile[0], teile);
}

async function welle(datei, zeilen, testgruppen) {
  const concurrency = Math.max(1, Math.floor(gleichzeitig() / testgruppen.length));
  const laeufe = await Promise.allSettled(testgruppen.map((tests) => geteilterGruppenlauf({ datei, zeilen, tests, concurrency })));
  const fehlschlag = laeufe.find(({ status }) => status === ABGELEHNT);
  if (fehlschlag) throw fehlschlag.reason;
  return laeufe.map(({ value }) => value);
}

async function durchgang(datei, zeilen, tests) {
  let ergebnisse = null;
  for (const testgruppen of wellen(gruppen(tests))) {
    const offen = ergebnisse === null ? zeilen : ergebnisse.filter(ueberlebt).map((eintrag) => eintrag.lage);
    if (offen.length === 0) break;
    const laeufe = await welle(datei, offen, testgruppen);
    ergebnisse = vereine(ergebnisse ?? laeufe[0], laeufe);
  }
  console.log(zeitablaufZeile(datei, ergebnisse, ZEITGRENZEN));
  return ergebnisse;
}

async function mutantenproben(datei, zeilen, { erste, alle, nachsichtig }) {
  if (erste.every((test) => nachsichtig.includes(test))) return ohneRoteErstlaeufe(datei, zeilen, { tests: alle });
  const ergebnisse = await ohneRoteErstlaeufe(datei, zeilen, { tests: erste, nachsichtig });
  const offen = ergebnisse.filter(ueberlebt);
  const uebrige = alle.filter((test) => !erste.includes(test));
  if (offen.length === 0 || uebrige.length === 0) return ergebnisse;
  const zweite = await ohneRoteErstlaeufe(datei, offen.map((eintrag) => eintrag.lage), { tests: uebrige });
  return vereine(ergebnisse, [zweite]);
}

async function ohneRoteErstlaeufe(datei, zeilen, { tests, nachsichtig = tests }) {
  if (tests.length === 0) return [];
  const beginn = ERSTLAUF_MITSCHRIFT.length;
  try {
    return await durchgang(datei, zeilen, tests);
  } catch (fehler) {
    const rote = fehler.message === ERSTLAUF_ABBRUCH ? roteTests(ERSTLAUF_MITSCHRIFT.slice(beginn)) : [];
    if (rote.length === 0 || !rote.every((rot) => nachsichtig.includes(rot.datei))) throw fehler;
    ERSTLAUF_MITSCHRIFT.splice(beginn);
    for (const rot of rote) console.log(`Zweite Stufe ohne ${rot.datei} › ${rot.test}: im Erstlauf rot`);
    return ohneRoteErstlaeufe(datei, zeilen, { tests: tests.filter((test) => !rote.some((rot) => rot.datei === test)), nachsichtig });
  }
}

function testauswahl(datei, graph) {
  const importe = erreichendeTests(datei, graph.importe);
  const { direkt, alle } = erreichendeTests(datei, graph.gesamt);
  const erste = [importe.direkt, importe.alle, direkt].find((tests) => tests.length > 0) ?? alle;
  const nachsichtig = alle.filter((test) => !erste.includes(test) && graph.geaendert.has(test));
  return { erste: alle.filter((test) => erste.includes(test) || nachsichtig.includes(test)), alle, nachsichtig };
}

async function schwereArbeit(datei, zeilen, loeschung) {
  if (await hatMutanten(datei, zeilen)) return true;
  return loeschung !== null && loeschbareZeilen(datei, zeilen).length > 0;
}

async function pruefeDatei(datei, zeilen, { graph, loeschung, anteil }) {
  const auswahl = testauswahl(datei, graph);
  if (auswahl.alle.length === 0) {
    return zeilen.map(([von]) => ohneTestdatei(datei, von));
  }
  if (await schwereArbeit(datei, zeilen, loeschung)) await sperreVorTestprozessen();
  else console.log(`${datei}: keine Mutanten und keine löschbare Anweisung in den geänderten Zeilen, Erstlauf ohne Sperrplatz.`);
  const tests = anteilig(auswahl, anteil);
  const ergebnisse = await mutantenproben(datei, zeilen, tests);
  if (loeschung === null) return ergebnisse;
  const beginn = Date.now();
  const geloescht = await loeschung.pruefe({ datei, zeilen, ergebnisse, tests });
  notiereLoeschprobe(Date.now() - beginn, { datei });
  return [...ergebnisse, ...geloescht];
}

function alterStand(commit) {
  const verzeichnis = legeArbeitsordnerAn(arbeitsverzeichnis("alter-stand-"), commit);
  chdir(verzeichnis);
  const aufraeumen = () => {
    chdir(WURZEL);
    entferneArbeitsordner(verzeichnis);
  };
  const abmelden = beimHalt(aufraeumen);
  return () => {
    abmelden();
    aufraeumen();
  };
}

function abschaltungen(datei, bereiche) {
  const zeilen = readFileSync(datei, "utf8").split("\n");
  return bereiche.flatMap(([von, bis]) =>
    zeilen
      .slice(von - 1, bis)
      .flatMap((text, index) => (ABSCHALTUNG.test(text) ? [von + index] : []))
      .map((zeile) => ({ schluessel: `${datei}:${zeile} ${ABSCHALTKOMMENTAR}`, status: "Ignored", zeilen: [zeile, zeile], art: ABSCHALTKOMMENTAR })),
  );
}

async function gleicherLaufzeitcode(datei, { von, bis, seite }, umbenannt) {
  const paar = umbenannt.paare.find(({ alt, neu }) => (seite === "neu" ? neu : alt) === datei);
  if (paar !== undefined) {
    return paar.nurTypen ? `${paar.neu}: nur Typen ergänzt gegenüber ${paar.alt}, Laufzeitcode gleich, keine Mutanten nötig.` : undefined;
  }
  const [vorher, nachher] = [inhalt(von, datei), inhalt(bis, datei)];
  if (vorher === undefined || nachher === undefined) return undefined;
  const { gleich } = await umbenannt.vergleiche({ pfad: datei, text: vorher }, { pfad: datei, text: nachher });
  return gleich ? `${datei}: Syntaxbaum unverändert, keine Mutanten nötig.` : undefined;
}

async function ohneGleichenSyntaxbaum(zeilen, pruefung) {
  const umbenannt = await umbenennungen(pruefung);
  const uebrig = new Map(zeilen);
  for (const datei of zeilen.keys()) {
    const meldung = await gleicherLaufzeitcode(datei, pruefung, umbenannt);
    if (meldung === undefined) continue;
    uebrig.delete(datei);
    console.log(meldung);
  }
  return uebrig;
}

async function bestandteile({ von, bis, seite }) {
  const diff = git([...DIFF_ALS_TEXT, von, ...(bis ? [bis] : []), "--", "src/"]);
  const geaendert = geaenderteZeilen(diff, seite);
  const einheiten = [...geaendert].map(([datei, bereiche]) => ({
    datei,
    bereiche,
    abgeschaltet: seite === "neu" ? abschaltungen(datei, bereiche) : [],
  }));
  const zeilen = await ohneGleichenSyntaxbaum(geaendert, { von, bis, seite });
  return einheiten
    .map((einheit) => (zeilen.has(einheit.datei) ? einheit : { ...einheit, bereiche: undefined }))
    .filter(({ bereiche, abgeschaltet }) => bereiche !== undefined || abgeschaltet.length > 0);
}

function geaenderteTests({ von, bis }) {
  const dateien = git([...GEAENDERTE_DATEIEN, von, ...(bis ? [bis] : []), "--", "test/"]).split("\0");
  return new Set(dateien.filter((pfad) => TESTDATEI.test(pfad)));
}

function geloeschteDateien({ von, bis, seite }) {
  if (seite !== "alt") return new Set();
  const dateien = git([...GEAENDERTE_DATEIEN, NUR_GELOESCHTE, von, ...(bis ? [bis] : []), "--", "src/"]).split("\0");
  return new Set(dateien.filter((pfad) => QUELLDATEI.test(pfad)));
}

async function importierteDateien() {
  const code = git(["ls-files", "-z", "--", ...CODEDATEIEN]).split("\0").filter(Boolean);
  const nachQuelle = await abhaengigkeiten(code, { nennend: CODEPFAD, auswahl: GANZER_TEXT });
  const ziele = [...nachQuelle].flatMap(([quelle, { importe, genannt }]) => [...importe, ...genannt].filter((ziel) => ziel !== quelle));
  return new Set(ziele);
}

function pfadAnderswoGenannt(datei) {
  const stamm = datei.replace(CODEPFAD, "");
  const nennungen = basename(stamm) === VERZEICHNISEINSTIEG ? [stamm, dirname(stamm)] : [stamm];
  const muster = nennungen.flatMap((nennung) => ["-e", nennung]);
  const suche = spawnSync("git", ["grep", "-q", "-F", ...muster, "--", ".", `:(exclude,literal)${datei}`, ...KEINE_BENUTZUNG], { encoding: "utf8" });
  if (suche.status === GREP_GEFUNDEN) return true;
  if (suche.status === GREP_NICHT_GEFUNDEN) return false;
  throw new Error(`git grep ${nennungen.join(", ")}: ${suche.stderr.trim()}`);
}

async function ohneUnbenutzteGeloeschte(einheiten, geloescht) {
  if (geloescht.size === 0) return einheiten;
  const importiert = await importierteDateien();
  return einheiten.filter(({ datei }) => {
    if (!geloescht.has(datei) || importiert.has(datei) || pfadAnderswoGenannt(datei)) return true;
    console.log(`${datei}: ${UNBENUTZT_GELOESCHT}`);
    return false;
  });
}

function meldeTestauswahl({ seite }, beginn, { einheiten, graph }) {
  const gemessen = einheiten.filter(({ bereiche }) => bereiche !== undefined);
  const testdateien = graph === null ? [] : gemessen.flatMap(({ datei }) => testauswahl(datei, graph).alle);
  notiereTestauswahl(Date.now() - beginn, { seite, dateien: gemessen.length, testdateien: new Set(testdateien).size });
}

async function imStand(pruefung, arbeit) {
  const beginn = Date.now();
  const einheiten = await bestandteile(pruefung);
  if (einheiten.every(({ bereiche }) => bereiche === undefined)) {
    meldeTestauswahl(pruefung, beginn, { einheiten, graph: null });
    return arbeit(einheiten, null);
  }
  const geaendert = geaenderteTests(pruefung);
  const geloescht = geloeschteDateien(pruefung);
  const zurueck = pruefung.seite === "alt" ? alterStand(pruefung.von) : null;
  try {
    const auswahl = { einheiten: await ohneUnbenutzteGeloeschte(einheiten, geloescht), graph: { ...(await importierer()), geaendert } };
    meldeTestauswahl(pruefung, beginn, auswahl);
    return await arbeit(auswahl.einheiten, auswahl.graph);
  } finally {
    zurueck?.();
  }
}

async function vorschauDerSeite(gemessen, { nachDatei, graph, seite }) {
  if (!budgetLaeuft()) return;
  const dateien = [];
  for (const { datei } of gemessen) {
    const tests = testauswahl(datei, graph).alle;
    if (tests.length > 0) dateien.push({ tests, datei, bereiche: nachDatei.get(datei).bereiche });
  }
  const testgruppen = dateien.reduce((summe, { tests }) => summe + gruppen(tests).length, 0);
  vorschau({
    seite: SEITENNAME[seite],
    quelldateien: dateien.length,
    testdateien: new Set(dateien.flatMap(({ tests }) => tests)).size,
    testgruppen,
    aufrufe: testgruppen,
    ...(await mutantenzahl(dateien)),
  });
}

async function messe(einheiten, { graph, auswahl, seite }) {
  const nachDatei = new Map(einheiten.map((einheit) => [einheit.datei, einheit]));
  const ergebnisse = auswahl.flatMap(({ datei, anteil }) => (anteil === 1 ? nachDatei.get(datei).abgeschaltet : []));
  const gemessen = auswahl.filter(({ datei }) => nachDatei.get(datei).bereiche !== undefined);
  if (gemessen.length === 0) return ergebnisse;
  await vorschauDerSeite(gemessen, { nachDatei, graph, seite });
  const loeschung = seite === "neu" ? loeschprobe(() => arbeitsverzeichnis("loeschprobe-")) : null;
  const abmelden = loeschung === null ? null : beimHalt(loeschung.abbauen);
  try {
    for (const [index, anteil] of gemessen.entries()) {
      dateiBeginnt(anteil.datei, { nummer: index + 1, von: gemessen.length, seite });
      const geprueft = await pruefeDatei(anteil.datei, nachDatei.get(anteil.datei).bereiche, { graph, loeschung, anteil });
      dateiEndet(geprueft, ueberlebt);
      ergebnisse.push(...geprueft);
    }
    return ergebnisse;
  } finally {
    abmelden?.();
    loeschung?.abbauen();
  }
}

function mutiere(pruefung, auswahl = null) {
  return imStand(pruefung, (einheiten, graph) =>
    messe(einheiten, { graph, seite: pruefung.seite, auswahl: auswahl ?? einheiten.map(({ datei }) => ({ datei, ...GANZ })) }),
  );
}

function hinzugefuegt(diff) {
  const zeilen = [];
  let zustand = { datei: null, imKopf: false, zeile: 0 };
  for (const text of diff.split("\n")) {
    zustand = dateikopf(text, "neu", zustand);
    const hunk = HUNK.exec(text);
    if (hunk) zustand = { ...zustand, imKopf: false, zeile: Number(hunk[3]) };
    if (hunk || zustand.imKopf || !text.startsWith("+")) continue;
    zeilen.push({ datei: zustand.datei, zeile: zustand.zeile, text: text.slice(1) });
    zustand = { ...zustand, zeile: zustand.zeile + 1 };
  }
  return zeilen;
}

function unverfolgteZeilen() {
  const dateien = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...ZUSTANDSBEREICH]).split("\0").filter(Boolean);
  return dateien.flatMap((datei) =>
    readFileSync(datei, "utf8").split("\n").map((text, index) => ({ datei, zeile: index + 1, text })),
  );
}

function fragtZustand({ datei, text }) {
  if (STRYKER_ZUSTAND.some((muster) => muster.test(text))) return true;
  const weitergabe = text.includes(mitAktivemMutanten.name) || text.includes(WEITERGABE_MODUL);
  return weitergabe && !WEITERGABE_ERLAUBT.has(datei);
}

function zustandszugriffe({ von, seite }) {
  if (seite !== "neu") return [];
  const diff = git([...DIFF_ALS_TEXT, von, "--", ...ZUSTANDSBEREICH]);
  return [...hinzugefuegt(diff), ...unverfolgteZeilen()]
    .filter(fragtZustand)
    .map(({ datei, zeile }) => `${datei}:${zeile}`);
}

function urteil({ seite, von }, ergebnisse, ueberlebende) {
  if (ergebnisse.length === 0) return "grün: keine geänderte Zeile unter src/ mit Mutanten oder löschbarer Anweisung.";
  const stand = seite === "alt" ? ` auf dem alten Stand ${git(["rev-parse", von]).slice(0, KURZ)}` : " in den neuen Zeilen unter src/";
  if (ueberlebende.length === 0) return `grün: ${ergebnisse.length} Mutanten${stand}, keiner überlebt.`;
  const anteil = `${ueberlebende.length} von ${ergebnisse.length} Mutanten überleben${stand}`;
  return seite === "alt"
    ? `rot: Umbau verworfen, ${anteil}; kein Test hält dieses Verhalten fest.`
    : `rot: ${anteil}; kein Test verlangt diese Zeilen.`;
}

function gesamturteil(pruefung, { ergebnisse, ueberlebende, abgestuerzte, zugriffe }) {
  const mutanten = urteil(pruefung, ergebnisse, ueberlebende);
  const vorab = [
    ...(zugriffe.length > 0 ? [`${zugriffe.length} neue Zeilen fragen Strykers Zustand ab`] : []),
    ...(abgestuerzte.length > 0 ? [`${abgestuerzte.length} Mutanten mit abgebrochener Bestätigung (Absturz), Ursache im Testaufbau prüfen`] : []),
  ];
  if (vorab.length === 0) return mutanten;
  return `rot: ${vorab.join("; ")}; ${mutanten.slice(mutanten.indexOf(" ") + 1)}`;
}

function roteZwecke({ ueberlebende, abgestuerzte, zugriffe }) {
  const mutanten = ueberlebende.length + abgestuerzte.length > 0;
  return [...(mutanten ? [ZWECK_UEBERLEBT] : []), ...(zugriffe.length > 0 ? [ZWECK_ZUSTAND] : [])];
}

function zeigeZweck(ids) {
  for (const id of ids) console.log(zweckBlock(id).join("\n"));
}

function bewerte(pruefung, gleichwertige, { ergebnisse, zugriffe }) {
  const angenommene = [];
  const ueberlebende = [];
  for (const eintrag of ergebnisse.filter(ueberlebt)) (angenommen(eintrag, gleichwertige) ? angenommene : ueberlebende).push(eintrag);
  for (const { schluessel } of angenommene) console.log(`${GLEICHWERTIG_ANGENOMMEN}: ${schluessel}`);
  for (const { schluessel } of ueberlebende.filter(({ status }) => ABGESCHALTET.has(status))) {
    console.log(`${ABSCHALTUNG_VERSTOSS}: ${schluessel}`);
  }
  for (const { hinweis } of ergebnisse.filter((eintrag) => eintrag.hinweis !== undefined)) console.log(hinweis);
  const abgestuerzte = ergebnisse.filter(bestaetigungAbgestuerzt);
  for (const { befund } of abgestuerzte) console.log(befund);
  for (const { schluessel } of ueberlebende) console.log(`${MUTANT_UEBERLEBT}: ${schluessel}`);
  for (const stelle of zugriffe) console.log(`${ZUSTAND_VERSTOSS}: ${stelle}`);
  if (ergebnisse.length > 0) console.log(`${BESTAETIGUNG}: ${bilanz(ergebnisse)}.`);
  console.log(gesamturteil(pruefung, { ergebnisse, ueberlebende, abgestuerzte, zugriffe }));
  return roteZwecke({ ueberlebende, abgestuerzte, zugriffe });
}

async function pruefe(pruefung, gleichwertige) {
  const zugriffe = zustandszugriffe(pruefung);
  return bewerte(pruefung, gleichwertige, { ergebnisse: await mutiere(pruefung), zugriffe });
}

async function planen(pruefungen) {
  const einheiten = [];
  for (const [pruefung, stand] of pruefungen.entries()) {
    await imStand(stand, (bestand, graph) => {
      for (const { datei, bereiche } of bestand) {
        const von = bereiche === undefined ? 1 : anteile(testauswahl(datei, graph).alle.length);
        einheiten.push(...Array.from({ length: von }, (_leer, index) => ({ pruefung, datei, bereiche, anteil: index + 1, von })));
      }
    });
  }
  const teile = aufteilen(einheiten);
  return { teile, pruefsumme: pruefsumme(teile, git(["rev-parse", "HEAD"]).trim()) };
}

function zeigePlan({ teile }) {
  if (teile.length === 0) console.log("Plan: keine geänderte Zeile unter src/ mit Mutanten oder Abschaltung.");
  for (const [index, teil] of teile.entries()) console.log(`Teil ${index + 1} von ${teile.length}: ${teil.map(einheitName).join("; ")}`);
}

async function schreibePlan(pruefungen, ziel) {
  const plan = await planen(pruefungen);
  zeigePlan(plan);
  writeFileSync(ziel, JSON.stringify({ anzahl: plan.teile.length, teile: matrix(plan.teile), pruefsumme: plan.pruefsumme }));
  return EXIT_GRUEN;
}

function teilnummer({ teil, teile }, anzahl) {
  const [nummer, erwartet] = [Number(teil), Number(teile)];
  if (erwartet !== anzahl) throw new Error(`der Plan hat ${anzahl} Teile, aufgerufen mit --teile ${teile}`);
  const gueltig = anzahl === 0 ? nummer === 0 : Number.isInteger(nummer) && nummer >= 1 && nummer <= anzahl;
  if (!gueltig) throw new Error(`Teil ${teil} gibt es im Plan mit ${anzahl} Teilen nicht`);
  return nummer;
}

async function messeTeil(pruefungen, optionen) {
  const { teile, pruefsumme: summe } = await planen(pruefungen);
  const nummer = teilnummer(optionen, teile.length);
  const eigene = teile[nummer - 1] ?? [];
  console.log(`Teil ${nummer} von ${teile.length}: ${eigene.map(einheitName).join("; ") || "keine geänderte Zeile unter src/"}`);
  const messungen = [];
  for (const [index, stand] of pruefungen.entries()) {
    const auswahl = eigene.filter(({ pruefung }) => pruefung === index);
    if (auswahl.length > 0) messungen.push({ pruefung: index, ergebnisse: await mutiere(stand, auswahl) });
  }
  const alle = messungen.flatMap(({ ergebnisse }) => ergebnisse);
  const offen = alle.filter(ueberlebt).length;
  console.log(`Teil ${nummer}: ${alle.length} Ergebnisse, ${offen} in diesen Testdateien nicht getötet; das Urteil fällt im Job Mutationsurteil.`);
  writeFileSync(optionen.ergebnis, JSON.stringify({ pruefsumme: summe, teil: nummer, messungen }));
  return EXIT_GRUEN;
}

function teilberichte(ordner, { teile, pruefsumme: summe }) {
  const berichte = readdirSync(ordner)
    .filter((name) => ERGEBNISDATEI.test(name))
    .map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")));
  const fremd = berichte.filter((bericht) => bericht.pruefsumme !== summe);
  if (fremd.length > 0) throw new Error(`${fremd.length} Teilergebnisse gehören zu einem anderen Plan`);
  const gefunden = berichte.map(({ teil }) => teil).sort((links, rechts) => links - rechts);
  if (JSON.stringify(gefunden) !== JSON.stringify(matrix(teile))) {
    throw new Error(`erwartet die Teile ${matrix(teile).join(", ")}, gefunden ${gefunden.join(", ") || "keine"}`);
  }
  return berichte;
}

function vereineAnteile(berichte, pruefung) {
  const nachSchluessel = new Map();
  for (const { messungen } of berichte) {
    for (const eintrag of messungen.filter((messung) => messung.pruefung === pruefung).flatMap(({ ergebnisse }) => ergebnisse)) {
      nachSchluessel.set(eintrag.schluessel, staerker(nachSchluessel.get(eintrag.schluessel) ?? eintrag, eintrag));
    }
  }
  return [...nachSchluessel.values()];
}

async function urteilen(pruefungen, { urteil, gleichwertige }) {
  const plan = await planen(pruefungen);
  const berichte = teilberichte(urteil, plan);
  const rot = new Set();
  for (const [index, pruefung] of pruefungen.entries()) {
    const ergebnisse = vereineAnteile(berichte, index);
    for (const id of bewerte(pruefung, gleichwertige, { ergebnisse, zugriffe: zustandszugriffe(pruefung) })) rot.add(id);
  }
  zeigeZweck(rot);
  return rot.size === 0 ? EXIT_GRUEN : EXIT_ROT;
}

async function gesamtlauf(pruefungen, gleichwertige) {
  const rot = new Set();
  for (const pruefung of pruefungen) for (const id of await pruefe(pruefung, gleichwertige)) rot.add(id);
  zeigeZweck(rot);
  return rot.size === 0 ? EXIT_GRUEN : EXIT_ROT;
}

function umbauCommits(basis) {
  const log = git(["log", "--format=%H", "-E", `--grep=${UMBAU_ZEILE}`, `${basis}..HEAD`]);
  return log.split("\n").filter(Boolean);
}

function gemeldet(basis) {
  const nachrichten = git(["log", "-z", "--format=%B", `${basis}..HEAD`]).split("\0");
  return nachrichten
    .filter((nachricht) => AUFTRAGSWEG.test(nachricht))
    .flatMap((nachricht) => gleichwertigGemeldet(nachricht));
}

function ohneAndereBetriebsart(values) {
  const andere = [values.plan, values.teil, values.teile, values.urteil].every((wert) => wert === undefined);
  return andere && !values.testumbau && !values["alter-stand"] && values.gleichwertig.length === 0;
}

function vorherAufrufGueltig(values, art) {
  const zusammen = art === "vorher-zusammen";
  const stand = zusammen ? values.basis === undefined && values.tests === undefined : values.basis !== undefined && values.tests !== undefined;
  const ergebnis = (art === "vorher-plan") === (values.ergebnis === undefined);
  const sekunden = values["stueck-sekunden"];
  const groesse = sekunden === undefined || (art === "vorher-plan" && SEKUNDEN.test(sekunden));
  return ohneAndereBetriebsart(values) && stand && ergebnis && groesse;
}

function ausCiAufrufGueltig(values) {
  const allein = [...VORHER_ARTEN, ...NUR_VORHER, "ergebnis"].every((name) => values[name] === undefined);
  return values.basis !== undefined && allein && ohneAndereBetriebsart(values);
}

function aufrufGueltig(values) {
  if (values[VORHER_AUS_CI] !== undefined) return ausCiAufrufGueltig(values);
  const vorher = VORHER_ARTEN.filter((art) => values[art] !== undefined);
  if (vorher.length > 0) return vorher.length === 1 && vorherAufrufGueltig(values, vorher[0]);
  if (NUR_VORHER.some((name) => values[name] !== undefined)) return false;
  const teilAufruf = [values.teil, values.teile, values.ergebnis].filter((wert) => wert !== undefined).length;
  const betriebsarten = [values.plan, values.teil, values.urteil].filter((wert) => wert !== undefined).length + Number(values.testumbau);
  const doppelt = values.testumbau && (values["alter-stand"] || values.gleichwertig.length > 0);
  return values.basis !== undefined && [0, TEILANGABEN].includes(teilAufruf) && betriebsarten <= BETRIEBSARTEN_HOECHSTENS && !doppelt;
}

function schreibeJson(ziel, inhalt) {
  writeFileSync(ziel, `${JSON.stringify(inhalt, null, EINRUECKUNG)}\n`);
}

async function vorherVerteilt(values) {
  const werkzeug = { alterStand, durchgang, ueberlebt };
  if (values["vorher-zusammen"] !== undefined) {
    const vereint = vorherZusammen(values["vorher-zusammen"]);
    schreibeJson(values.ergebnis, vereint);
    console.log(zusammenZeilen(vereint).join("\n"));
    return EXIT_GRUEN;
  }
  const stand = { basis: git(["rev-parse", "--verify", values.basis + NUR_COMMIT]).trim(), tests: testsAus(values.tests) };
  if (values["vorher-plan"] !== undefined) {
    const plan = await vorherPlan(stand, werkzeug, values["stueck-sekunden"] === undefined ? undefined : Number(values["stueck-sekunden"]));
    schreibeJson(values["vorher-plan"], { ...plan, umgebung: werkzeugStand(WURZEL) });
    console.log(planZeilen(plan).join("\n"));
    return EXIT_GRUEN;
  }
  const stueck = stueckAus(values["vorher-stueck"]);
  await gemesseneSperre(`test:mutation --basis ${values.basis} --vorher-stueck`);
  kindprozesseInEigenemTempOrdner();
  const bericht = await vorherStueck(stand, stueck, werkzeug);
  schreibeJson(values.ergebnis, { ...bericht, umgebung: werkzeugStand(WURZEL), postgres: postgresDa() });
  console.log(`Stück ${bericht.stueck.nummer}: ${bericht.getoetet.length} von ${bericht.anzahl} Mutanten getötet in ${bericht.sekunden} s.`);
  return EXIT_GRUEN;
}

async function vorherEinlesen(values) {
  const basis = git(["rev-parse", "--verify", values.basis + NUR_COMMIT]).trim();
  const lauf = values[VORHER_AUS_CI];
  const { schluessel, neu, herkunft, getoetet, quellen } = await vorherAusCi({ basis, lauf, root: WURZEL }, { werkzeug: { alterStand, durchgang, ueberlebt } });
  const kurz = schluessel.slice(0, SCHLUESSEL_ANZEIGE);
  if (!neu) {
    console.log(`Vorher-Seite für diesen Fall liegt schon im Speicher (Schlüssel ${kurz}); Lauf ${lauf} nicht übernommen.`);
    return EXIT_GRUEN;
  }
  console.log(`Vorher-Seite aus der CI abgelegt (Schlüssel ${kurz}): Lauf ${lauf}, Kopf ${herkunft.kopf}, ${herkunft.plattform}, Node ${herkunft.node}; ${getoetet} getötete Mutanten in ${quellen} Quelldateien.`);
  return EXIT_GRUEN;
}

async function gemesseneSperre(anlass) {
  const beginn = Date.now();
  await anDerSperre(() => nimmSperreAuchFuerKindprozesse(anlass));
  notiereSperre(Date.now() - beginn);
}

function sperreVorTestprozessen() {
  SPERRE.genommen ??= gemesseneSperre(SPERRE.anlass);
  return SPERRE.genommen;
}

async function freigabe(umfang) {
  vorschau(umfang);
  await sperreVorTestprozessen();
}

function betriebsart(values) {
  return BETRIEBSARTEN.find((art) => values[art] !== undefined && values[art] !== false) ?? NORMAL;
}

function startkopf(values) {
  const kopf = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return { betriebsart: betriebsart(values), basis: values.basis, commit: kopf.status === 0 ? kopf.stdout.trim() : null };
}

function nurLogAuswertung(values) {
  return Object.entries(values).every(([name, wert]) => name === LOG_AUSWERTUNG || wert === false || (Array.isArray(wert) && wert.length === 0));
}

function werteLogAus(values) {
  if (!nurLogAuswertung(values)) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  console.log(logAuswertung(values[LOG_AUSWERTUNG]).join("\n"));
  return EXIT_GRUEN;
}

async function main() {
  const { values } = parseArgs({
    options: {
      basis: { type: "string" },
      tests: { type: "string" },
      "stueck-sekunden": { type: "string" },
      "vorher-plan": { type: "string" },
      "vorher-stueck": { type: "string" },
      "vorher-zusammen": { type: "string" },
      [VORHER_AUS_CI]: { type: "string" },
      "alter-stand": { type: "boolean", default: false },
      testumbau: { type: "boolean", default: false },
      gleichwertig: { type: "string", multiple: true, default: [] },
      plan: { type: "string" },
      teil: { type: "string" },
      teile: { type: "string" },
      ergebnis: { type: "string" },
      urteil: { type: "string" },
      [LOG_AUSWERTUNG]: { type: "string" },
    },
  });
  if (values[LOG_AUSWERTUNG] !== undefined) return werteLogAus(values);
  if (!aufrufGueltig(values)) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  beginneLog(() => join(legeSandboxordnerAn(WURZEL), LOGORDNER), startkopf(values));
  if (values[VORHER_AUS_CI] !== undefined) return vorherEinlesen(values);
  if (VORHER_ARTEN.some((art) => values[art] !== undefined)) return vorherVerteilt(values);
  SPERRE.anlass = `test:mutation --basis ${values.basis}`;
  kindprozesseInEigenemTempOrdner();
  if (values.testumbau) {
    starteBudget(TESTUMBAU);
    return testumbauPruefung(values.basis, { alterStand, durchgang, ueberlebt, freigabe });
  }
  const gleichwertige = new Set([...values.gleichwertig, ...gemeldet(values.basis)]);
  const pruefungen = values["alter-stand"]
    ? [{ von: values.basis, seite: "alt" }]
    : [{ von: values.basis, seite: "neu" }, ...umbauCommits(values.basis).map((commit) => ({ von: `${commit}^`, bis: commit, seite: "alt" }))];
  if (values.plan !== undefined) return schreibePlan(pruefungen, values.plan);
  if (values.teil !== undefined) return messeTeil(pruefungen, values);
  if (values.urteil !== undefined) return urteilen(pruefungen, { urteil: values.urteil, gleichwertige });
  starteBudget(NORMAL);
  return gesamtlauf(pruefungen, gleichwertige);
}

function roteTests(mitschrift) {
  return mitschrift.flatMap((block) =>
    [...block.matchAll(ROTE_TESTDATEI)].flatMap(([, datei, meldung]) => [...meldung.matchAll(ROTER_TEST)].map(([, test]) => ({ datei, test }))),
  );
}

async function mitErstlaufMitschrift(ausfuehren) {
  const schreiben = process.stdout.write.bind(process.stdout);
  process.stdout.write = (teil, ...rest) => {
    if ([ERSTLAUF_ROT, ERSTLAUF_ZEITGRENZE, ERSTLAUF_FEHLER].some((meldung) => String(teil).includes(meldung))) ERSTLAUF_MITSCHRIFT.push(String(teil));
    return schreiben(teil, ...rest);
  };
  try {
    return await ausfuehren();
  } catch (fehler) {
    if (fehler.message === ERSTLAUF_ABBRUCH) for (const rot of roteTests(ERSTLAUF_MITSCHRIFT)) console.error(`Abbruch: Erstlauf rot: ${rot.datei} › ${rot.test}`);
    throw fehler;
  } finally {
    process.stdout.write = schreiben;
  }
}

try {
  process.exitCode = await mitErstlaufMitschrift(main);
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
} finally {
  beendeLog(process.exitCode);
}
