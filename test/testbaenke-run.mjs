// Partitioniert die Testsuite in DREI Baenke - derselbe Mechanismus wie der i18n-Split
// (test/i18n-catalog-run.mjs), nur mit einer dritten Menge:
//
//   npm test             -> regression: alles AUSSER i18n-Katalog und Abnahmekriterien.
//                           Ist immer gruen; rot heisst "etwas, das lief, ist kaputt".
//   npm run test:gates   -> gates:      NUR der i18n-Launch-Testkatalog (darf rot sein).
//   npm run test:abnahme -> abnahme:    NUR die Abnahmekriterien (Entscheidung D13,
//                           .fortschritt.md). Rot ist dort ein Rueckstandsposten mit
//                           ausfuehrbarer Fertig-Definition, keine Regression.
//
// ZUORDNUNGSREGEL wie beim Katalog: die Kennung steht als Literal am NAMENSANFANG
// ("ABNAHME-<ID>: ..."), das Muster als EINE Quelle in package.json
// (config.abnahmePattern neben config.i18nCatalogPattern). Ein Testname traegt damit
// entweder eine Katalog-ID oder die Abnahme-Kennung oder keines von beidem - die drei
// Baenke sind disjunkt und ergeben zusammen denselben Bestand wie ein ungefilterter Lauf.
// Nachgerechnet wird das nicht hier, sondern in test/abnahme-bahn-selbsttest.test.js,
// am echten node:test gemessen statt an einem Nachbau.
//
// KEIN UEBERSPRINGEN: ein Abnahmekriterium laeuft und urteilt wie jeder andere Test, es
// wird nur anders gewertet. Deshalb gibt der Abnahme-Lauf am Ende die Zahl
// "x von y Abnahmekriterien erfuellt" aus - den Fortschrittsmassstab des Umstiegs. Sie
// zaehlt die bereits ausgewanderten Kriterien (test/abnahme-ausgewandert.json) mit, sonst
// SAENKE sie, sobald ein Kriterium gruen wird und in den Regressionslauf umzieht.
//
// Zusaetzliche node --test-Flags (z.B. Coverage-Schwellen der CI) gehen wie dort nach
// einem "--"-Trenner durch: "node test/testbaenke-run.mjs regression -- --flag ...".

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { extraArgsFrom, parseNodeSummary } from "./i18n-catalog-run.mjs";

const require = createRequire(import.meta.url);

const MODE_REGRESSION = "regression";
const MODE_GATES = "gates";
const MODE_ABNAHME = "abnahme";
const MODES = [MODE_REGRESSION, MODE_GATES, MODE_ABNAHME];

const TEST_GLOB = "test/**/*.test.js";
const FIRST_FILE_ARGUMENT = 3;
const MIGRATED_LIST = new URL("./abnahme-ausgewandert.json", import.meta.url);
const PROTOCOL_DIR = ".pruefung";
const SECOND_RUN_VARIABLE = "TESTS_ZWEITER_LAUF";
const SECOND_RUN_ON = "ja";
const SECOND_RUN_PROTOCOL = "regression-zweiter-lauf";
const COST_FILE_VARIABLE = "TESTKOSTEN_DATEI";

