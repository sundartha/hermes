import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { chdir, cwd } from "node:process";
import { parseArgs } from "node:util";

import { Stryker } from "@stryker-mutator/core";
import { cruise } from "dependency-cruiser";

import { patternFlagsFor } from "../test/testbaenke-run.mjs";
import { loeschprobe } from "./mutationspruefung/zeilen-loeschen.mjs";

const { $schema: _schema, ...KONFIGURATION } = JSON.parse(
  readFileSync(new URL("../stryker.config.json", import.meta.url), "utf8"),
);
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
const UEBERLEBEND = new Set(["Survived", "NoCoverage"]);
const ZEITUEBERSCHREITUNG = "Timeout";
const ZEITFAKTOR_WIEDERHOLUNG = 3;
const LEERRAUM = /\s+/g;
const UMBAU_ZEILE = "^Art: umbau$";
const GLEICHWERTIG = /^Gleichwertig: (.+)$/gm;
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

async function stryker({ datei, zeilen, tests, faktor }) {
  const tempDirName = arbeitsverzeichnis("mutation-");
  const beginn = Date.now();
  try {
    const optionen = {
      ...KONFIGURATION,
      mutate: zeilen.map(([von, bis]) => `${datei}:${von}-${bis}`),
      tap: { ...KONFIGURATION.tap, testFiles: tests, nodeArgs: [...KONFIGURATION.tap.nodeArgs, ...patternFlagsFor(BANK)] },
      timeoutMS: KONFIGURATION.timeoutMS * faktor,
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

async function durchgang(datei, zeilen, tests) {
  const ergebnisse = await stryker({ datei, zeilen, tests, faktor: 1 });
  const zeitueber = ergebnisse.filter(({ status }) => status === ZEITUEBERSCHREITUNG);
  if (zeitueber.length === 0) return ergebnisse;
  const wiederholt = await stryker({
    datei,
    zeilen: zeitueber.map((eintrag) => eintrag.zeilen),
    tests,
    faktor: ZEITFAKTOR_WIEDERHOLUNG,
  });
  return ersetze(ergebnisse, wiederholt, zeitueber);
}

async function mutantenproben(datei, zeilen, { erste, alle }) {
  const ergebnisse = await durchgang(datei, zeilen, erste);
  const offen = ergebnisse.filter(ueberlebt);
  if (offen.length === 0 || erste.length === alle.length) return ergebnisse;
  const zweite = await durchgang(datei, offen.map((eintrag) => eintrag.zeilen), alle);
  return ersetze(ergebnisse, zweite, offen);
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

async function mutiere({ von, bis, seite }) {
  const diff = git(["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", von, ...(bis ? [bis] : []), "--", "src/"]);
  const zeilen = geaenderteZeilen(diff, seite);
  if (zeilen.size === 0) return [];
  const zurueck = seite === "alt" ? alterStand(von) : null;
  const loeschung = seite === "neu" ? loeschprobe(() => arbeitsverzeichnis("loeschprobe-")) : null;
  try {
    const nachZiel = await importierer();
    const ergebnisse = [];
    for (const [datei, bereiche] of zeilen) ergebnisse.push(...(await pruefeDatei(datei, bereiche, { nachZiel, loeschung })));
    return ergebnisse;
  } finally {
    zurueck?.();
    loeschung?.abbauen();
  }
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

async function pruefe(pruefung, gleichwertig) {
  const ergebnisse = await mutiere(pruefung);
  const ueberlebend = ergebnisse.filter(ueberlebt);
  const ueberlebende = ueberlebend.filter(({ schluessel }) => !gleichwertig.has(schluessel));
  for (const { schluessel } of ueberlebend.filter((eintrag) => !ueberlebende.includes(eintrag))) {
    console.log(`Hinweis: als gleichwertig gemeldet: ${schluessel}`);
  }
  for (const { schluessel } of ueberlebende) console.log(`Verstoß: Mutant überlebt: ${schluessel}`);
  console.log(urteil(pruefung, ergebnisse, ueberlebende));
  return ueberlebende.length;
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
  const gleichwertig = new Set([...values.gleichwertig, ...gemeldet(values.basis)]);
  const pruefungen = values["alter-stand"]
    ? [{ von: values.basis, seite: "alt" }]
    : [{ von: values.basis, seite: "neu" }, ...umbauCommits(values.basis).map((commit) => ({ von: `${commit}^`, bis: commit, seite: "alt" }))];
  let ueberlebende = 0;
  for (const pruefung of pruefungen) ueberlebende += await pruefe(pruefung, gleichwertig);
  return ueberlebende === 0 ? EXIT_GRUEN : EXIT_ROT;
}

try {
  process.exitCode = await main();
} catch (fehler) {
  console.error(`Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ABBRUCH;
}
