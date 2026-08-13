#!/usr/bin/env node
// Aufraeum-Gate fuer den pre-commit-Hook: eslint-suppressions.json friert pro
// Datei UND Regel nur eine ANZAHL ein, keine Einzel-Fundstellen. Wird in einer
// Bestandsdatei ein alter Verstoss behoben und an anderer Stelle ein neuer
// derselben Regel eingebaut, bleibt die Zahl gleich - der neue Verstoss wird
// still geschluckt (siehe CLAUDE.md). Gegenmassnahme: eine vorgemerkte Datei,
// die noch Eintraege traegt, wird abgelehnt. Wer sie anfasst, raeumt vorher auf.
//
// Reine, seiteneffektfreie Auswahl-Logik (findSuppressedStagedFiles); der
// CLI-Teil (argv/exit) sitzt dahinter. Testbarkeit auf einer Attrappe statt
// der echten, ueber 700 Dateien grossen Unterdrueckungsdatei.
// Aufruf: node scripts/check-staged-suppressions.js <datei1> <datei2> ...
//         (Pfade repo-root-relativ, wie sie "git diff --name-only" liefert)
//
// ALTLAST-LISTE (eslint-legacy-exceptions.json, neben der Unterdrueckungsdatei):
// der EINZIGE Ausweg, wenn eine Bestandsdatei angefasst werden muss, deren
// Aufraeumen ein eigener Umbau waere. "git commit --no-verify" ist verboten -
// eine stille Umgehung macht das ganze Gate wertlos. Die Liste bildet
// Dateipfad -> { reason, date } ab: reason nennt, warum die Datei noch nicht
// geraeumt ist, date (YYYY-MM-DD) wann die Ausnahme entstand. Fehlt eines von
// beidem oder ist es leer/kein Kalenderdatum, entschuldigt der Eintrag nichts -
// die Liste ist eine bewusste Ausnahme, kein Abstellgleis. Auf die Liste
// gehoert nur ECHTE Schuld; ist die Unterdrueckung eine Fehlklassifikation der
// Regel, wird die REGEL korrigiert (siehe .fortschritt.md, D9-D11).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPRESSIONS_REL = "eslint-suppressions.json";
const LEGACY_EXCEPTIONS_REL = "eslint-legacy-exceptions.json";
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRUNE_COMMAND = "npx eslint --prune-suppressions";
const LOG_PREFIX = "[check-staged-suppressions]";
// process.argv[0]=node, [1]=Skriptpfad - die eigentlichen Argumente beginnen danach.
const CLI_ARGS_OFFSET = 2;

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Kalenderdatum im Format YYYY-MM-DD. Date.parse faengt zusaetzlich, was zwar
// zur Form passt, aber kein Tag im Kalender ist (etwa 2026-02-31).
function isCalendarDate(value) {
  if (!isNonEmptyText(value) || !CALENDAR_DATE_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// Entschuldigt dieser Altlast-Eintrag die Datei? Nur mit Grund UND Datum -
// ein halb gefuehrter Eintrag ist ein Abstellgleis und zaehlt nicht.
function excusesLegacy(entry) {
  if (!entry) return false;
  return isNonEmptyText(entry.reason) && isCalendarDate(entry.date);
}

// Welche der vorgemerkten Dateien tragen noch Eintraege in den
// Unterdrueckungen? suppressions: geparstes eslint-suppressions.json
// (Datei -> Regelname -> { count }). legacyExceptions: geparste Altlast-Liste
// (Datei -> { reason, date }), siehe Kopfkommentar. Liefert pro Treffer die
// Datei und ihre Regeln samt Anzahl, in der Reihenfolge der Regeln aus der
// Vorlage.
export function findSuppressedStagedFiles({
  stagedFiles,
  suppressions,
  legacyExceptions = {},
}) {
  const offenders = [];
  for (const file of stagedFiles) {
    if (excusesLegacy(legacyExceptions[file])) continue;
    const rulesForFile = suppressions[file];
    if (!rulesForFile) continue;
    const ruleCounts = Object.entries(rulesForFile).map(([rule, entry]) => ({
      rule,
      count: entry.count,
    }));
    if (ruleCounts.length > 0) offenders.push({ file, ruleCounts });
  }
  return offenders;
}

function formatOffender({ file, ruleCounts }) {
  const rulesText = ruleCounts
    .map(({ rule, count }) => `${rule}: ${count}`)
    .join(", ");
  return `  ${file} -> ${rulesText}`;
}

function printReport(offenders) {
  console.error("");
  console.error(
    `${LOG_PREFIX} Commit abgebrochen: folgende vorgemerkte Dateien tragen`,
  );
  console.error(`${LOG_PREFIX} noch Eintraege in ${SUPPRESSIONS_REL}:`);
  for (const offender of offenders) console.error(formatOffender(offender));
  console.error("");
  console.error(
    `${LOG_PREFIX} Verstoesse beheben, danach: ${PRUNE_COMMAND}`,
  );
}

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

// Einlesen der Altlast-Liste. Der Leser haengt an einem Parameter, damit der
// Pfad "Liste wird geladen" ohne Dateisystem pruefbar ist. Fehlt die Datei
// oder ist sie kaputt, wirft das Einlesen - der CLI-Teil bricht dann
// fail-closed ab, statt stillschweigend ohne Liste weiterzulaufen.
export function loadLegacyExceptions(readText = readRepoFile) {
  return JSON.parse(readText(LEGACY_EXCEPTIONS_REL));
}

function runCli() {
  const stagedFiles = process.argv.slice(CLI_ARGS_OFFSET);
  if (stagedFiles.length === 0) return 0;
  const suppressions = JSON.parse(readRepoFile(SUPPRESSIONS_REL));
  const offenders = findSuppressedStagedFiles({
    stagedFiles,
    suppressions,
    legacyExceptions: loadLegacyExceptions(),
  });
  if (offenders.length === 0) return 0;
  printReport(offenders);
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
