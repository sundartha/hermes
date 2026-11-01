import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  PRUEFLEITER_TOOL,
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeDirectory,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";
import { workflowStepScript } from "./workflow-dateien.js";

const ENTSCHEIDUNG = "Werkzeugtests im Prüfleiter";
const AUSWAHL = "Testdateien des Teils";
const AUSGABE = "ausgabe.txt";
const NORMALER_TEST = "test/n1.test.js";
const WERKZEUG_TEST = "test/werkzeuge/w1.test.js";

function fuehreAus(verzeichnis, schritt, umgebung) {
  const skript = workflowStepScript("ci.yml", schritt).replaceAll("tools/pruefleiter.mjs", JSON.stringify(PRUEFLEITER_TOOL));
  const ergebnis = spawnSync("bash", ["-e", "-c", skript], {
    cwd: verzeichnis,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), GITHUB_OUTPUT: join(verzeichnis, AUSGABE), GITHUB_STEP_SUMMARY: join(verzeichnis, "zusammenfassung.md"), ...umgebung },
  });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
}

function entscheidung(context, { geaendert, schalter }) {
  const verzeichnis = probeRepository(context, { "src/basis.js": "a\n", "tools/werkzeug.mjs": "a\n", [AUSGABE]: "" });
  const basis = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(verzeichnis, { [geaendert]: "b\n" });
  commitAll(verzeichnis, "Änderung");
  fuehreAus(verzeichnis, ENTSCHEIDUNG, { PR_BASE_SHA: basis, WERKZEUGTESTS_EINMAL: schalter });
  return readFileSync(join(verzeichnis, AUSGABE), "utf8").trim();
}

test("mit WERKZEUGTESTS_EINMAL=an lässt die CI in der Queue die Werkzeugtests aus, wenn der Prüfleiter sie fährt", (context) => {
  assert.equal(entscheidung(context, { geaendert: "tools/werkzeug.mjs", schalter: "an" }), "ohne=true");
});

test("mit WERKZEUGTESTS_EINMAL=an fährt die CI die Werkzeugtests weiter, wenn der Prüfleiter sie nicht fährt", (context) => {
  assert.equal(entscheidung(context, { geaendert: "src/basis.js", schalter: "an" }), "ohne=false");
});

test("mit WERKZEUGTESTS_EINMAL=schatten fahren CI und Prüfleiter beide, auch wenn der Prüfleiter sie fährt", (context) => {
  assert.equal(entscheidung(context, { geaendert: "tools/werkzeug.mjs", schalter: "schatten" }), "ohne=false");
});

function ausgewaehlteDateien(context, umgebung) {
  const verzeichnis = probeDirectory(context, { [NORMALER_TEST]: "", [WERKZEUG_TEST]: "" });
  symlinkSync(join(REPO_ROOT, "tools"), join(verzeichnis, "tools"));
  fuehreAus(verzeichnis, AUSWAHL, { TEIL: "1", TEILE: "1", RUNNER_TEMP: verzeichnis, ...umgebung });
  return readFileSync(join(verzeichnis, "teil-dateien.txt"), "utf8").split("\n").filter((zeile) => zeile !== "").sort();
}

test("OHNE_WERKZEUGTESTS=true lässt die Testdateien des Teils ohne test/werkzeuge auswählen", (context) => {
  const dateien = ausgewaehlteDateien(context, { EVENT_NAME: "merge_group", OHNE_WERKZEUGTESTS: "true" });
  assert.deepEqual(dateien, [NORMALER_TEST]);
});

test("ohne OHNE_WERKZEUGTESTS wählt der Teil in der Queue auch die Werkzeugtests aus", (context) => {
  const dateien = ausgewaehlteDateien(context, { EVENT_NAME: "merge_group" });
  assert.deepEqual(dateien, [NORMALER_TEST, WERKZEUG_TEST]);
});
