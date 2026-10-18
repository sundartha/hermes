import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { chdir, cwd } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Stryker } from "@stryker-mutator/core";
import { cruise } from "dependency-cruiser";

import { omitKeys } from "../src/utils/object.js";
import { patternFlagsFor } from "../test/testbaenke-run.mjs";
import { ABGESCHALTET, ABSCHALTUNG_VERSTOSS, angenommen, GLEICHWERTIG_ANGENOMMEN, gleichwertigGemeldet, MUTANT_UEBERLEBT, ohneTestdatei } from "./auftrag/gleichwertig.mjs";
import { nimmSperreAuchFuerKindprozesse } from "./schwerlauf/sperre.mjs";
import { kindprozesseInEigenemTempOrdner } from "./temp-ordner.mjs";
import { bestaetige, bestaetigt, bilanz } from "./mutationspruefung/bestaetigung.mjs";
import { geteiltBeiZeitgrenze, gruppen } from "./mutationspruefung/gruppen.mjs";
import { anteile, anteilig, aufteilen, einheitName, matrix, pruefsumme, uebrige } from "./mutationspruefung/teile.mjs";
import { testumbauPruefung } from "./mutationspruefung/testumbau.mjs";
import { ERGEBNISDATEI, planZeilen, stueckAus, testsAus, vorherPlan, vorherStueck, vorherZusammen, zusammenZeilen } from "./mutationspruefung/vorher-verteilt.mjs";
import { vorlageEinstellen } from "./mutationspruefung/vorlage.mjs";
import { mitAktivemMutanten } from "./mutationspruefung/zustand.mjs";
import { GELOESCHT, loeschprobe } from "./mutationspruefung/zeilen-loeschen.mjs";
import { SANDBOXORDNER, entferneArbeitsordner, legeArbeitsordnerAn, legeSandboxordnerAn } from "./tests-ausmisten/arbeitsordner.mjs";
import { inhalt, umbenennungen } from "./umbenennung.mjs";

const KONFIGURATIONSDATEI = fileURLToPath(new URL("../stryker.config.json", import.meta.url));
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
const FREMDE_PAKETE = "node_modules";
const AUSSERHALB = "..";
const DIFF_ALS_TEXT = ["diff", "--text", "-U0", "--no-renames", "--no-color", "--no-ext-diff"];
const DIFF_KOPF = "diff --git ";
const DATEIKOPF = { neu: /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/, alt: /^--- (?:a\/(.+)|\/dev\/null)$/ };
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const UEBERLEBT = "Survived";
const UEBERLEBEND = new Set([UEBERLEBT, "NoCoverage", ...ABGESCHALTET]);
const ABSCHALTUNG = /Stryker disable /;
const ABSCHALTKOMMENTAR = "Kommentar „Stryker disable“";
const ZUSTANDSBEREICH = [".", ":(exclude)tools/mutationspruefung.mjs", ":(exclude)tools/mutationspruefung/"];
const STRYKER_ZUSTAND = [/__stryker|stryker_|stry(?:mutact|cov|ns)_|active_?mutant|mutant__/i, /STRYKER/];
const WEITERGABE_ERLAUBT = new Set(["test/helpers.js", "test/gemeinsam/gebaute-konfiguration.js"]);
const WEITERGABE_MODUL = "mutationspruefung/zustand.mjs";
const ZUSTAND_VERSTOSS = "Verstoß: Zeile fragt Strykers Zustand ab, ein Test darf nicht erkennen, ob ein Mutant aktiv ist";
const ZEITUEBERSCHREITUNG = "Timeout";
const ZEITFAKTOR_WIEDERHOLUNG = 3;
const BESTAETIGUNGSLAUF = " im Bestätigungslauf";
const BESTAETIGUNG = "Bestätigung";
const GLEICHZEITIG = KONFIGURATION.concurrency;
const ABGELEHNT = "rejected";
const LEERRAUM = /\s+/g;
const UMBAU_ZEILE = "^Art: umbau$";
const AUFTRAGSWEG = /^Auftrag: [^\s/]+\/\S+$/m;
const KURZ = 7;
const MS_JE_SEKUNDE = 1000;
const MAX_GIT_AUSGABE = 268_435_456;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const GANZ = { anteil: 1, von: 1 };
const TEILANGABEN = 3;
const BETRIEBSARTEN_HOECHSTENS = 1;
const ERSTLAUF_ROT = "One or more tests failed in the initial test run:";
const ERSTLAUF_ABBRUCH = "There were failed tests in the initial test run.";
const ERSTLAUF_GESCHEITERT = "Something went wrong in the initial test run";
const ERSTLAUF_ZEITGRENZE = "Initial test run timed out!";
const ERSTLAUF_FEHLER = "One or more tests resulted in an error:";
const ROTE_TESTDATEI = /^\t([^\t].*)\n\t\t(.*)$/gm;
const ROTER_TEST = /(?:^|, )((?:.+? > )?(.+?)): \2(?=, |$)/g;
const ERSTLAUF_MITSCHRIFT = [];
const VORHER_ARTEN = ["vorher-plan", "vorher-stueck", "vorher-zusammen"];
const NUR_COMMIT = "^{commit}";
const NUR_VORHER = ["tests", "stueck-sekunden"];
const SEKUNDEN = /^[1-9]\d*$/;
const EINRUECKUNG = 2;
const AUFRUF = [
  "Aufruf: node tools/mutationspruefung.mjs --basis <commit> [--alter-stand | --testumbau] [--gleichwertig <mutant>] [--plan <datei> | --teil <n> --teile <anzahl> --ergebnis <datei> | --urteil <ordner>]",
  "   oder: node tools/mutationspruefung.mjs --basis <commit> --tests <a,b> (--vorher-plan <datei> [--stueck-sekunden <s>] | --vorher-stueck <json> --ergebnis <datei>)",
  "   oder: node tools/mutationspruefung.mjs --vorher-zusammen <ordner> --ergebnis <datei>",
].join("\n");

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

