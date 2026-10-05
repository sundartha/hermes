import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { chdir, cwd } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Stryker } from "@stryker-mutator/core";
import { cruise } from "dependency-cruiser";

import { patternFlagsFor } from "../test/testbaenke-run.mjs";
import { gruppen } from "./mutationspruefung/gruppen.mjs";
import { loeschprobe } from "./mutationspruefung/zeilen-loeschen.mjs";

const KONFIGURATIONSDATEI = fileURLToPath(new URL("../stryker.config.json", import.meta.url));
const { $schema: _schema, ...KONFIGURATION } = JSON.parse(readFileSync(KONFIGURATIONSDATEI, "utf8"));
const WURZEL = cwd();
const ARBEITSVERZEICHNIS = join(WURZEL, "node_modules", ".cache", "mutationspruefung");
const BANK = "regression";
const QUELLDATEI = /^src\/.+\.[cm]?js$/;
const TESTDATEI = /^test\/.+\.test\.[cm]?js$/;
const GRAPH_WURZELN = ["src", "test"];
const CRUISE_OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const DIFF_KOPF = "diff --git ";
const DATEIKOPF = { neu: /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/, alt: /^--- (?:a\/(.+)|\/dev\/null)$/ };
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const UEBERLEBT = "Survived";
const ABGESCHALTET = new Set(["Ignored", "CheckFailed"]);
const UEBERLEBEND = new Set([UEBERLEBT, "NoCoverage", ...ABGESCHALTET]);
const ABSCHALTUNG = /Stryker disable /;
const ABSCHALTKOMMENTAR = "Kommentar „Stryker disable“";
const ZUSTANDSORDNER = ["src/", "test/"];
const STRYKER_ZUSTAND = [/__stryker|stryker_|stry(?:mutact|cov|ns)_|active_?mutant|mutant__/i, /STRYKER/];
const ZUSTAND_VERSTOSS = "Verstoß: Zeile fragt Strykers Zustand ab, ein Test darf nicht erkennen, ob ein Mutant aktiv ist";
const ABSCHALTUNG_VERSTOSS =
  "Hinweis: von Stryker abgeschaltet, Mutant bleibt Verstoß; Abschaltung entfernen, Code vereinfachen oder Test schreiben, sonst Paket anhalten und Betreuung fragen";
const ZEITUEBERSCHREITUNG = "Timeout";
const ZEITFAKTOR_WIEDERHOLUNG = 3;
const GLEICHZEITIG = KONFIGURATION.concurrency;
const ABGELEHNT = "rejected";
const LEERRAUM = /\s+/g;
const UMBAU_ZEILE = "^Art: umbau$";
const GLEICHWERTIG = /^Gleichwertig: (.+)$/gm;
const GLEICHWERTIG_WIRKUNGSLOS =
  "Hinweis: als gleichwertig gemeldet, wirkungslos, Mutant bleibt Verstoß; Code vereinfachen oder Test schreiben, sonst Paket anhalten und Betreuung fragen";
const KEINE_FREIGABEN = new Set();
const KURZ = 7;
const MS_JE_SEKUNDE = 1000;
const MAX_GIT_AUSGABE = 268_435_456;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const AUFRUF =
  "Aufruf: node tools/mutationspruefung.mjs --basis <commit> [--alter-stand] [--gleichwertig <mutant>]";

function git(args, verzeichnis = cwd()) {
  const lauf = spawnSync("git", args, { cwd: verzeichnis, encoding: "utf8", maxBuffer: MAX_GIT_AUSGABE });
  if (lauf.status !== 0) throw new Error(`git ${args.join(" ")}: ${lauf.stderr.trim()}`);
  return lauf.stdout;
}

