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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPRESSIONS_REL = "eslint-suppressions.json";
const PRUNE_COMMAND = "npx eslint --prune-suppressions";
const LOG_PREFIX = "[check-staged-suppressions]";
// process.argv[0]=node, [1]=Skriptpfad - die eigentlichen Argumente beginnen danach.
const CLI_ARGS_OFFSET = 2;

// Welche der vorgemerkten Dateien tragen noch Eintraege in den
// Unterdrueckungen? suppressions: geparstes eslint-suppressions.json
// (Datei -> Regelname -> { count }). Liefert pro Treffer die Datei und ihre
// Regeln samt Anzahl, in der Reihenfolge der Regeln aus der Vorlage.
export function findSuppressedStagedFiles({ stagedFiles, suppressions }) {
  const offenders = [];
  for (const file of stagedFiles) {
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

function runCli() {
  const stagedFiles = process.argv.slice(CLI_ARGS_OFFSET);
  if (stagedFiles.length === 0) return 0;
  const suppressionsPath = resolve(REPO_ROOT, SUPPRESSIONS_REL);
  const suppressions = JSON.parse(readFileSync(suppressionsPath, "utf8"));
  const offenders = findSuppressedStagedFiles({ stagedFiles, suppressions });
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
