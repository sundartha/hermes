import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, symlinkSync } from "node:fs";
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
import { workflowStepLines, workflowStepScript } from "./workflow-dateien.js";

const ENTSCHEIDUNG = "Werkzeugtests im Prüfleiter";
const AUSWAHL = "Testdateien des Teils";
const AUSGABE = "ausgabe.txt";
const NORMALER_TEST = "test/n1.test.js";
const WERKZEUG_TEST = "test/werkzeuge/w1.test.js";
const AUSFUEHRBAR = 0o755;
const EINZEILER_BEGINN = "run: ";

function schrittSkript(workflow, schritt) {
  return workflowStepScript(workflow, schritt).replaceAll("tools/pruefleiter.mjs", JSON.stringify(PRUEFLEITER_TOOL));
}

function schrittEinzeiler(schritt) {
  const zeile = workflowStepLines("ci.yml", schritt).find((kandidat) => kandidat.trim().startsWith(EINZEILER_BEGINN));
  return zeile.trim().slice(EINZEILER_BEGINN.length);
}

function fuehreSkriptAus(verzeichnis, skript, umgebung) {
  const ergebnis = spawnSync("bash", ["-e", "-c", skript], {
    cwd: verzeichnis,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), GITHUB_OUTPUT: join(verzeichnis, AUSGABE), GITHUB_STEP_SUMMARY: join(verzeichnis, "zusammenfassung.md"), ...umgebung },
  });
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
}

function fuehreAus(verzeichnis, schritt, umgebung) {
  fuehreSkriptAus(verzeichnis, schrittSkript("ci.yml", schritt), umgebung);
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

const PROTOKOLL = "npm-aufruf.txt";
const NPM_ATTRAPPE = `#!/bin/sh\nprintf '%s\\n' "$@" > "$AUFRUF_PROTOKOLL"\n`;
const TEILE_LISTE = "teil-dateien.txt";
const REST_LISTE = "rest-dateien.txt";
const REST_WERKZEUGE = "rest-werkzeugtests.txt";
const REGRESSION = ".pruefung/regression.json";

function mitAttrappe(context, dateien) {
  const verzeichnis = probeDirectory(context, { ...dateien, "bin/npm": NPM_ATTRAPPE });
  chmodSync(join(verzeichnis, "bin/npm"), AUSFUEHRBAR);
  return verzeichnis;
}

function aufrufe(verzeichnis, skript, umgebung) {
  fuehreSkriptAus(verzeichnis, skript, {
    PATH: `${join(verzeichnis, "bin")}:${process.env.PATH}`,
    RUNNER_TEMP: verzeichnis,
    AUFRUF_PROTOKOLL: join(verzeichnis, PROTOKOLL),
    ...umgebung,
  });
  const protokoll = join(verzeichnis, PROTOKOLL);
  return existsSync(protokoll) ? readFileSync(protokoll, "utf8").split("\n") : null;
}

test("der Schritt Tests fährt mit der Liste der laufenden Dateien, wenn die Übernahme eine geschrieben hat", (context) => {
  const verzeichnis = mitAttrappe(context, { [TEILE_LISTE]: `${NORMALER_TEST}\n${WERKZEUG_TEST}\n`, [REST_LISTE]: `${WERKZEUG_TEST}\n` });
  const argumente = aufrufe(verzeichnis, schrittSkript("ci.yml", "Tests"), { EVENT_NAME: "push" });
  assert.ok(argumente.includes(WERKZEUG_TEST));
  assert.equal(argumente.includes(NORMALER_TEST), false);
});

test("der Schritt Tests fährt nichts, wenn die Liste der laufenden Dateien leer ist, statt die ganze Suite zu starten", (context) => {
  const verzeichnis = mitAttrappe(context, { [TEILE_LISTE]: `${NORMALER_TEST}\n`, [REST_LISTE]: "" });
  assert.equal(aufrufe(verzeichnis, schrittSkript("ci.yml", "Tests"), { EVENT_NAME: "push" }), null);
});

test("der Schritt Tests fährt ohne Liste der laufenden Dateien alle Dateien des Teils", (context) => {
  const verzeichnis = mitAttrappe(context, { [TEILE_LISTE]: `${NORMALER_TEST}\n${WERKZEUG_TEST}\n` });
  const argumente = aufrufe(verzeichnis, schrittSkript("ci.yml", "Tests"), { EVENT_NAME: "push" });
  assert.ok(argumente.includes(NORMALER_TEST) && argumente.includes(WERKZEUG_TEST));
});

test("der Schritt Werkzeugtests fährt mit der Liste der laufenden Werkzeugtests, wenn die Übernahme eine geschrieben hat", (context) => {
  const verzeichnis = mitAttrappe(context, { [REST_WERKZEUGE]: `${WERKZEUG_TEST}\n` });
  const argumente = aufrufe(verzeichnis, schrittSkript("pruefleiter.yml", "Werkzeugtests"), { EVENT_NAME: "merge_group", PR_BASE_SHA: "abc", TEIL: "1", TEILE: "6" });
  assert.equal(argumente[argumente.indexOf("--werkzeugdateien") + 1], join(verzeichnis, REST_WERKZEUGE));
});

test("der Schritt Werkzeugtests wählt ohne Liste der laufenden Werkzeugtests den Teil selbst", (context) => {
  const verzeichnis = mitAttrappe(context, {});
  const argumente = aufrufe(verzeichnis, schrittSkript("pruefleiter.yml", "Werkzeugtests"), { EVENT_NAME: "merge_group", PR_BASE_SHA: "abc", TEIL: "1", TEILE: "6" });
  assert.equal(argumente.includes("--werkzeugdateien"), false);
});

function bestandenAusgabe(context, dateien) {
  const verzeichnis = probeDirectory(context, { ...dateien, [AUSGABE]: "" });
  fuehreSkriptAus(verzeichnis, schrittEinzeiler("Bestandene Tests melden"), { TEIL: "3" });
  return readFileSync(join(verzeichnis, AUSGABE), "utf8").trim();
}

test("Bestandene Tests melden nennt die Zahl aus regression.json", (context) => {
  assert.equal(bestandenAusgabe(context, { [REGRESSION]: JSON.stringify({ bestanden: 42 }) }), "teil-3=42");
});

test("Bestandene Tests melden bleibt ohne regression.json grün und meldet nichts, wenn alle Dateien übernommen wurden", (context) => {
  assert.equal(bestandenAusgabe(context, {}), "teil-3=");
});
