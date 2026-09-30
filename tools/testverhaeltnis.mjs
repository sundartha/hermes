import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const TEST_DIRECTORY = "test";
const PRODUCT_DIRECTORY = "src";
const LIMIT_PATH = "tools/basis/testverhaeltnis.json";
const SOURCE_FILE_PATTERN = /\.[cm]?js$/;
const LINE_COMMENT_START = "//";
const BLOCK_COMMENT_START = "/*";
const BLOCK_COMMENT_END = "*/";
const RATIO_DECIMALS = 2;
const MAX_GIT_OUTPUT_BYTES = 268_435_456;

function sourceFiles(directory) {
  const listing = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", directory],
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

function codeLinesIn(directory) {
  return sourceFiles(directory).reduce(
    (sum, path) => sum + codeLineCount(readFileSync(path, "utf8")),
    0,
  );
}

const { obergrenze: limit } = JSON.parse(readFileSync(LIMIT_PATH, "utf8"));
const testLines = codeLinesIn(TEST_DIRECTORY);
const productLines = codeLinesIn(PRODUCT_DIRECTORY);
const ratio = testLines / productLines;
const summary = `Testverhältnis ${ratio.toFixed(RATIO_DECIMALS)} (${testLines} Testzeilen zu ${productLines} Produktzeilen), Obergrenze ${limit} aus ${LIMIT_PATH}`;
if (ratio > limit) {
  console.error(
    `${summary}. Das Verhältnis darf nicht weiter steigen: fasse neue Tests mit bestehenden zusammen oder entferne überflüssige Testzeilen.`,
  );
  process.exitCode = 1;
} else {
  console.log(summary);
}