const FILE_WRAPPER_LINE = /^# Subtest: \S*test\/\S+\.test\.js$/;
const EMPTY_PLAN_LINE = "1..0";
const CANCELLED_LINE = /^# cancelled (\d+)$/m;
const RESULT_LINE = /^( *)(not ok|ok) \d+ - (.*)$/;
const SUBTEST_LINE = /^( *)# Subtest: (.*)$/;
const PASSED_STATUS = "ok";
const TAP_DIRECTIVE = / # (?:SKIP|TODO)\b/i;
const TAP_ESCAPE = /\\([\\#])/g;
const YAML_KEY_LINE = /^([A-Za-z_]+):(?: (.*))?$/;
const YAML_BLOCK_MARKERS = new Set(["", "|", "|-", ">", ">-"]);
const YAML_NESTING = 2;
const LOCATION = /^(.*):(\d+):(\d+)$/;
const PARENT_FAILURE_TYPES = new Set(["subtestsFailed", "cancelledByParent"]);
const TEST_ENTRY_TYPE = "test";

const MAX_OUTPUT_LINES = 30;
const FRAME_LINES = 4;
const LINES_PER_FAILURE = 2;
const MAX_SHOWN_FAILURES = Math.floor((MAX_OUTPUT_LINES - FRAME_LINES) / LINES_PER_FAILURE);
const MAX_DETAIL_LENGTH = 200;
const MS_PER_SECOND = 1000;
const COUNT_FORMAT = new Intl.NumberFormat("de-DE");

// Grund-Zeile am Testnamen (R3): "... | ROT WEIL: <Grund> | FIX: <Fix>". Der Grund haengt
// am Namen und nicht in einer Nebendatei - so steht er in jeder TAP-Zeile und kann nicht
// von seinem Kriterium wegdriften.
const REASON_LINE = /\|\s*ROT WEIL:([^|]*)\|\s*FIX:([\s\S]*)$/;

function patternsFromPackageJson() {
  return require("../package.json").config;
}

export function patternFlagsFor(mode) {
  const { abnahmePattern, i18nCatalogPattern } = patternsFromPackageJson();
  switch (mode) {
    case MODE_GATES:
      return [`--test-name-pattern=${i18nCatalogPattern}`];
    case MODE_ABNAHME:
      return [`--test-name-pattern=${abnahmePattern}`];
    case MODE_REGRESSION:
      return [`--test-skip-pattern=${i18nCatalogPattern}`, `--test-skip-pattern=${abnahmePattern}`];
    default:
      throw new Error(`unbekannte Bank: ${mode}`);
  }
}

// Die Wrapper-Regel haengt am FILTERTYP, nicht am Namen der Bank: die beiden
// --test-name-pattern-Baenke zaehlen JEDEN Datei-Wrapper als Phantom, der Regressionslauf
// nur die per "1..0" erkennbar leergefilterten (die eine echt leere Datei bleibt dort ein
// Testeintrag wie im ungefilterten Volllauf).
function phantomRuleFor(mode) {
  return mode === MODE_REGRESSION ? MODE_REGRESSION : MODE_GATES;
}

function countPhantomWrapperEntries(tapText, rule) {
  const lines = tapText.split("\n");
  return lines.filter(
    (line, index) =>
      FILE_WRAPPER_LINE.test(line) && (rule === MODE_GATES || lines[index - 1] === EMPTY_PLAN_LINE),
  ).length;
}

function cancelledCount(tapText) {
  const match = CANCELLED_LINE.exec(tapText);
  return match ? Number(match[1]) : 0;
}

// Testzahlen ohne die Datei-Wrapper. null, wenn der Lauf abgebrochen ist (z.B. Ladefehler)
// und node deshalb keine vollstaendige Summe meldet - dann gibt es keine belastbare Zahl.
function correctedCounts(tapText, mode) {
  const summary = parseNodeSummary(tapText);
  if (!summary) return null;
  const phantoms = countPhantomWrapperEntries(tapText, phantomRuleFor(mode));
  return {
    tests: summary.tests - phantoms,
    pass: summary.pass - phantoms,
    fail: summary.fail,
    cancelled: cancelledCount(tapText),
    phantoms,
  };
}

export function abnahmeScoreLine(tapText, migratedCount) {
  const counts = correctedCounts(tapText, MODE_ABNAHME);
  if (!counts) return null;
  const fulfilled = counts.pass + migratedCount;
  const criteria = counts.tests + migratedCount;
  return `${fulfilled} von ${criteria} Abnahmekriterien erfuellt`;
}

export function reasonOf(testName) {
  const match = testName.match(REASON_LINE);
  if (!match) return null;
  const [, rawWhy, rawFix] = match;
  const why = rawWhy.trim();
  const fix = rawFix.trim();
  return why && fix ? { why, fix } : null;
}

// Ausgewanderte Kriterien: gruen geworden, in den Regressionslauf umgezogen, Kennung im
// Namen gegen das Siegel "[abgenommen <ID>]" getauscht. Sie zaehlen in der R1-Zahl weiter
// mit. Dass die Liste und der Bestand zusammenpassen (und die Zahl nie sinkt), prueft der
// Regressionslauf selbst - test/abnahme-bahn-selbsttest.test.js.
function migratedCriteriaCount() {
  return JSON.parse(readFileSync(MIGRATED_LIST, "utf8")).length;
}

function testFilesFrom(argv) {
  const separatorIndex = argv.indexOf("--");
  const end = separatorIndex === -1 ? argv.length : separatorIndex;
  const files = argv.slice(FIRST_FILE_ARGUMENT, end);
  return files.length > 0 ? files : [TEST_GLOB];
}

function runNodeTest(
  mode,
  { extraArgs, files, protocolName = mode, environment = environmentWithout([SECOND_RUN_VARIABLE]) },
) {
  mkdirSync(PROTOCOL_DIR, { recursive: true });
  const protocolPath = join(PROTOCOL_DIR, `${protocolName}.log`);
  const protocol = createWriteStream(protocolPath);
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--test", "--test-reporter=tap", ...patternFlagsFor(mode), ...extraArgs, ...files],
      { stdio: ["inherit", "pipe", "pipe"], env: environment },
    );
    let buffered = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffered += chunk;
      protocol.write(chunk);
    });
    child.stderr.pipe(protocol, { end: false });
    child.on("close", (code) => {
      protocol.end(() => resolve({ code: code ?? 1, tapText: buffered, protocolPath }));
    });
  });
}

