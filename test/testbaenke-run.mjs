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
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { extraArgsFrom, parseNodeSummary } from "./i18n-catalog-run.mjs";

const require = createRequire(import.meta.url);

const MODE_REGRESSION = "regression";
const MODE_GATES = "gates";
const MODE_ABNAHME = "abnahme";
const MODES = [MODE_REGRESSION, MODE_GATES, MODE_ABNAHME];

const TEST_GLOB = "test/**/*.test.js";
const MIGRATED_LIST = new URL("./abnahme-ausgewandert.json", import.meta.url);

const FILE_WRAPPER_LINE = /^# Subtest: \S*test\/\S+\.test\.js$/;
const EMPTY_PLAN_LINE = "1..0";

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

function runNodeTest(mode, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--test", "--test-reporter=tap", ...patternFlagsFor(mode), ...extraArgs, TEST_GLOB],
      { stdio: ["inherit", "pipe", "inherit"] },
    );
    let buffered = "";
    child.stdout.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      process.stdout.write(chunk);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, tapText: buffered }));
  });
}

function printCorrectedSummary(mode, tapText) {
  const counts = correctedCounts(tapText, mode);
  if (!counts) return; // Lauf abgebrochen - node meldet dann keine Summe.
  console.log("");
  console.log(
    `# testbaenke-run (${mode}): ${counts.phantoms} Datei-Wrapper ohne echten Test abgezogen`,
  );
  console.log(`# korrigiert: tests ${counts.tests} / pass ${counts.pass} / fail ${counts.fail}`);
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
      `Nutzung: node test/testbaenke-run.mjs <${MODES.join("|")}> [-- <node --test-Flags>]`,
    );
    process.exit(1);
  }
  const { code, tapText } = await runNodeTest(mode, extraArgsFrom(process.argv));
  printCorrectedSummary(mode, tapText);
  if (mode === MODE_ABNAHME) printAbnahmeScore(tapText);
  process.exit(code);
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
