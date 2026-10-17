import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { chdir, cwd } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Stryker } from "@stryker-mutator/core";
import { cruise } from "dependency-cruiser";

import { patternFlagsFor } from "../test/testbaenke-run.mjs";
import { legeWorktreeAn } from "./auftrag/git.mjs";
import { gleichwertigGemeldet } from "./auftrag/gleichwertig.mjs";
import { nimmSperreAuchFuerKindprozesse } from "./schwerlauf/sperre.mjs";
import { kindprozesseInEigenemTempOrdner } from "./temp-ordner.mjs";
import { bestaetige, bestaetigt, bilanz } from "./mutationspruefung/bestaetigung.mjs";
import { gruppen } from "./mutationspruefung/gruppen.mjs";
import { anteile, anteilig, aufteilen, einheitName, matrix, pruefsumme, uebrige } from "./mutationspruefung/teile.mjs";
import { testumbauPruefung } from "./mutationspruefung/testumbau.mjs";
import { vorlageEinstellen } from "./mutationspruefung/vorlage.mjs";
import { GELOESCHT, loeschprobe } from "./mutationspruefung/zeilen-loeschen.mjs";
import { inhalt, umbenennungen } from "./umbenennung.mjs";

const KONFIGURATIONSDATEI = fileURLToPath(new URL("../stryker.config.json", import.meta.url));
const { $schema: _schema, ...KONFIGURATION } = JSON.parse(readFileSync(KONFIGURATIONSDATEI, "utf8"));
const WURZEL = cwd();
const SANDBOXORDNER = ".mutationspruefung";
const BANK = "regression";
const QUELLDATEI = /^src\/.+\.[cm]?[jt]s$/;
const TESTDATEI = /^test\/.+\.test\.[cm]?[jt]s$/;
const GRAPH_WURZELN = ["src", "test"];
const CRUISE_OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const DIFF_ALS_TEXT = ["diff", "--text", "-U0", "--no-renames", "--no-color", "--no-ext-diff"];
const DIFF_KOPF = "diff --git ";
const DATEIKOPF = { neu: /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/, alt: /^--- (?:a\/(.+)|\/dev\/null)$/ };
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const UEBERLEBT = "Survived";
const ABGESCHALTET = new Set(["Ignored", "CheckFailed"]);
const KEINE_TESTDATEI = "keine Testdatei erreicht die Datei";
const UEBERLEBEND = new Set([UEBERLEBT, "NoCoverage", ...ABGESCHALTET]);
const ABSCHALTUNG = /Stryker disable /;
const ABSCHALTKOMMENTAR = "Kommentar „Stryker disable“";
const ZUSTANDSBEREICH = [".", ":(exclude)tools/mutationspruefung.mjs", ":(exclude)tools/mutationspruefung/"];
const STRYKER_ZUSTAND = [/__stryker|stryker_|stry(?:mutact|cov|ns)_|active_?mutant|mutant__/i, /STRYKER/];
const ZUSTAND_VERSTOSS = "Verstoß: Zeile fragt Strykers Zustand ab, ein Test darf nicht erkennen, ob ein Mutant aktiv ist";
const ABSCHALTUNG_VERSTOSS =
  "Hinweis: von Stryker abgeschaltet, Mutant bleibt Verstoß; Abschaltung entfernen, Code vereinfachen oder Test schreiben, sonst Paket anhalten und Betreuung fragen";
