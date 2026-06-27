#!/usr/bin/env node
// Token-Pull-Disziplin (MCP-UI P5): erkennt fail-closed Drift zwischen der
// kanonischen Token-Quelle (apps/web/src/styles/tokens/) und ihrer
// selbst-tragenden Kopie (design-system/_shared/tokens.css), und prueft die
// Struktur-Invarianten der iframe-isolierten Widget-/Mockup-HTMLs.
//
// Warum Hash-Manifest statt 1:1-Repro: die Kopie ist KEINE deterministische
// Konkatenation der Quelle (Kommentare entfernt, --hero-*-Alias-Kette
// teil-inlined, Scope :root -> .on-dark umgeschrieben). Ein Lock-File friert
// daher die Soll-Hashes BEIDER Seiten ein; der Check meldet die driftende
// Datei, ohne die manuelle Transformation nachbilden zu muessen. Das faengt
// Drift auf beiden Seiten (Quelle geaendert ohne Kopie nachzuziehen ODER Kopie
// hand-editiert). index.css ist bewusst NICHT im Manifest: es traegt keine
// Token-Werte (nur @import + Reset) und ist nicht Teil der Kopie -- pinnte man
// es, floesse jede Reset-Aenderung als falscher Drift-Alarm ein.
//
// Reine, seiteneffektfreie Pruef-Funktionen; der CLI-Teil (exit/console) sitzt
// hinter dem main-Guard. Nur Node-Builtins, kein Dependency, kein Build-Step.
// Aufruf:  node scripts/check-token-sync.js          (prueft, exit 0/1)
//          node scripts/check-token-sync.js --write   (friert Soll-Hashes neu)
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HASH_ALGO = "sha256";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_REL = "design-system/_shared/tokens.lock";
const CANONICAL_COPY_REL = "design-system/_shared/tokens.css";
// Quelle der Wahrheit: rohe + semantische Tokens (Light/App) plus Hero (Dark).
// index.css bewusst nicht (keine Token-Werte, siehe Datei-Header oben).
const SOURCE_TOKEN_RELS = [
  "apps/web/src/styles/tokens/primitives.css",
  "apps/web/src/styles/tokens/semantic.css",
  "apps/web/src/styles/tokens/hero.css",
];
const HASHED_RELS = [...SOURCE_TOKEN_RELS, CANONICAL_COPY_REL];
const MCP_MOCKUP_DIR = "design-system/mcp";
const WIDGET_DIR = "src/ui/widgets";
const HTML_EXT = ".html";
const DSCARD_MARKER = "@dsCard";
const IMPORT_AT_RULE = "@import";
const JSON_INDENT = 2;
const WRITE_FLAG = "--write";
const LOG_PREFIX = "[check-token-sync]";
const LOCK_COMMENT =
  "Auto-generiert via scripts/check-token-sync.js --write. Soll-Hashes der " +
  "Token-Quelle (apps/web/src/styles/tokens/) + kanonischer Kopie " +
  "(design-system/_shared/tokens.css). Bei legitimer Token-Aenderung: Kopie " +
  "nachziehen, dann --write, dann committen.";

// Roh-Bytes einer Datei hashen. Wirft bei fehlender Datei (ENOENT); jeder
// Aufrufer faengt das und macht daraus ein fail-closed-Problem.
function hashFile(absPath) {
  return createHash(HASH_ALGO).update(readFileSync(absPath)).digest("hex");
}

// Einheitliche fail-closed-Meldung fuer eine fehlende Pflichtdatei. Geteilt von
// Hash-Drift- und Struktur-Pruefungen, damit die Meldung nicht dupliziert wird.
function fileMissingProblem(rel) {
  return `Datei fehlt (fail-closed): ${rel}`;
}

// Liest eine Textdatei; fehlt sie, wird das zum fail-closed-Problem und null
// zurueckgegeben (der Aufrufer bricht dann ab). Buendelt das in mehreren
// Struktur-Pruefungen wiederkehrende Lese-/Fehler-Muster (verpasste Abstraktion).
function readTextOrProblem(rootDir, rel, problems) {
  try {
    return readFileSync(join(rootDir, rel), "utf8");
  } catch {
    problems.push(fileMissingProblem(rel));
    return null;
  }
}

// Listet die HTML-Dateien eines Verzeichnisses als rel-Pfade. Fehlt das
// Verzeichnis, ist das ein fail-closed-Problem (kein stiller leerer Lauf).
function listHtmlRels(rootDir, relDir, problems) {
  const absDir = join(rootDir, relDir);
  if (!existsSync(absDir)) {
    problems.push(`Verzeichnis fehlt (fail-closed): ${relDir}`);
    return [];
  }
  return readdirSync(absDir)
    .filter((name) => name.endsWith(HTML_EXT))
    .map((name) => `${relDir}/${name}`);
}

