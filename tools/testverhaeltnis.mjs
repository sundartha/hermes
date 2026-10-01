import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const LIMIT_PATH = "tools/basis/testverhaeltnis.json";
const PRODUCT_MEASUREMENT = {
  key: "produkt",
  title: "Testverhältnis",
  tests: ["test", ":(exclude)test/werkzeuge/"],
  code: ["src"],
  codeNoun: "Produktzeilen",
};
const TOOL_MEASUREMENT = {
  title: "Werkzeug-Testverhältnis",
  tests: ["test/werkzeuge"],
  code: ["tools", "scripts"],
  codeNoun: "Werkzeug- und Skriptzeilen",
};
const GITHUB_WARNING = "::warning::";
const TOOL_RATIO_NOTE = "wird nur beobachtet und hält den Build nicht auf";
const SOURCE_FILE_PATTERN = /\.[cm]?js$/;
const LINE_COMMENT_START = "//";
const BLOCK_COMMENT_START = "/*";
const BLOCK_COMMENT_END = "*/";
const RATIO_DECIMALS = 2;
const MAX_GIT_OUTPUT_BYTES = 268_435_456;
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const EXIT_USAGE = 2;
const COMMIT_OBJECT_TYPE = "commit";
const USAGE = "Aufruf: node tools/testverhaeltnis.mjs --basis <commit>";

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

function limitsAtBasis(basis) {
  const objectType = spawnSync("git", ["cat-file", "-t", basis], { encoding: "utf8" });
  if (objectType.stdout.trim() !== COMMIT_OBJECT_TYPE) {
    throw new Error(`Die Basis ${basis} ist kein Commit in diesem Checkout.`);
  }
  const shown = spawnSync("git", ["show", `${basis}:${LIMIT_PATH}`], { encoding: "utf8" });
  return shown.status === EXIT_OK ? JSON.parse(shown.stdout) : {};
}

function limitProblem({ key }, limits, basisLimits) {
  const limit = limits[key]?.obergrenze;
  if (typeof limit !== "number") return `${LIMIT_PATH}: die Obergrenze ${key}.obergrenze fehlt.`;
  const basisLimit = basisLimits[key]?.obergrenze;
  if (typeof basisLimit !== "number" || limit <= basisLimit) return undefined;
  return `${LIMIT_PATH}: die Obergrenze ${key}.obergrenze steigt von ${basisLimit} auf ${limit}; sie darf nur sinken.`;
}

function ratioReport(measurement) {
  const testLines = codeLinesIn(measurement.tests);
  const codeLines = codeLinesIn(measurement.code);
  const ratio = ratioOf(testLines, codeLines);
  const text = `${measurement.title} ${ratio.toFixed(RATIO_DECIMALS)} (${testLines} Testzeilen zu ${codeLines} ${measurement.codeNoun})`;
  return { ratio, text };
}

function measure(measurement, limit) {
  const { ratio, text } = ratioReport(measurement);
  const summary = `${text}, Obergrenze ${limit} aus ${LIMIT_PATH}`;
  if (ratio <= limit) return { summary };
  return {
    finding: `${summary}. Das Verhältnis darf nicht weiter steigen: fasse neue Tests mit bestehenden zusammen oder entferne überflüssige Testzeilen.`,
  };
}

function productFindings(limits, basisLimits) {
  const problem = limitProblem(PRODUCT_MEASUREMENT, limits, basisLimits);
  const result =
    problem === undefined
      ? measure(PRODUCT_MEASUREMENT, limits[PRODUCT_MEASUREMENT.key].obergrenze)
      : { finding: problem };
  if (result.summary !== undefined) console.log(result.summary);
  return result.finding === undefined ? [] : [result.finding];
}

function warnAboutToolRatio() {
  console.log(`${GITHUB_WARNING}${ratioReport(TOOL_MEASUREMENT).text} ${TOOL_RATIO_NOTE}.`);
}

function main() {
  const { values } = parseArgs({ options: { basis: { type: "string" } } });
  if (values.basis === undefined) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const limits = JSON.parse(readFileSync(LIMIT_PATH, "utf8"));
  const findings = productFindings(limits, limitsAtBasis(values.basis));
  warnAboutToolRatio();
  for (const finding of findings) console.error(finding);
  return findings.length > 0 ? EXIT_FINDING : EXIT_OK;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`Abbruch: ${error.message}`);
  process.exitCode = EXIT_USAGE;
}
