import assert from "node:assert/strict";
import { test } from "node:test";

import { FILE_LENGTH_TOOL, probeRepository, runIn } from "./probe-repo.js";

const MAX_LINES = 400;
const GIANT_FILE_LINES = 900;
const GIANT_FILES_PATH = "tools/basis/riesendateien.json";
const GIANT_FILE = "src/riese.js";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const JSON_BRACKET_LINES = 2;

function codeWithLines(count) {
  const lines = Array.from(
    { length: count },
    (_unused, index) => `export const wert${index} = ${index};`,
  );
  return `${lines.join("\n")}\n`;
}

function jsonWithLines(count) {
  const values = Array.from({ length: count - JSON_BRACKET_LINES }, (_unused, index) => index);
  return `${JSON.stringify(values, null, 1)}\n`;
}

function checkLengths(context, files) {
  const directory = probeRepository(context, {
    [GIANT_FILES_PATH]: JSON.stringify({ [GIANT_FILE]: GIANT_FILE_LINES }),
    [GIANT_FILE]: codeWithLines(GIANT_FILE_LINES),
    ...files,
  });
  return runIn(directory, process.execPath, [FILE_LENGTH_TOOL]);
}

test("eine neue Datei unter src/ mit 400 Zeilen geht durch, mit 401 Zeilen ist sie rot", (context) => {
  const allowed = checkLengths(context, { "src/neu.js": codeWithLines(MAX_LINES) });
  assert.equal(allowed.status, EXIT_OK, allowed.stderr);

  const tooLong = checkLengths(context, { "src/neu.js": codeWithLines(MAX_LINES + 1) });
  assert.equal(tooLong.status, EXIT_FINDING);
  assert.match(tooLong.stderr, /src\/neu\.js: 401 Zeilen, erlaubt sind 400/);
});

test("die Grenze gilt auch unter tools/ und scripts/, aber nicht in anderen Ordnern", (context) => {
  const outside = checkLengths(context, { "test/lang.test.js": codeWithLines(MAX_LINES + 1) });
  assert.equal(outside.status, EXIT_OK, outside.stderr);

  const result = checkLengths(context, {
    "tools/lang.mjs": codeWithLines(MAX_LINES + 1),
    "scripts/lang.mjs": codeWithLines(MAX_LINES + 1),
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.stderr, /tools\/lang\.mjs: 401 Zeilen/);
  assert.match(result.stderr, /scripts\/lang\.mjs: 401 Zeilen/);
});

test("JSON-Daten unter src/ zählen nicht als Code und haben keine Längengrenze", (context) => {
  const result = checkLengths(context, { "src/daten.json": jsonWithLines(MAX_LINES + 1) });
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("eine Riesendatei darf ihre vermerkte Länge behalten, aber nicht länger werden", (context) => {
  const shorter = checkLengths(context, { [GIANT_FILE]: codeWithLines(GIANT_FILE_LINES - 1) });
  assert.equal(shorter.status, EXIT_OK, shorter.stderr);

  const longer = checkLengths(context, { [GIANT_FILE]: codeWithLines(GIANT_FILE_LINES + 1) });
  assert.equal(longer.status, EXIT_FINDING);
  assert.match(
    longer.stderr,
    /src\/riese\.js: 901 Zeilen, in tools\/basis\/riesendateien\.json stehen 900/,
  );
});
