import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const CHECKED_DIRECTORIES = ["src", "tools", "scripts"];
const REPORT_THRESHOLD = 400;
const DATA_FILE_SUFFIX = ".json";
const NUL_BYTE = 0;
const LINE_BREAK = "\n";
const MAX_GIT_OUTPUT_BYTES = 268_435_456;
const SHORT_SHA_LENGTH = 7;
const SINGLE = 1;
const EXIT_OK = 0;
const HEADING = "## Dateilänge (Bericht)";
const NEW_FILE = "neu";
const UNAVAILABLE = "Bericht nicht möglich: ";
const MISSING_BASIS =
  "keine Basis angegeben (Aufruf: node tools/dateilaenge.mjs --basis <commit>).";
const TABLE_HEADER = ["| Datei | Zeilen vorher | Zeilen nachher |", "| --- | ---: | ---: |"];
const PEEL_TO_COMMIT = "^{commit}";

function git(args, encoding = "utf8") {
  return execFileSync("git", args, { encoding, maxBuffer: MAX_GIT_OUTPUT_BYTES });
}

function candidateFiles() {
  const listing = git([
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ...CHECKED_DIRECTORIES,
  ]);
  const paths = new Set(listing.split("\0").filter(Boolean));
  return [...paths].filter((path) => !path.endsWith(DATA_FILE_SUFFIX) && existsSync(path)).sort();
}

function lineCount(content) {
  const text = content.toString("utf8");
  if (text === "") return 0;
  const lines = text.split(LINE_BREAK).length;
  return text.endsWith(LINE_BREAK) ? lines - 1 : lines;
}

function longFiles() {
  return candidateFiles().flatMap((path) => {
    const content = readFileSync(path);
    if (content.includes(NUL_BYTE)) return [];
    const lines = lineCount(content);
    return lines > REPORT_THRESHOLD ? [{ path, lines }] : [];
  });
}

function verifiedCommit(basis) {
  const commitRef = `${basis}${PEEL_TO_COMMIT}`;
  const check = spawnSync("git", ["cat-file", "-e", commitRef], { encoding: "utf8" });
  if (check.status !== EXIT_OK) {
    throw new Error(`Die Basis ${basis} ist kein Commit in diesem Checkout.`);
  }
  return git(["rev-parse", commitRef]).trim();
}

function basisPaths(basis) {
  const listing = git(["ls-tree", "-r", "-z", "--name-only", basis, "--", ...CHECKED_DIRECTORIES]);
  return new Set(listing.split("\0").filter(Boolean));
}

function grownFiles(basis, files) {
  const paths = basisPaths(basis);
  return files
    .map((file) => ({
      ...file,
      before: paths.has(file.path)
        ? lineCount(git(["show", `${basis}:${file.path}`], "buffer"))
        : undefined,
    }))
    .filter(({ lines, before }) => before === undefined || lines > before);
}

function fileCount(count) {
  return count === SINGLE ? `${count} Datei` : `${count} Dateien`;
}

function table(grown) {
  if (grown.length === 0) return [];
  const rows = grown.map(
    ({ path, before, lines }) => `| \`${path}\` | ${before ?? NEW_FILE} | ${lines} |`,
  );
  return [...TABLE_HEADER, ...rows, ""];
}

function report(basis) {
  const commit = verifiedCommit(basis);
  const files = longFiles();
  const grown = grownFiles(basis, files);
  const changed = grown.length === 0 ? "keine Datei" : fileCount(grown.length);
  return [
    HEADING,
    "",
    `Basis \`${commit.slice(0, SHORT_SHA_LENGTH)}\`. Berichtet wird jede Datei unter src/, tools/ und scripts/ (ohne JSON) über ${REPORT_THRESHOLD} Zeilen, die neu oder länger geworden ist. Der Bericht sperrt nichts.`,
    "",
    ...table(grown),
    `Dateilänge: ${changed} über ${REPORT_THRESHOLD} Zeilen neu oder länger geworden, ${fileCount(files.length)} über ${REPORT_THRESHOLD} Zeilen insgesamt.`,
  ];
}

function reportLines() {
  try {
    const { values } = parseArgs({ options: { basis: { type: "string" } } });
    if (values.basis === undefined) throw new Error(MISSING_BASIS);
    return report(values.basis);
  } catch (error) {
    return [HEADING, "", `${UNAVAILABLE}${error.message}`];
  }
}

console.log(reportLines().join(LINE_BREAK));
process.exitCode = EXIT_OK;
