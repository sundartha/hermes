import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const CHECKED_DIRECTORIES = ["src", "tools", "scripts"];
const GIANT_FILES_PATH = "tools/basis/riesendateien.json";
const MAX_LINES = 400;
const DATA_FILE_SUFFIX = ".json";
const NUL_BYTE = 0;
const LINE_BREAK = "\n";
const MAX_GIT_OUTPUT_BYTES = 268_435_456;

function candidateFiles() {
  const listing = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...CHECKED_DIRECTORIES],
    { encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES },
  );
  const paths = new Set(listing.split("\0").filter(Boolean));
  return [...paths].filter((path) => !path.endsWith(DATA_FILE_SUFFIX) && existsSync(path)).sort();
}

function lineCount(content) {
  const text = content.toString("utf8");
  if (text === "") return 0;
  const lines = text.split(LINE_BREAK).length;
  return text.endsWith(LINE_BREAK) ? lines - 1 : lines;
}

function measuredLengths() {
  return candidateFiles().flatMap((path) => {
    const content = readFileSync(path);
    return content.includes(NUL_BYTE) ? [] : [{ path, lines: lineCount(content) }];
  });
}

function findingFor({ path, lines }, giantFiles) {
  const recorded = giantFiles[path];
  if (recorded === undefined) {
    if (lines <= MAX_LINES) return undefined;
    return `${path}: ${lines} Zeilen, erlaubt sind ${MAX_LINES}. Teile die Datei in kleinere Module auf.`;
  }
  if (lines <= recorded) return undefined;
  return `${path}: ${lines} Zeilen, in ${GIANT_FILES_PATH} stehen ${recorded}. Diese Altdatei darf nur kürzer werden; lagere Neues in eine eigene Datei aus.`;
}

const giantFiles = JSON.parse(readFileSync(GIANT_FILES_PATH, "utf8"));
const lengths = measuredLengths();
const findings = lengths.map((entry) => findingFor(entry, giantFiles)).filter(Boolean);
for (const finding of findings) console.error(finding);
if (findings.length > 0) {
  process.exitCode = 1;
} else {
  const longFiles = lengths.filter(({ lines }) => lines > MAX_LINES).length;
  console.log(
    `${lengths.length} Dateien geprüft; ${longFiles} über ${MAX_LINES} Zeilen, alle in ${GIANT_FILES_PATH} und nicht länger geworden`,
  );
}
