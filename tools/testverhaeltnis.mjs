import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const MEASUREMENTS = [
  {
    title: "Testverhältnis",
    tests: ["test", ":(exclude)test/werkzeuge/"],
    code: ["src"],
    codeNoun: "Produktzeilen",
  },
  {
    title: "Werkzeug-Testverhältnis",
    tests: ["test/werkzeuge"],
    code: ["tools", "scripts"],
    codeNoun: "Werkzeug- und Skriptzeilen",
  },
];
const GITHUB_NOTICE = "::notice::";
const DISPLAY_NOTE =
  "wird nur angezeigt; die Wirkung neuer Tests prüfen Mutationsprüfung und Testwirkung";
const SOURCE_FILE_PATTERN = /\.[cm]?js$/;
const LINE_COMMENT_START = "//";
const BLOCK_COMMENT_START = "/*";
const BLOCK_COMMENT_END = "*/";
const RATIO_DECIMALS = 2;
const MAX_GIT_OUTPUT_BYTES = 268_435_456;
const EXIT_OK = 0;
const EXIT_ABORT = 2;

function sourceFiles(pathspecs) {
  const listing = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs],
    { encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES },
  );
  const paths = new Set(listing.split("\0").filter(Boolean));
  return [...paths].filter((path) => SOURCE_FILE_PATTERN.test(path) && existsSync(path));
}

function isCodeAfterBlockEnd(line, endIndex) {
  const rest = line.slice(endIndex + BLOCK_COMMENT_END.length).trim();
  return rest !== "" && !rest.startsWith(LINE_COMMENT_START);
}

function classifyOutsideBlock(line) {
  if (line === "" || line.startsWith(LINE_COMMENT_START)) return { counts: false, inBlock: false };
  if (!line.startsWith(BLOCK_COMMENT_START)) return { counts: true, inBlock: false };
  const endIndex = line.indexOf(BLOCK_COMMENT_END, BLOCK_COMMENT_START.length);
  if (endIndex === -1) return { counts: false, inBlock: true };
  return { counts: isCodeAfterBlockEnd(line, endIndex), inBlock: false };
}

function classifyInsideBlock(line) {
  const endIndex = line.indexOf(BLOCK_COMMENT_END);
  if (endIndex === -1) return { counts: false, inBlock: true };
  return { counts: isCodeAfterBlockEnd(line, endIndex), inBlock: false };
}

function codeLineCount(text) {
  let inBlock = false;
  let count = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const state = inBlock ? classifyInsideBlock(line) : classifyOutsideBlock(line);
    inBlock = state.inBlock;
    if (state.counts) count += 1;
  }
  return count;
}

function codeLinesIn(pathspecs) {
  return sourceFiles(pathspecs).reduce(
    (sum, path) => sum + codeLineCount(readFileSync(path, "utf8")),
    0,
  );
}

function ratioOf(testLines, codeLines) {
  if (codeLines > 0) return testLines / codeLines;
  return testLines > 0 ? Number.POSITIVE_INFINITY : 0;
}

function ratioReport(measurement) {
  const testLines = codeLinesIn(measurement.tests);
  const codeLines = codeLinesIn(measurement.code);
  const ratio = ratioOf(testLines, codeLines);
  return `${measurement.title} ${ratio.toFixed(RATIO_DECIMALS)} (${testLines} Testzeilen zu ${codeLines} ${measurement.codeNoun})`;
}

function main() {
  parseArgs({ options: { basis: { type: "string" } } });
  for (const measurement of MEASUREMENTS) {
    console.log(`${GITHUB_NOTICE}${ratioReport(measurement)} ${DISPLAY_NOTE}.`);
  }
  return EXIT_OK;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`Abbruch: ${error.message}`);
  process.exitCode = EXIT_ABORT;
}