function yamlFields(lines, start, indent) {
  const pad = " ".repeat(indent);
  const fields = {};
  if (lines[start] !== `${pad}---`) return fields;
  let current = null;
  for (let i = start + 1; i < lines.length && lines[i] !== `${pad}...`; i++) {
    const own = lines[i].slice(indent);
    const key = own.startsWith(" ") ? null : YAML_KEY_LINE.exec(own);
    if (key) {
      current = { inline: key[2] ?? "", block: [] };
      fields[key[1]] = current;
    } else {
      current?.block.push(own.slice(YAML_NESTING));
    }
  }
  return fields;
}

function scalarOf(field) {
  if (!field || field.block.length > 0 || YAML_BLOCK_MARKERS.has(field.inline)) return null;
  const text = field.inline;
  const quoted = text.length > 1 && text.startsWith("'") && text.endsWith("'");
  return quoted ? text.slice(1, -1).replaceAll("''", "'") : text;
}

function messageOf(field) {
  const firstBlockLine = field?.block.find((line) => line.trim() !== "");
  return scalarOf(field) ?? firstBlockLine?.trim() ?? "ohne Meldung";
}

function detailOf(fields) {
  const expected = scalarOf(fields.expected);
  const actual = scalarOf(fields.actual);
  const comparison =
    expected !== null && actual !== null ? ` (erwartet ${expected}, erhalten ${actual})` : "";
  return `${messageOf(fields.error)}${comparison}`.slice(0, MAX_DETAIL_LENGTH);
}

function locationOf(fields) {
  const match = LOCATION.exec(scalarOf(fields.location) ?? "");
  if (!match) return "ohne Fundstelle";
  const [, file, line, column] = match;
  return `${relative(process.cwd(), file)}:${line}:${column}`;
}

function unescapeTap(text) {
  return text.replaceAll(TAP_ESCAPE, "$1");
}

function openSubtest(open, match) {
  const indent = match[1].length;
  while (open.length > 0 && open.at(-1).indent >= indent) open.pop();
  open.push({ indent, name: unescapeTap(match[2]) });
}

function resultsIn(tapText) {
  const lines = tapText.split("\n");
  const open = [];
  return lines.flatMap((line, index) => {
    const subtest = SUBTEST_LINE.exec(line);
    if (subtest) openSubtest(open, subtest);
    const match = RESULT_LINE.exec(line);
    if (!match) return [];
    const [, indent, status, text] = match;
    const directive = TAP_DIRECTIVE.exec(text);
    const name = unescapeTap(directive === null ? text : text.slice(0, directive.index));
    const parents = open.filter((entry) => entry.indent < indent.length).map((entry) => entry.name);
    const fields = yamlFields(lines, index + 1, indent.length + YAML_NESTING);
    return [
      {
        name,
        path: [...parents, name],
        passed: directive === null && status === PASSED_STATUS,
        failed: directive === null && status !== PASSED_STATUS,
        location: locationOf(fields),
        detail: detailOf(fields),
        type: scalarOf(fields.type),
        failureType: scalarOf(fields.failureType),
      },
    ];
  });
}

function failuresIn(tapText) {
  return resultsIn(tapText).filter(
    ({ failed, failureType }) => failed && !PARENT_FAILURE_TYPES.has(failureType),
  );
}

function everyRedTestListed(tapText) {
  const counts = correctedCounts(tapText, MODE_REGRESSION);
  if (!counts) return false;
  const redTests = resultsIn(tapText).filter(
    ({ failed, type }) => failed && type === TEST_ENTRY_TYPE,
  );
  return redTests.length > 0 && redTests.length === counts.fail + counts.cancelled;
}

