import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";

import { probeDirectory } from "./probe-repo.js";
import { workflowJobLines, workflowLines, workflowStepLines } from "./workflow-dateien.js";

const CI = "ci.yml";
const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const URTEIL_EXITS = [0, 1, 2];
const BASIS = "0123456789abcdef0123456789abcdef01234567";
const ALTER_STAND = "--alter-stand";
const PLAN = "Mutationsplan";
const TEIL = "Mutationsprüfung";
const URTEIL = "Mutationsurteil";
const MUTATIONSSCHRITTE = [PLAN, TEIL, URTEIL];
const MUTATIONSJOBS = ["mutationsplan", "mutationspruefung", "mutationsurteil"];
const OHNE_ABRUF = { pruefungen: "    if: github.event_name != 'workflow_dispatch'", tests: "    if: github.event_name != 'workflow_dispatch'" };
const SAMMELJOB = "    if: always()";
const SAMMELSCHRITT = "Alle Jobs erfolgreich";
const ABRUF_ERGEBNISSE = { pruefungen: "skipped", tests: "skipped", mutationsplan: "success", mutationspruefung: "success", mutationsurteil: "success" };
const JOB_BEDINGUNG = /^ {4}if: /;
const ABRUF = "workflow_dispatch";
const EINGABE = /^ {6}([a-z_]+):$/;
const EINGABE_FELD = /^ {8}([a-z]+): (.+)$/;
const ABRUF_EINGABEN = { basis: { type: "string", required: "true" }, alter_stand: { type: "boolean", default: "false" }, plaetze: { type: "number", default: "0" } };
const SKRIPT_BEGINN = "        run: |";
const SKRIPTZEILE = /^(?: {10}|$)/;
const SKRIPT_EINRUECKUNG = 10;
const STEP_ENV = { ALTER_STAND: "${{ inputs.alter_stand }}", PR_BASE_SHA: "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || inputs.basis }}" };
const NPM_ATTRAPPE = [
  "#!/bin/sh",
  'printf "%s\\n" "$*" >> "$NPM_AUFRUFE"',
  'vorher=""',
  'for argument in "$@"; do',
  '  if [ "$vorher" = "--plan" ]; then printf \'{"teile":[1],"anzahl":1}\' > "$argument"; fi',
  '  vorher="$argument"',
  "done",
  'echo "grün: Urteil der Attrappe"',
  'echo "Hinweis der Attrappe" >&2',
  'exit "${NPM_EXIT:-0}"',
  "",
].join("\n");

function skript(name) {
  const zeilen = workflowStepLines(CI, name);
  const rumpf = zeilen.slice(zeilen.indexOf(SKRIPT_BEGINN) + 1);
  const ende = rumpf.findIndex((zeile) => !SKRIPTZEILE.test(zeile));
  return (ende === -1 ? rumpf : rumpf.slice(0, ende)).map((zeile) => zeile.slice(SKRIPT_EINRUECKUNG)).join("\n");
}

function schritt(context, name, variablen = {}) {
  const ordner = probeDirectory(context, { npm: NPM_ATTRAPPE, "ausgabe.txt": "" });
  chmodSync(join(ordner, "npm"), AUSFUEHRBAR);
  const aufrufe = join(ordner, "aufrufe.txt");
  const umgebung = {
    ...env,
    PATH: `${ordner}${delimiter}${env.PATH}`,
    RUNNER_TEMP: ordner,
    GITHUB_OUTPUT: join(ordner, "ausgabe.txt"),
    NPM_AUFRUFE: aufrufe,
    EVENT_NAME: "pull_request",
    GLEICH: "",
    PR_BASE_SHA: BASIS,
    ALTER_STAND: "",
    TEIL: "1",
    TEILE: "1",
    ...variablen,
  };
  const lauf = spawnSync("bash", ["-c", skript(name)], { encoding: "utf8", env: umgebung });
  return {
    status: lauf.status,
    meldung: lauf.stdout + lauf.stderr,
    ordner,
    aufrufe: existsSync(aufrufe) ? readFileSync(aufrufe, "utf8").split("\n").filter(Boolean).map((zeile) => zeile.split(" ")) : [],
    ausgaben: readFileSync(join(ordner, "ausgabe.txt"), "utf8"),
  };
}

