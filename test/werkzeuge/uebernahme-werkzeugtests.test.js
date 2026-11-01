import assert from "node:assert/strict";
import { test } from "node:test";

import { PRUEFLEITER_TOOL, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const GEAENDERT = "export const wert = 2;\n";
const FALL = [
  ["eine Änderung nur unter src", "src/basis.js", ["--werkzeugtests-gewollt"], "nein"],
  ["eine Änderung nur unter test außerhalb der Werkzeugtests", "test/basis.test.js", ["--werkzeugtests-gewollt"], "nein"],
  ["eine Änderung unter tools", "tools/werkzeug.mjs", ["--werkzeugtests-gewollt"], "ja"],
  ["eine Änderung unter den Werkzeugtests selbst", "test/werkzeuge/a.test.js", ["--werkzeugtests-gewollt"], "ja"],
  ["eine Änderung an einem Workflow", ".github/workflows/ci.yml", ["--werkzeugtests-gewollt"], "ja"],
  ["eine reine src-Änderung mit --alle-werkzeugtests", "src/basis.js", ["--werkzeugtests-gewollt", "--alle-werkzeugtests"], "ja"],
];

function basisRepo(context) {
  const ordner = probeRepository(context, {
    "src/basis.js": "export const wert = 1;\n",
    "test/basis.test.js": "export const probe = 1;\n",
    "tools/werkzeug.mjs": "export const werkzeug = 1;\n",
    "test/werkzeuge/a.test.js": "export const probe = 1;\n",
    ".github/workflows/ci.yml": "name: Probe\n",
  });
  return { ordner, basis: runIn(ordner, "git", ["rev-parse", "HEAD"]).stdout.trim() };
}

test("der Prüfleiter nennt je nach Änderung, ob er die Werkzeugtests fährt", (context) => {
  for (const [name, datei, optionen, erwartet] of FALL) {
    const { ordner, basis } = basisRepo(context);
    writeFiles(ordner, { [datei]: GEAENDERT });
    commitAll(ordner, "Änderung");
    const lauf = runIn(ordner, process.execPath, [PRUEFLEITER_TOOL, "--basis", basis, ...optionen]);
    assert.equal(lauf.status, 0, `${name}: ${lauf.stderr}`);
    assert.equal(lauf.stdout.trim(), erwartet, name);
  }
});

test("--werkzeugtests-gewollt lässt sich nicht mit einer anderen Betriebsart mischen", (context) => {
  const { ordner, basis } = basisRepo(context);
  const lauf = runIn(ordner, process.execPath, [PRUEFLEITER_TOOL, "--basis", basis, "--werkzeugtests-gewollt", "--ohne-werkzeugtests"]);
  assert.equal(lauf.status, 2);
});