function hasResult(tapText) {
  return correctedCounts(tapText, MODE_REGRESSION) !== null;
}

function failureLines(failures) {
  const shown = failures.slice(0, MAX_SHOWN_FAILURES);
  const hidden = failures.length - shown.length;
  const more = hidden > 0 ? [`… und ${hidden} weitere rote Tests`] : [];
  const listed = shown.flatMap(({ name, location, detail }) => [
    `✗ ${name} (${location})`,
    `  ${detail}`,
  ]);
  return [...listed, ...more];
}

function summaryLine(counts, elapsedMs) {
  const red = counts.fail + counts.cancelled;
  const seconds = Math.round(elapsedMs / MS_PER_SECOND);
  return `${COUNT_FORMAT.format(counts.pass)} bestanden, ${COUNT_FORMAT.format(red)} rot, ${seconds} s`;
}

function printReport(mode, { code, tapText, protocolPath }, elapsedMs) {
  const counts = correctedCounts(tapText, mode);
  const head = counts
    ? summaryLine(counts, elapsedMs)
    : `Testlauf ohne Ergebnis abgebrochen (Exit ${code})`;
  const green = code === 0 && counts !== null;
  const details = green ? [] : [...failureLines(failuresIn(tapText)), `Protokoll: ${protocolPath}`];
  for (const line of [head, ...details]) console.log(line);
}

function writeResult(mode, tapText, recovered) {
  const resultPath = join(PROTOCOL_DIR, `${mode}.json`);
  rmSync(resultPath, { force: true });
  const counts = correctedCounts(tapText, mode);
  if (counts) writeFileSync(resultPath, JSON.stringify({ bestanden: counts.pass + recovered }));
}

function environmentWithout(names) {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !names.includes(name)));
}

async function settle(mode, run) {
  const wanted = mode === MODE_REGRESSION && process.env[SECOND_RUN_VARIABLE] === SECOND_RUN_ON;
  if (!wanted || run.code === 0) return { code: run.code, wiederGruen: 0 };
  try {
    const { zweiterLauf } = await import("../tools/warteschlange/zweiter-lauf.mjs");
    return await zweiterLauf(run, {
      fehlschlaege: failuresIn,
      ergebnisse: resultsIn,
      vollstaendigRot: everyRedTestListed,
      mitErgebnis: hasResult,
      nachlaufen: (redFile, number) =>
        runNodeTest(mode, {
          extraArgs: [],
          files: [redFile],
          protocolName: `${SECOND_RUN_PROTOCOL}-${number}`,
          environment: environmentWithout([SECOND_RUN_VARIABLE, COST_FILE_VARIABLE]),
        }),
    });
  } catch (error) {
    console.log(`Zweiter Lauf abgebrochen: ${error.message}`);
    return { code: run.code, wiederGruen: 0 };
  }
}

// R1: die Zahl steht als LETZTE Zeile des Abnahme-Laufs und gehoert in jeden
// Abschlussbericht.
function printAbnahmeScore(tapText) {
  const line = abnahmeScoreLine(tapText, migratedCriteriaCount());
  console.log(line ?? "# Abnahme-Bahn abgebrochen - keine belastbare Zahl");
}

async function main() {
  const mode = process.argv[2];
  if (!MODES.includes(mode)) {
    console.error(
      `Nutzung: node test/testbaenke-run.mjs <${MODES.join("|")}> [<Testdatei> ...] [-- <node --test-Flags>]`,
    );
    process.exit(1);
  }
  const startedAt = Date.now();
  const files = testFilesFrom(process.argv);
  const run = await runNodeTest(mode, { extraArgs: extraArgsFrom(process.argv), files });
  printReport(mode, run, Date.now() - startedAt);
  const settled = await settle(mode, run);
  writeResult(mode, run.tapText, settled.wiederGruen);
  if (mode === MODE_ABNAHME) printAbnahmeScore(run.tapText);
  process.exit(settled.code);
}

// Nur beim Direktaufruf laufen, nicht beim Import aus einer Testdatei (der Selbsttest
// importiert die reinen Funktionen oben und darf dabei keinen node --test-Kindprozess
// anstossen). pathToFileURL statt "file://"-Verkettung: ein Repo-Pfad mit Leerzeichen wird
// von import.meta.url prozent-kodiert, ein Template-Literal nicht - der Vergleich waere
// dann immer falsch und main() liefe NIE.
const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