const ZEITUEBERSCHREITUNG = "Timeout";
const ZEITFAKTOR_WIEDERHOLUNG = 3;
const BESTAETIGUNGSLAUF = " im Bestätigungslauf";
const BESTAETIGUNG = "Bestätigung";
const GLEICHZEITIG = KONFIGURATION.concurrency;
const ABGELEHNT = "rejected";
const LEERRAUM = /\s+/g;
const UMBAU_ZEILE = "^Art: umbau$";
const AUFTRAGSWEG = /^Auftrag: [^\s/]+\/\S+$/m;
const GLEICHWERTIG_ANGENOMMEN = "Hinweis: als gleichwertig angenommen";
const KURZ = 7;
const MS_JE_SEKUNDE = 1000;
const MAX_GIT_AUSGABE = 268_435_456;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const GANZ = { anteil: 1, von: 1 };
const TEILANGABEN = 3;
const BETRIEBSARTEN_HOECHSTENS = 1;
const ERGEBNISDATEI = /\.json$/;
const AUFRUF =
  "Aufruf: node tools/mutationspruefung.mjs --basis <commit> [--alter-stand | --testumbau] [--gleichwertig <mutant>] [--plan <datei> | --teil <n> --teile <anzahl> --ergebnis <datei> | --urteil <ordner>]";

function git(args, verzeichnis = cwd()) {
  const lauf = spawnSync("git", args, { cwd: verzeichnis, encoding: "utf8", maxBuffer: MAX_GIT_AUSGABE });
  if (lauf.status !== 0) throw new Error(`git ${args.join(" ")}: ${lauf.stderr.trim()}`);
  return lauf.stdout;
}

function eigenerOrdner(wurzel) {
  const ordner = join(wurzel, SANDBOXORDNER);
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, ".gitignore"), "*\n");
  return ordner;
}

