// Trennt den Regressionslauf ("npm test") vom Launch-Gate-Lauf ("npm run test:gates") des
// i18n-Launch-Testkatalogs (PLAN-I18N-TESTS.md). Beide Laeufe nutzen denselben Mechanismus:
// node:test --test-skip-pattern bzw. --test-name-pattern ueber das gemeinsame Katalog-Muster
// aus package.json ("config.i18nCatalogPattern") - jeder Katalogtest traegt seine ID am
// Namensanfang, ein neuer Test mit bestehendem Praefix landet ohne weiteren Handgriff im
// richtigen Lauf.
//
// Warum dieser Wrapper und nicht einfach "node --test <pattern-flag> test/*.test.js":
// node:test isoliert Mehrdatei-Laeufe standardmaessig pro Kindprozess (ein Prozess je Datei).
// Enthaelt eine Datei nach Anwendung des Musters KEINEN passenden Test mehr, meldet node
// trotzdem einen leeren "ok - test/<datei>.test.js"-Wrapper in der TAP-Summe - das ist kein
// echter Test, zaehlt aber in "# tests" mit. Bei ~400 Dateien verzerrt das die Summe massiv
// (empirisch gemessen: roh 2971 + 474 = 3445 statt der echten 3044). Dieses Skript zieht die
// Wrapper-Eintraege wieder ab, damit die ausgegebene Zahl der echten Testzahl entspricht.
//
// Sonderfall: eine tatsaechlich leere Testdatei (0 test()-Aufrufe insgesamt) erzeugt denselben
// Wrapper, aber OHNE vorangehende "1..0"-Planzeile (der Kindprozess hat nichts zu planen, weil
// die Datei leer ist - anders als eine Datei mit Tests, die alle durch das Muster
// herausgefiltert wurden). Dieser eine Fall wird dem Regressionslauf zugerechnet (dort zaehlt
// er wie im ungefilterten Volllauf als ein trivialer Testeintrag), im Gates-Lauf bleibt er
// ausgeschlossen.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const FILE_WRAPPER_LINE = /^# Subtest: test\/[^/\s]+\.test\.js$/;
const EMPTY_PLAN_LINE = '1..0';
const SUMMARY_LINE = /^# (tests|pass|fail) (\d+)$/;

function patternFlagFor(mode) {
  const { i18nCatalogPattern } = require('../package.json').config;
  return mode === 'gates'
    ? `--test-name-pattern=${i18nCatalogPattern}`
    : `--test-skip-pattern=${i18nCatalogPattern}`;
}

// Zaehlt die Datei-Wrapper-Eintraege, die keine echten Tests sind (s. Kommentar oben).
// Im Gates-Lauf werden ALLE Wrapper abgezogen. Im Regressionslauf nur die per "1..0"
// erkennbaren "echt gefilterten" Wrapper - die eine leere Datei bleibt darin gezaehlt.
function countPhantomWrapperEntries(tapText, mode) {
  const lines = tapText.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!FILE_WRAPPER_LINE.test(lines[i])) continue;
    const precededByEmptyPlan = lines[i - 1] === EMPTY_PLAN_LINE;
    if (mode === 'gates' || precededByEmptyPlan) count++;
  }
  return count;
}

function parseNodeSummary(tapText) {
  const summary = {};
  for (const line of tapText.split('\n')) {
    const match = line.match(SUMMARY_LINE);
    if (match) summary[match[1]] = Number(match[2]);
  }
  const complete = 'tests' in summary && 'pass' in summary && 'fail' in summary;
  return complete ? summary : null;
}

function printCorrectedSummary(mode, tapText) {
  const summary = parseNodeSummary(tapText);
  if (!summary) return; // Lauf abgebrochen (z.B. Ladefehler) - node meldet dann keine Summe.
  const phantomCount = countPhantomWrapperEntries(tapText, mode);
  const correctedTests = summary.tests - phantomCount;
  const correctedPass = summary.pass - phantomCount;
  console.log('');
  console.log(
    `# i18n-catalog-run (${mode}): ${phantomCount} Datei-Wrapper ohne echten Test abgezogen`,
  );
  console.log(`# korrigiert: tests ${correctedTests} / pass ${correctedPass} / fail ${summary.fail}`);
}

function runNodeTest(mode) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-reporter=tap', patternFlagFor(mode), 'test/*.test.js'],
      { stdio: ['inherit', 'pipe', 'inherit'] },
    );
    let buffered = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      process.stdout.write(chunk);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, tapText: buffered }));
  });
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'regression' && mode !== 'gates') {
    console.error('Nutzung: node test/i18n-catalog-run.mjs <regression|gates>');
    process.exit(1);
  }
  const { code, tapText } = await runNodeTest(mode);
  printCorrectedSummary(mode, tapText);
  process.exit(code);
}

main();
