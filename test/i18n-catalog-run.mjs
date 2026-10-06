import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const FILE_WRAPPER_LINE = /^# Subtest: test\/[^/\s]+\.test\.js$/;
const EMPTY_PLAN_LINE = '1..0';
const SUMMARY_LINE = /^# (tests|pass|fail) (\d+)$/;

export function patternFlagFor(mode) {
  const { i18nCatalogPattern } = require('../package.json').config;
  return mode === 'gates'
    ? `--test-name-pattern=${i18nCatalogPattern}`
    : `--test-skip-pattern=${i18nCatalogPattern}`;
}

export function countPhantomWrapperEntries(tapText, mode) {
  const lines = tapText.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!FILE_WRAPPER_LINE.test(lines[i])) continue;
    const precededByEmptyPlan = lines[i - 1] === EMPTY_PLAN_LINE;
    if (mode === 'gates' || precededByEmptyPlan) count++;
  }
  return count;
}

export function parseNodeSummary(tapText) {
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
  if (!summary) return;
  const phantomCount = countPhantomWrapperEntries(tapText, mode);
  const correctedTests = summary.tests - phantomCount;
  const correctedPass = summary.pass - phantomCount;
  console.log('');
  console.log(
    `# i18n-catalog-run (${mode}): ${phantomCount} Datei-Wrapper ohne echten Test abgezogen`,
  );
  console.log(`# korrigiert: tests ${correctedTests} / pass ${correctedPass} / fail ${summary.fail}`);
}

function runNodeTest(mode, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-reporter=tap', patternFlagFor(mode), ...extraArgs, 'test/*.test.js'],
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

export function extraArgsFrom(argv) {
  const separatorIndex = argv.indexOf('--');
  return separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'regression' && mode !== 'gates') {
    console.error('Nutzung: node test/i18n-catalog-run.mjs <regression|gates> [-- <node --test-Flags>]');
    process.exit(1);
  }
  const extraArgs = extraArgsFrom(process.argv);
  const { code, tapText } = await runNodeTest(mode, extraArgs);
  printCorrectedSummary(mode, tapText);
  process.exit(code);
}

const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