function abrufEingaben() {
  const zeilen = workflowLines(CI);
  const beginn = zeilen.indexOf(`  ${ABRUF}:`);
  assert.notEqual(beginn, -1, `${ABRUF} fehlt unter on:`);
  const eingaben = {};
  let aktuell;
  for (const zeile of zeilen.slice(beginn + 2)) {
    if (!zeile.startsWith("      ")) break;
    const name = EINGABE.exec(zeile);
    const feld = EINGABE_FELD.exec(zeile);
    if (name) eingaben[(aktuell = name[1])] = {};
    else if (feld && aktuell) eingaben[aktuell][feld[1]] = feld[2];
  }
  return eingaben;
}

function jobBedingung(job) {
  return workflowJobLines(CI, job).find((zeile) => JOB_BEDINGUNG.test(zeile));
}

function misst(lauf) {
  return lauf.ausgaben.includes("messen=ja") && lauf.aufrufe.some((aufruf) => aufruf.includes("--plan"));
}

test("der Abruf von Hand nimmt eine Basis als Pflichtangabe und den alten Stand als Schalter, der aus ist", () => {
  const eingaben = abrufEingaben();
  for (const [name, erwartet] of Object.entries(ABRUF_EINGABEN)) {
    assert.ok(eingaben[name], `Eingabe ${name} fehlt`);
    for (const [feld, wert] of Object.entries(erwartet)) assert.equal(eingaben[name][feld], wert, `${name}.${feld}`);
  }
});

test("die Mutationsteile laufen beim Abruf so viele gleichzeitig, wie er als Plätze nennt, sonst höchstens 200", () => {
  const zeilen = workflowJobLines(CI, "mutationspruefung").map((zeile) => zeile.trim());
  assert.ok(zeilen.includes("max-parallel: ${{ github.event_name == 'workflow_dispatch' && fromJSON(inputs.plaetze || '256') || 200 }}"));
});

test("beim Abruf von Hand laufen Prüfungen und Tests nicht, die drei Mutationsjobs und der Sammeljob CI schon", () => {
  for (const [job, bedingung] of Object.entries(OHNE_ABRUF)) assert.equal(jobBedingung(job), bedingung, job);
  for (const job of [...MUTATIONSJOBS, "ci"]) assert.ok(!(jobBedingung(job) ?? "").includes(ABRUF), `${job} darf beim Abruf nicht übersprungen werden`);
  assert.equal(jobBedingung("ci"), SAMMELJOB);
});