function arbeitsverzeichnis(praefix) {
  mkdirSync(ARBEITSVERZEICHNIS, { recursive: true });
  return mkdtempSync(join(ARBEITSVERZEICHNIS, praefix));
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

function mutant({ fileName, location, mutatorName, replacement, status }) {
  const datei = relative(cwd(), fileName);
  const { line, column } = location.start;
  const ersatz = (replacement ?? "").replace(LEERRAUM, " ");
  const schluessel = `${datei}:${line}:${column} ${mutatorName} → ${ersatz}`;
  return { schluessel, status, zeilen: [line, location.end.line], art: mutatorName };
}

async function stryker({ datei, zeilen, tests, faktor, concurrency }) {
  const tempDirName = arbeitsverzeichnis("mutation-");
  const beginn = Date.now();
  try {
    const optionen = {
      ...KONFIGURATION,
      mutate: zeilen.map(([von, bis]) => `${datei}:${von}-${bis}`),
      tap: { ...KONFIGURATION.tap, testFiles: tests, nodeArgs: [...KONFIGURATION.tap.nodeArgs, ...patternFlagsFor(BANK)] },
      timeoutMS: KONFIGURATION.timeoutMS * faktor,
      configFile: KONFIGURATIONSDATEI,
      concurrency,
      tempDirName,
    };
    const ergebnisse = (await new Stryker(optionen).runMutationTest()).map(mutant);
    const sekunden = Math.round((Date.now() - beginn) / MS_JE_SEKUNDE);
    console.log(`${datei}: ${ergebnisse.length} Mutanten gegen ${tests.length} Testdateien in ${sekunden} s`);
    return ergebnisse;
  } finally {
    rmSync(tempDirName, { recursive: true, force: true });
  }
}

function ueberlebt({ status }) {
  return UEBERLEBEND.has(status);
}

function ersetze(ergebnisse, neu, betroffen) {
  const nachSchluessel = new Map(neu.map((eintrag) => [eintrag.schluessel, eintrag]));
  return ergebnisse.map((eintrag) => (betroffen.includes(eintrag) && nachSchluessel.get(eintrag.schluessel)) || eintrag);
}

async function gruppenlauf(lauf) {
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

function staerker(eintrag, anderer) {
  if (anderer === undefined || !ueberlebt(eintrag)) return eintrag;
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

async function pruefeDatei(datei, zeilen, { nachZiel, loeschung }) {
  const { direkt, alle } = erreichendeTests(datei, nachZiel);
  if (alle.length === 0) {
    return zeilen.map(([von]) => ({ schluessel: `${datei}:${von} keine Testdatei erreicht die Datei`, status: "NoCoverage" }));
  }
  const tests = { erste: direkt.length > 0 ? direkt : alle, alle };
  const ergebnisse = await mutantenproben(datei, zeilen, tests);
  if (loeschung === null) return ergebnisse;
  return [...ergebnisse, ...loeschung.pruefe({ datei, zeilen, ergebnisse, tests })];
}

function alterStand(commit) {
  const verzeichnis = arbeitsverzeichnis("alter-stand-");
  git(["worktree", "add", "--detach", "-q", verzeichnis, commit]);
  chdir(verzeichnis);
  return () => {
    chdir(WURZEL);
    git(["worktree", "remove", "--force", verzeichnis]);
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

async function mutiere({ von, bis, seite }) {
  const diff = git(["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", von, ...(bis ? [bis] : []), "--", "src/"]);
  const zeilen = geaenderteZeilen(diff, seite);
  if (zeilen.size === 0) return [];
  const zurueck = seite === "alt" ? alterStand(von) : null;
  const loeschung = seite === "neu" ? loeschprobe(() => arbeitsverzeichnis("loeschprobe-")) : null;
  try {
    const nachZiel = await importierer();
    const ergebnisse = seite === "neu" ? [...zeilen].flatMap(([datei, bereiche]) => abschaltungen(datei, bereiche)) : [];
    for (const [datei, bereiche] of zeilen) ergebnisse.push(...(await pruefeDatei(datei, bereiche, { nachZiel, loeschung })));
    return ergebnisse;
  } finally {
    zurueck?.();
    loeschung?.abbauen();
  }
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
  const dateien = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...ZUSTANDSORDNER]).split("\0").filter(Boolean);
  return dateien.flatMap((datei) =>
    readFileSync(datei, "utf8").split("\n").map((text, index) => ({ datei, zeile: index + 1, text })),
  );
}

function zustandszugriffe({ von, seite }) {
  if (seite !== "neu") return [];
  const diff = git(["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", von, "--", ...ZUSTANDSORDNER]);
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

async function pruefe(pruefung, { gemeldete, freigegebene }) {
  const zugriffe = zustandszugriffe(pruefung);
  const ergebnisse = await mutiere(pruefung);
  const ueberlebende = ergebnisse.filter(ueberlebt).filter(({ schluessel }) => !freigegebene.has(schluessel));
  for (const { schluessel } of ueberlebende.filter((eintrag) => gemeldete.has(eintrag.schluessel))) {
    console.log(`${GLEICHWERTIG_WIRKUNGSLOS}: ${schluessel}`);
  }
  for (const { schluessel } of ueberlebende.filter(({ status }) => ABGESCHALTET.has(status))) {
    console.log(`${ABSCHALTUNG_VERSTOSS}: ${schluessel}`);
  }
  for (const { schluessel } of ueberlebende) console.log(`Verstoß: Mutant überlebt: ${schluessel}`);
  for (const stelle of zugriffe) console.log(`${ZUSTAND_VERSTOSS}: ${stelle}`);
  console.log(gesamturteil(pruefung, { ergebnisse, ueberlebende, zugriffe }));
  return ueberlebende.length + zugriffe.length;
}

function umbauCommits(basis) {
  const log = git(["log", "--format=%H", "-E", `--grep=${UMBAU_ZEILE}`, `${basis}..HEAD`]);
  return log.split("\n").filter(Boolean);
}

function gemeldet(basis) {
  return [...git(["log", "--format=%B", `${basis}..HEAD`]).matchAll(GLEICHWERTIG)].map(([, schluessel]) => schluessel.trim());
}

async function main() {
  const { values } = parseArgs({
    options: {
      basis: { type: "string" },
      "alter-stand": { type: "boolean", default: false },
      gleichwertig: { type: "string", multiple: true, default: [] },
    },
  });
  if (values.basis === undefined) {
    console.error(AUFRUF);
    return EXIT_ABBRUCH;
  }
  const meldungen = {
    gemeldete: new Set([...values.gleichwertig, ...gemeldet(values.basis)]),
    freigegebene: KEINE_FREIGABEN,
  };
  const pruefungen = values["alter-stand"]
    ? [{ von: values.basis, seite: "alt" }]
    : [{ von: values.basis, seite: "neu" }, ...umbauCommits(values.basis).map((commit) => ({ von: `${commit}^`, bis: commit, seite: "alt" }))];
  let ueberlebende = 0;
  for (const pruefung of pruefungen) ueberlebende += await pruefe(pruefung, meldungen);
  return ueberlebende === 0 ? EXIT_GRUEN : EXIT_ROT;
}

try {
  process.exitCode = await main();
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
}