// Liest+parst das Lock-File. Fehlt es oder ist es kaputt -> fail-closed (null).
function readLock(rootDir, problems) {
  const absLock = join(rootDir, LOCK_REL);
  if (!existsSync(absLock)) {
    problems.push(`Lock-Datei fehlt (fail-closed): ${LOCK_REL}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(absLock, "utf8"));
  } catch {
    problems.push(`Lock-Datei nicht parsebar (fail-closed): ${LOCK_REL}`);
    return null;
  }
}

// Vergleicht die Ist-Hashes der gepinnten Dateien gegen die Soll-Hashes im Lock.
function checkHashDrift(rootDir, lock, problems) {
  const soll = lock.hashes || {};
  for (const rel of HASHED_RELS) {
    const expected = soll[rel];
    if (!expected) {
      problems.push(`Lock-Eintrag fehlt fuer ${rel} (Lock unvollstaendig)`);
      continue;
    }
    let actual;
    try {
      actual = hashFile(join(rootDir, rel));
    } catch {
      problems.push(fileMissingProblem(rel));
      continue;
    }
    if (actual !== expected) {
      problems.push(`${rel} driftet (Hash weicht vom Lock ab)`);
    }
  }
}

// Iframe-Sandbox-Verbot: kein @import in den isolierten Token-/Widget-/Mockup-
// HTMLs (Sandbox laedt sonst nichts nach -> stilloser Inhalt beim Nutzer).
function assertNoImport(rootDir, rel, problems) {
  const content = readTextOrProblem(rootDir, rel, problems);
  if (content === null) return;
  if (content.includes(IMPORT_AT_RULE)) {
    problems.push(`${rel} enthaelt ${IMPORT_AT_RULE} (Iframe-Sandbox-Verbot)`);
  }
}

// Katalog-Invariante: jedes Mockup traegt den @dsCard-Marker in Zeile 1.
function assertDsCardLine1(rootDir, rel, problems) {
  const content = readTextOrProblem(rootDir, rel, problems);
  if (content === null) return;
  const firstLine = content.split("\n", 1)[0];
  if (!firstLine.includes(DSCARD_MARKER)) {
    problems.push(`${rel} hat ${DSCARD_MARKER} nicht in Zeile 1`);
  }
}

// Orchestriert alle Pruefungen. Wirft NIE an den Aufrufer weiter -- jeder
// erwartbare Fehler wird zu einem Problem (fail-closed). ok = keine Probleme.
export function checkTokens({ rootDir = REPO_ROOT } = {}) {
  const problems = [];

  const lock = readLock(rootDir, problems);
  if (lock) checkHashDrift(rootDir, lock, problems);

  const mockupRels = listHtmlRels(rootDir, MCP_MOCKUP_DIR, problems);
  const widgetRels = listHtmlRels(rootDir, WIDGET_DIR, problems);
  const noImportRels = [CANONICAL_COPY_REL, ...mockupRels, ...widgetRels];
  for (const rel of noImportRels) assertNoImport(rootDir, rel, problems);

  for (const rel of mockupRels) assertDsCardLine1(rootDir, rel, problems);

  return { ok: problems.length === 0, problems };
}

// Friert den aktuellen Ist-Zustand als neue Soll-Hashes ein und schreibt das
// Lock-File (Nebeneffekt im Namen). Nur fuer legitime Token-Aenderungen.
export function writeTokenLock({ rootDir = REPO_ROOT } = {}) {
  const hashes = {};
  for (const rel of HASHED_RELS) hashes[rel] = hashFile(join(rootDir, rel));
  const lock = { _comment: LOCK_COMMENT, algo: HASH_ALGO, hashes };
  writeFileSync(
    join(rootDir, LOCK_REL),
    JSON.stringify(lock, null, JSON_INDENT) + "\n",
  );
  return lock;
}

// --- CLI (von der Logik getrennt, hinter main-Guard) ---
function runCli() {
  if (process.argv.includes(WRITE_FLAG)) {
    writeTokenLock({});
    console.log(`${LOG_PREFIX} Lock neu geschrieben: ${LOCK_REL}`);
    return 0;
  }
  const { ok, problems } = checkTokens({});
  if (ok) {
    console.log(`${LOG_PREFIX} OK - Tokens synchron, Invarianten erfuellt.`);
    return 0;
  }
  for (const problem of problems) console.error(`${LOG_PREFIX} ${problem}`);
  return 1;
}

const isMain =
  fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (isMain) {
  try {
    process.exit(runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${err.message}`);
    process.exit(1);
  }
}