function arbeitsverzeichnis(praefix) {
  return mkdtempSync(join(eigenerOrdner(WURZEL), praefix));
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

async function importierer() {
  const { output } = await cruise(GRAPH_WURZELN, CRUISE_OPTIONEN);
  const nachZiel = new Map();
  for (const { source, dependencies } of output.modules) {
    for (const { resolved } of dependencies) nachZiel.set(resolved, [...(nachZiel.get(resolved) ?? []), source]);
  }
  return nachZiel;
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
  eigenerOrdner(cwd());
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

async function welle(datei, zeilen, testgruppen) {
  const concurrency = Math.max(1, Math.floor(GLEICHZEITIG / testgruppen.length));
  const laeufe = await Promise.allSettled(testgruppen.map((tests) => gruppenlauf({ datei, zeilen, tests, concurrency })));
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
  const zweite = await durchgang(datei, offen.map((eintrag) => eintrag.zeilen), uebrige);
  return vereine(ergebnisse, [zweite]);
}

function testauswahl(datei, nachZiel) {
  const { direkt, alle } = erreichendeTests(datei, nachZiel);
  return { erste: direkt.length > 0 ? direkt : alle, alle };
}

async function pruefeDatei(datei, zeilen, { nachZiel, loeschung, anteil }) {
  const auswahl = testauswahl(datei, nachZiel);
  if (auswahl.alle.length === 0) {
    return zeilen.map(([von]) => ({ schluessel: `${datei}:${von} ${KEINE_TESTDATEI}`, status: "NoCoverage", art: KEINE_TESTDATEI }));
  }
  const tests = anteilig(auswahl, anteil);
  const ergebnisse = await mutantenproben(datei, zeilen, tests);
  if (loeschung === null) return ergebnisse;
  return [...ergebnisse, ...loeschung.pruefe({ datei, zeilen, ergebnisse, tests })];
}

function alterStand(commit) {
  const verzeichnis = arbeitsverzeichnis("alter-stand-");
  const entferne = legeWorktreeAn(commit, verzeichnis);
  chdir(verzeichnis);
  return () => {
    chdir(WURZEL);
    entferne();
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
  for (const datei of [...zeilen.keys()]) {
    const meldung = await gleicherLaufzeitcode(datei, pruefung, umbenannt);
    if (meldung === undefined) continue;
    zeilen.delete(datei);
    console.log(meldung);
  }
  return zeilen;
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

async function messe(einheiten, { nachZiel, auswahl, seite }) {
  const nachDatei = new Map(einheiten.map((einheit) => [einheit.datei, einheit]));
  const ergebnisse = auswahl.flatMap(({ datei, anteil }) => (anteil === 1 ? nachDatei.get(datei).abgeschaltet : []));
  const gemessen = auswahl.filter(({ datei }) => nachDatei.get(datei).bereiche !== undefined);
  if (gemessen.length === 0) return ergebnisse;
  const loeschung = seite === "neu" ? loeschprobe(() => arbeitsverzeichnis("loeschprobe-")) : null;
  try {
    for (const anteil of gemessen) {
      ergebnisse.push(...(await pruefeDatei(anteil.datei, nachDatei.get(anteil.datei).bereiche, { nachZiel, loeschung, anteil })));
    }
    return ergebnisse;
  } finally {
    loeschung?.abbauen();
  }
}

function mutiere(pruefung, auswahl = null) {
  return imStand(pruefung, (einheiten, nachZiel) =>
    messe(einheiten, { nachZiel, seite: pruefung.seite, auswahl: auswahl ?? einheiten.map(({ datei }) => ({ datei, ...GANZ })) }),
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

function zustandszugriffe({ von, seite }) {
  if (seite !== "neu") return [];
  const diff = git([...DIFF_ALS_TEXT, von, "--", ...ZUSTANDSBEREICH]);
  return [...hinzugefuegt(diff), ...unverfolgteZeilen()]
    .filter(({ text }) => STRYKER_ZUSTAND.some((muster) => muster.test(text)))
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

function angenommen({ schluessel, status, art }, gleichwertige) {
  return gleichwertige.has(schluessel) && !ABGESCHALTET.has(status) && art !== KEINE_TESTDATEI;
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
  for (const { schluessel } of ueberlebende) console.log(`Verstoß: Mutant überlebt: ${schluessel}`);
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
    await imStand(stand, (bestand, nachZiel) => {
      for (const { datei, bereiche } of bestand) {
        const von = bereiche === undefined ? 1 : anteile(testauswahl(datei, nachZiel).erste.length);
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

async function zweiteStufe(datei, ergebnisse, { nachZiel, loeschung }) {
  const uebrig = uebrige(testauswahl(datei, nachZiel));
  const offen = ergebnisse.filter((eintrag) => eintrag.schluessel.startsWith(`${datei}:`) && ueberlebt(eintrag));
  if (uebrig.length === 0 || offen.length === 0) return ergebnisse;
  const mutanten = offen.filter(({ art }) => art !== GELOESCHT && art !== ABSCHALTKOMMENTAR);
  const vereint = mutanten.length === 0 ? ergebnisse : vereine(ergebnisse, [await durchgang(datei, mutanten.map(({ zeilen }) => zeilen), uebrig)]);
  const geloescht = offen.filter(({ art }) => art === GELOESCHT);
  if (loeschung === null || geloescht.length === 0) return vereint;
  const nachgefasst = new Map(loeschung.nachfassen({ datei, eintraege: geloescht, uebrige: uebrig }).map((eintrag) => [eintrag.schluessel, eintrag]));
  return vereint.map((eintrag) => nachgefasst.get(eintrag.schluessel) ?? eintrag);
}

function nachfassen(stand, dateien, ergebnisse) {
  if (dateien.length === 0) return ergebnisse;
  return imStand(stand, async (_bestand, nachZiel) => {
    const loeschung = stand.seite === "neu" ? loeschprobe(() => arbeitsverzeichnis("loeschprobe-")) : null;
    try {
      let vereint = ergebnisse;
      for (const datei of dateien) vereint = await zweiteStufe(datei, vereint, { nachZiel, loeschung });
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

function aufrufGueltig(values) {
  const teilAufruf = [values.teil, values.teile, values.ergebnis].filter((wert) => wert !== undefined).length;
  const betriebsarten = [values.plan, values.teil, values.urteil].filter((wert) => wert !== undefined).length + Number(values.testumbau);
  const doppelt = values.testumbau && (values["alter-stand"] || values.gleichwertig.length > 0);
  return values.basis !== undefined && [0, TEILANGABEN].includes(teilAufruf) && betriebsarten <= BETRIEBSARTEN_HOECHSTENS && !doppelt;
}

async function main() {
  const { values } = parseArgs({
    options: {
      basis: { type: "string" },
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

try {
  process.exitCode = await main();
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
}
