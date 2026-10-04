import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FILE_LENGTH_TOOL, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const REPORT_THRESHOLD = 400;
const OLD_FILE_LINES = 500;
const OLD_FILE_GROWTH = 4;
const SHRUNK_FILE_LINES = 600;
const JSON_BRACKET_LINES = 2;
const EXIT_OK = 0;
const TABLE_HEADER = "| Datei | Zeilen vorher | Zeilen nachher |";
const UNAVAILABLE = "Bericht nicht möglich: ";
const SMALL_FILE_LINES = 1;

function codeWithLines(count) {
  const lines = Array.from(
    { length: count },
    (_unused, index) => `export const wert${index} = ${index};`,
  );
  return `${lines.join("\n")}\n`;
}

const SMALL_BASIS = { "src/app.js": codeWithLines(SMALL_FILE_LINES) };
const SMALL_CHANGE = { "src/app.js": codeWithLines(SMALL_FILE_LINES + 1) };

function jsonWithLines(count) {
  const values = Array.from({ length: count - JSON_BRACKET_LINES }, (_unused, index) => index);
  return `${JSON.stringify(values, null, 1)}\n`;
}

function reportLines(result) {
  assert.equal(result.status, EXIT_OK, result.stderr);
  return result.stdout.split("\n");
}

function prRepository(context, basisFiles, prFiles) {
  const directory = probeRepository(context, basisFiles);
  writeFiles(directory, prFiles);
  commitAll(directory, "PR");
  return directory;
}

function reportFor(directory, args = ["--basis", "HEAD~1"]) {
  return reportLines(runIn(directory, process.execPath, [FILE_LENGTH_TOOL, ...args]));
}

test("eine lange Altdatei, die von 500 auf 504 Zeilen wächst, steht mit beiden Zahlen im Bericht", (context) => {
  const directory = prRepository(
    context,
    { "src/alt.js": codeWithLines(OLD_FILE_LINES) },
    { "src/alt.js": codeWithLines(OLD_FILE_LINES + OLD_FILE_GROWTH) },
  );
  const lines = reportFor(directory);
  assert.ok(lines.includes("| `src/alt.js` | 500 | 504 |"), lines.join("\n"));
});

test("neue Dateien mit 401 Zeilen unter tools/ und scripts/ werden als neu berichtet, eine mit genau 400 Zeilen nicht", (context) => {
  const directory = prRepository(context, SMALL_BASIS, {
    "tools/lang.mjs": codeWithLines(REPORT_THRESHOLD + 1),
    "scripts/lang.mjs": codeWithLines(REPORT_THRESHOLD + 1),
    "scripts/genau.mjs": codeWithLines(REPORT_THRESHOLD),
  });
  const lines = reportFor(directory);
  assert.ok(lines.includes("| `tools/lang.mjs` | neu | 401 |"), lines.join("\n"));
  assert.ok(lines.includes("| `scripts/lang.mjs` | neu | 401 |"), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes("scripts/genau.mjs")), lines.join("\n"));
});

test("unveränderte und kürzer gewordene lange Dateien, Tests und JSON-Daten bleiben ohne Tabelle", (context) => {
  const directory = prRepository(
    context,
    {
      "src/gleich.js": codeWithLines(OLD_FILE_LINES),
      "src/kuerzer.js": codeWithLines(SHRUNK_FILE_LINES),
    },
    {
      "src/kuerzer.js": codeWithLines(SHRUNK_FILE_LINES - 1),
      "test/lang.test.js": codeWithLines(REPORT_THRESHOLD + 1),
      "src/daten.json": jsonWithLines(REPORT_THRESHOLD + 1),
    },
  );
  const lines = reportFor(directory);
  assert.ok(
    lines.includes(
      "Dateilänge: keine Datei über 400 Zeilen neu oder länger geworden, 2 Dateien über 400 Zeilen insgesamt.",
    ),
    lines.join("\n"),
  );
  assert.ok(!lines.includes(TABLE_HEADER), lines.join("\n"));
});

test("eine Basis, die kein Commit ist, ergibt den Hinweis statt eines Abbruchs", (context) => {
  const directory = prRepository(context, SMALL_BASIS, SMALL_CHANGE);
  const lines = reportFor(directory, ["--basis", "nichtda"]);
  assert.ok(
    lines.includes(`${UNAVAILABLE}Die Basis nichtda ist kein Commit in diesem Checkout.`),
    lines.join("\n"),
  );
});

test("eine nicht lesbare Datei ergibt den Hinweis statt eines Abbruchs", (context) => {
  const directory = prRepository(context, SMALL_BASIS, SMALL_CHANGE);
  symlinkSync(join(directory, "src"), join(directory, "src/kaputt.js"));
  const lines = reportFor(directory);
  assert.ok(
    lines.some((line) => line.startsWith(UNAVAILABLE)),
    lines.join("\n"),
  );
});

test("ohne --basis ergibt der Aufruf den Hinweis auf die fehlende Basis", (context) => {
  const directory = prRepository(context, SMALL_BASIS, SMALL_CHANGE);
  const lines = reportFor(directory, []);
  assert.ok(
    lines.some((line) => line.startsWith(`${UNAVAILABLE}keine Basis angegeben`)),
    lines.join("\n"),
  );
});