function genannteDateien(modul) {
  const text = readFileSync(modul, "utf8");
  const nennungen = [...[...text.matchAll(PFADNENNUNG)].map(([pfad]) => pfad), ...segmentpfade(text).filter((pfad) => CODEPFAD.test(pfad))];
  const ziele = nennungen.flatMap((pfad) => [normalize(pfad), join(dirname(modul), pfad)]);
  return [...new Set(ziele)].filter((ziel) => ziel !== modul && eigeneDatei(ziel));
}

async function abhaengigkeiten(wurzeln) {
  const { output } = await cruise(wurzeln, CRUISE_OPTIONEN);
  return new Map(
    output.modules.map(({ source, dependencies }) => [
      source,
      { importe: dependencies.map(({ resolved }) => resolved), genannt: NENNENDE_DATEI.test(source) && eigeneDatei(source) ? genannteDateien(source) : [] },
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

function mutant({ fileName, location, mutatorName, replacement, status, killedBy }) {
  const datei = relative(cwd(), fileName);
  const { line, column } = location.start;
  const ersatz = (replacement ?? "").replace(LEERRAUM, " ");
  const schluessel = `${datei}:${line}:${column} ${mutatorName} → ${ersatz}`;
  return { schluessel, status, zeilen: [line, location.end.line], art: mutatorName, toeter: killedBy ?? [] };
}

async function stryker({ datei, zeilen, tests, faktor, concurrency, anlass = "" }) {
  console.log(await vorlageEinstellen(datei));
  legeSandboxordnerAn(cwd());
  const beginn = Date.now();
  const optionen = {
    ...KONFIGURATION,
    mutate: zeilen.map(([von, bis]) => `${datei}:${von}-${bis}`),
    tap: { ...KONFIGURATION.tap, testFiles: tests, nodeArgs: [...KONFIGURATION.tap.nodeArgs, ...patternFlagsFor(BANK)] },
    timeoutMS: KONFIGURATION.timeoutMS * faktor,
    configFile: KONFIGURATIONSDATEI,
    concurrency,
    tempDirName: SANDBOXORDNER,
  };
  const ergebnisse = (await new Stryker(optionen).runMutationTest()).map(mutant);
  const sekunden = Math.round((Date.now() - beginn) / MS_JE_SEKUNDE);
  console.log(`${datei}: ${ergebnisse.length} Mutanten${anlass} gegen ${tests.length} Testdateien in ${sekunden} s`);
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
    zeilen: zeitueber.map((eintrag) => eintrag.zeilen),
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
  if (anderer === undefined) return eintrag;
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

function wellen(testgruppen) {
  return Array.from({ length: Math.ceil(testgruppen.length / GLEICHZEITIG) }, (_leer, welle) =>
    testgruppen.slice(welle * GLEICHZEITIG, (welle + 1) * GLEICHZEITIG),
  );
}

function zeitgrenzeSeit(beginn) {
  return (fehler) => {
    const seither = ERSTLAUF_MITSCHRIFT.slice(beginn);
    const gemeldet = (meldung) => seither.some((zeile) => zeile.includes(meldung));
    return fehler.message === ERSTLAUF_GESCHEITERT && gemeldet(ERSTLAUF_ZEITGRENZE) && !gemeldet(ERSTLAUF_FEHLER);
  };
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
  const concurrency = Math.max(1, Math.floor(GLEICHZEITIG / testgruppen.length));
  const laeufe = await Promise.allSettled(testgruppen.map((tests) => geteilterGruppenlauf({ datei, zeilen, tests, concurrency })));
  const fehlschlag = laeufe.find(({ status }) => status === ABGELEHNT);
  if (fehlschlag) throw fehlschlag.reason;
  return laeufe.map(({ value }) => value);
}

async function durchgang(datei, zeilen, tests) {
  let ergebnisse = null;
  for (const testgruppen of wellen(gruppen(tests))) {
    const offen = ergebnisse === null ? zeilen : ergebnisse.filter(ueberlebt).map((eintrag) => eintrag.zeilen);
    if (offen.length === 0) break;
    const laeufe = await welle(datei, offen, testgruppen);
    ergebnisse = vereine(ergebnisse ?? laeufe[0], laeufe);
  }
  return ergebnisse;
}

async function mutantenproben(datei, zeilen, { erste, alle }) {
  const ergebnisse = await durchgang(datei, zeilen, erste);
  const offen = ergebnisse.filter(ueberlebt);
  const uebrige = alle.filter((test) => !erste.includes(test));
  if (offen.length === 0 || uebrige.length === 0) return ergebnisse;
  const zweite = await ohneRoteErstlaeufe(datei, offen.map((eintrag) => eintrag.zeilen), uebrige);
  return vereine(ergebnisse, [zweite]);
}

async function ohneRoteErstlaeufe(datei, zeilen, tests) {
  if (tests.length === 0) return [];
  const beginn = ERSTLAUF_MITSCHRIFT.length;
  try {
    return await durchgang(datei, zeilen, tests);
  } catch (fehler) {
    const rote = fehler.message === ERSTLAUF_ABBRUCH ? roteTests(ERSTLAUF_MITSCHRIFT.slice(beginn)) : [];
    if (rote.length === 0 || !rote.every((rot) => tests.includes(rot.datei))) throw fehler;
    ERSTLAUF_MITSCHRIFT.splice(beginn);
    for (const rot of rote) console.log(`Zweite Stufe ohne ${rot.datei} › ${rot.test}: im Erstlauf rot`);
    return ohneRoteErstlaeufe(datei, zeilen, tests.filter((test) => !rote.some((rot) => rot.datei === test)));
  }
}

function testauswahl(datei, graph) {
  const importe = erreichendeTests(datei, graph.importe);
  const { direkt, alle } = erreichendeTests(datei, graph.gesamt);
  return { erste: [importe.direkt, importe.alle, direkt].find((tests) => tests.length > 0) ?? alle, alle };
}

async function pruefeDatei(datei, zeilen, { graph, loeschung, anteil }) {
  const auswahl = testauswahl(datei, graph);
  if (auswahl.alle.length === 0) {
    return zeilen.map(([von]) => ohneTestdatei(datei, von));
  }
  const tests = anteilig(auswahl, anteil);
  const ergebnisse = await mutantenproben(datei, zeilen, tests);
  if (loeschung === null) return ergebnisse;
  return [...ergebnisse, ...loeschung.pruefe({ datei, zeilen, ergebnisse, tests })];
}

function alterStand(commit) {
  const verzeichnis = legeArbeitsordnerAn(arbeitsverzeichnis("alter-stand-"), commit);
  chdir(verzeichnis);
  return () => {
    chdir(WURZEL);
    entferneArbeitsordner(verzeichnis);
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

async function imStand(pruefung, arbeit) {
  const einheiten = await bestandteile(pruefung);
  if (einheiten.every(({ bereiche }) => bereiche === undefined)) return arbeit(einheiten, null);
  const zurueck = pruefung.seite === "alt" ? alterStand(pruefung.von) : null;
  try {
    return await arbeit(einheiten, await importierer());
  } finally {
    zurueck?.();
  }
}

async function messe(einheiten, { graph, auswahl, seite }) {
  const nachDatei = new Map(einheiten.map((einheit) => [einheit.datei, einheit]));
  const ergebnisse = auswahl.flatMap(({ datei, anteil }) => (anteil === 1 ? nachDatei.get(datei).abgeschaltet : []));
  const gemessen = auswahl.filter(({ datei }) => nachDatei.get(datei).bereiche !== undefined);
  if (gemessen.length === 0) return ergebnisse;
  const loeschung = seite === "neu" ? loeschprobe(() => arbeitsverzeichnis("loeschprobe-")) : null;
  try {
    for (const anteil of gemessen) {
      ergebnisse.push(...(await pruefeDatei(anteil.datei, nachDatei.get(anteil.datei).bereiche, { graph, loeschung, anteil })));
    }
    return ergebnisse;
  } finally {
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

function gesamturteil(pruefung, { ergebnisse, ueberlebende, zugriffe }) {
  const mutanten = urteil(pruefung, ergebnisse, ueberlebende);
  if (zugriffe.length === 0) return mutanten;
  return `rot: ${zugriffe.length} neue Zeilen fragen Strykers Zustand ab; ${mutanten.slice(mutanten.indexOf(" ") + 1)}`;
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
  for (const { schluessel } of ueberlebende) console.log(`${MUTANT_UEBERLEBT}: ${schluessel}`);
  for (const stelle of zugriffe) console.log(`${ZUSTAND_VERSTOSS}: ${stelle}`);
  if (ergebnisse.length > 0) console.log(`${BESTAETIGUNG}: ${bilanz(ergebnisse)}.`);
  console.log(gesamturteil(pruefung, { ergebnisse, ueberlebende, zugriffe }));
  return ueberlebende.length + zugriffe.length;
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
        const von = bereiche === undefined ? 1 : anteile(testauswahl(datei, graph).erste.length);
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

async function zweiteStufe(datei, ergebnisse, { graph, loeschung }) {
  const uebrig = uebrige(testauswahl(datei, graph));
  const offen = ergebnisse.filter((eintrag) => eintrag.schluessel.startsWith(`${datei}:`) && ueberlebt(eintrag));
  if (uebrig.length === 0 || offen.length === 0) return ergebnisse;
  const mutanten = offen.filter(({ art }) => art !== GELOESCHT && art !== ABSCHALTKOMMENTAR);
  const vereint = mutanten.length === 0 ? ergebnisse : vereine(ergebnisse, [await ohneRoteErstlaeufe(datei, mutanten.map(({ zeilen }) => zeilen), uebrig)]);
  const geloescht = offen.filter(({ art }) => art === GELOESCHT);
  if (loeschung === null || geloescht.length === 0) return vereint;
  const nachgefasst = new Map(loeschung.nachfassen({ datei, eintraege: geloescht, uebrige: uebrig }).map((eintrag) => [eintrag.schluessel, eintrag]));
  return vereint.map((eintrag) => nachgefasst.get(eintrag.schluessel) ?? eintrag);
}

function nachfassen(stand, dateien, ergebnisse) {
  if (dateien.length === 0) return ergebnisse;
  return imStand(stand, async (_bestand, graph) => {
    const loeschung = stand.seite === "neu" ? loeschprobe(() => arbeitsverzeichnis("loeschprobe-")) : null;
    try {
      let vereint = ergebnisse;
      for (const datei of dateien) vereint = await zweiteStufe(datei, vereint, { graph, loeschung });
      return vereint;
    } finally {
      loeschung?.abbauen();
    }
  });
}

function geteilteDateien(teile, pruefung) {
  const einheiten = teile.flat().filter((einheit) => einheit.pruefung === pruefung && einheit.anteil === 1 && einheit.von > 1);
  return einheiten.map(({ datei }) => datei);
}

async function urteilen(pruefungen, { urteil, gleichwertige }) {
  const plan = await planen(pruefungen);
  const berichte = teilberichte(urteil, plan);
  let ueberlebende = 0;
  for (const [index, pruefung] of pruefungen.entries()) {
    const ergebnisse = await nachfassen(pruefung, geteilteDateien(plan.teile, index), vereineAnteile(berichte, index));
    ueberlebende += bewerte(pruefung, gleichwertige, { ergebnisse, zugriffe: zustandszugriffe(pruefung) });
  }
  return ueberlebende === 0 ? EXIT_GRUEN : EXIT_ROT;
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

function aufrufGueltig(values) {
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
    schreibeJson(values["vorher-plan"], plan);
    console.log(planZeilen(plan).join("\n"));
    return EXIT_GRUEN;
  }
  const stueck = stueckAus(values["vorher-stueck"]);
  await nimmSperreAuchFuerKindprozesse(`test:mutation --basis ${values.basis} --vorher-stueck`);
  kindprozesseInEigenemTempOrdner();
  const bericht = await vorherStueck(stand, stueck, werkzeug);
  schreibeJson(values.ergebnis, bericht);
  console.log(`Stück ${bericht.stueck.nummer}: ${bericht.getoetet.length} von ${bericht.anzahl} Mutanten getötet in ${bericht.sekunden} s.`);
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
      "alter-stand": { type: "boolean", default: false },
      testumbau: { type: "boolean", default: false },
      gleichwertig: { type: "string", multiple: true, default: [] },
      plan: { type: "string" },
      teil: { type: "string" },
      teile: { type: "string" },
      ergebnis: { type: "string" },
      urteil: { type: "string" },
    },
  });
  if (!aufrufGueltig(values)) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  if (VORHER_ARTEN.some((art) => values[art] !== undefined)) return vorherVerteilt(values);
  await nimmSperreAuchFuerKindprozesse(`test:mutation --basis ${values.basis}`);
  kindprozesseInEigenemTempOrdner();
  if (values.testumbau) return testumbauPruefung(values.basis, { alterStand, durchgang, ueberlebt });
  const gleichwertige = new Set([...values.gleichwertig, ...gemeldet(values.basis)]);
  const pruefungen = values["alter-stand"]
    ? [{ von: values.basis, seite: "alt" }]
    : [{ von: values.basis, seite: "neu" }, ...umbauCommits(values.basis).map((commit) => ({ von: `${commit}^`, bis: commit, seite: "alt" }))];
  if (values.plan !== undefined) return schreibePlan(pruefungen, values.plan);
  if (values.teil !== undefined) return messeTeil(pruefungen, values);
  if (values.urteil !== undefined) return urteilen(pruefungen, { urteil: values.urteil, gleichwertige });
  let ueberlebende = 0;
  for (const pruefung of pruefungen) ueberlebende += await pruefe(pruefung, gleichwertige);
  return ueberlebende === 0 ? EXIT_GRUEN : EXIT_ROT;
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
}