test("beim Abruf von Hand endet der Pflicht-Check CI rot, nie übersprungen oder grün", () => {
  const lauf = spawnSync("bash", ["-c", skript(SAMMELSCHRITT)], { encoding: "utf8", env: { ...env, NEEDS: JSON.stringify(Object.fromEntries(Object.entries(ABRUF_ERGEBNISSE).map(([job, result]) => [job, { result }]))) } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /pruefungen: skipped/);
});

test("der Mutationsplan misst im PR, beim Abruf und in der Queue mit anderem Stand, sonst nicht", (context) => {
  assert.ok(misst(schritt(context, PLAN, { EVENT_NAME: "pull_request" })));
  assert.ok(misst(schritt(context, PLAN, { EVENT_NAME: ABRUF })));
  assert.ok(misst(schritt(context, PLAN, { EVENT_NAME: "merge_group", GLEICH: "false" })));
  for (const variablen of [{ EVENT_NAME: "merge_group", GLEICH: "true" }, { EVENT_NAME: "push" }]) {
    const lauf = schritt(context, PLAN, variablen);
    assert.equal(lauf.status, 0, lauf.meldung);
    assert.deepEqual(lauf.aufrufe, []);
    assert.match(lauf.ausgaben, /^messen=nein$/m);
  }
});

test("beim Abruf bricht der Mutationsplan ab, wenn die Basis keine volle Commit-SHA in Kleinbuchstaben ist", (context) => {
  for (const basis of [BASIS.slice(1), BASIS.toUpperCase(), `${BASIS.slice(1)};`, ""]) {
    const lauf = schritt(context, PLAN, { EVENT_NAME: ABRUF, PR_BASE_SHA: basis });
    assert.equal(lauf.status, EXIT_ROT, `${basis}: ${lauf.meldung}`);
    assert.deepEqual(lauf.aufrufe, [], basis);
    assert.match(lauf.meldung, /basis muss eine Commit-SHA/);
  }
});

test("Plan, Teil und Urteil hängen den alten Stand genau dann an, wenn der Schalter an ist", (context) => {
  for (const name of MUTATIONSSCHRITTE) {
    const an = schritt(context, name, { EVENT_NAME: ABRUF, ALTER_STAND: "true" });
    assert.equal(an.aufrufe.length, 1, `${name}: ${an.meldung}`);
    assert.ok(an.aufrufe[0].includes(ALTER_STAND), `${name}: ${an.aufrufe[0]}`);
    for (const aus of ["false", ""]) {
      const lauf = schritt(context, name, { ALTER_STAND: aus });
      assert.equal(lauf.aufrufe.length, 1, `${name} ${aus}: ${lauf.meldung}`);
      assert.ok(!lauf.aufrufe[0].includes(ALTER_STAND), `${name} ${aus}: ${lauf.aufrufe[0]}`);
    }
  }
});

test("Plan, Teil und Urteil nehmen Basis und alten Stand aus denselben Eingaben des Abrufs", () => {
  for (const name of MUTATIONSSCHRITTE) {
    const zeilen = workflowStepLines(CI, name).map((zeile) => zeile.trim());
    for (const [variable, wert] of Object.entries(STEP_ENV)) assert.ok(zeilen.includes(`${variable}: ${wert}`), `${name}: ${variable}`);
  }
});

test("der Urteilsschritt legt Ausgabe und Exit-Code ab und endet mit dem Exit-Code des Werkzeugs", (context) => {
  for (const exitCode of URTEIL_EXITS) {
    const lauf = schritt(context, URTEIL, { NPM_EXIT: String(exitCode) });
    assert.equal(lauf.status, exitCode, lauf.meldung);
    assert.equal(readFileSync(join(lauf.ordner, "urteil", "exit-code"), "utf8").trim(), String(exitCode));
    const abgelegt = readFileSync(join(lauf.ordner, "urteil", "ausgabe.txt"), "utf8");
    assert.match(abgelegt, /^grün: Urteil der Attrappe$/m);
    assert.match(abgelegt, /^Hinweis der Attrappe$/m);
  }
});

test("das abgelegte Urteil wird auch bei rotem Urteil als Artefakt mutationsurteil hochgeladen", () => {
  const zeilen = workflowStepLines(CI, "Mutationsurteil hochladen").map((zeile) => zeile.trim());
  assert.ok(zeilen.includes("if: always() && needs.mutationsplan.outputs.messen == 'ja'"));
  assert.ok(zeilen.includes("name: mutationsurteil"));
  assert.ok(zeilen.includes("path: ${{ runner.temp }}/urteil/"));
});

const TESTUMBAU = "--testumbau";

test("der Abruf von Hand nimmt den Testumbau als Schalter, der aus ist, und Plan, Teil und Urteil lesen ihn aus derselben Eingabe", () => {
  assert.deepEqual(abrufEingaben().testumbau.default, "false");
  assert.equal(abrufEingaben().testumbau.type, "boolean");
  for (const name of MUTATIONSSCHRITTE) assert.ok(workflowStepLines(CI, name).map((zeile) => zeile.trim()).includes("TESTUMBAU: ${{ inputs.testumbau }}"), name);
});

function messaufruf(lauf) {
  const aufrufe = lauf.aufrufe.filter((aufruf) => aufruf.includes("--basis"));
  assert.equal(aufrufe.length, 1, lauf.meldung);
  return aufrufe[0];
}

test("Plan, Teil und Urteil hängen den Testumbau genau dann an, wenn der Schalter an ist", (context) => {
  for (const name of MUTATIONSSCHRITTE) {
    const an = messaufruf(schritt(context, name, { EVENT_NAME: ABRUF, TESTUMBAU: "true" }));
    assert.ok(an.includes(TESTUMBAU), `${name}: ${an}`);
    assert.ok(!an.includes(ALTER_STAND), `${name}: ${an}`);
    for (const aus of ["false", ""]) {
      const aufruf = messaufruf(schritt(context, name, { TESTUMBAU: aus }));
      assert.ok(!aufruf.includes(TESTUMBAU), `${name} ${aus}: ${aufruf}`);
    }
  }
});

test("der Mutationsplan bricht beim Abruf ab, wenn alter Stand und Testumbau zusammen verlangt sind, und startet kein Werkzeug", (context) => {
  const lauf = schritt(context, PLAN, { EVENT_NAME: ABRUF, ALTER_STAND: "true", TESTUMBAU: "true" });
  assert.equal(lauf.status, EXIT_ROT, lauf.meldung);
  assert.deepEqual(lauf.aufrufe, []);
  assert.match(lauf.meldung, /alter_stand und testumbau schließen sich aus/);
});
