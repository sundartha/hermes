import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";

const WORKFLOW = ".github/workflows/pruefleiter.yml";
const PFLICHT_JOBS = ["vorpruefung", "werkzeugtests", "pruefleiter"];
const JOB_KOPF = /^ {2}([^\s#]\S*):$/;
const ZEITGRENZE = /^ {4}timeout-minutes: (.+)$/;
const GANZE_ZAHL = /^[1-9]\d*$/;
const MAXIMUM_MINUTEN = 60;

function jobBloecke(text) {
  const zeilen = text.split("\n");
  const bloecke = new Map();
  let aktuell;
  for (const zeile of zeilen.slice(zeilen.indexOf("jobs:") + 1)) {
    const id = JOB_KOPF.exec(zeile)?.[1];
    if (id !== undefined) {
      aktuell = [];
      bloecke.set(id, aktuell);
    }
    aktuell?.push(zeile);
  }
  return bloecke;
}

function zeitgrenzenBefunde(text) {
  return [...jobBloecke(text)].flatMap(([id, block]) => {
    const werte = block.map((zeile) => ZEITGRENZE.exec(zeile)?.[1]).filter(Boolean);
    if (werte.length !== 1) return [`${id}: ${werte.length} timeout-minutes statt genau einem`];
    if (!GANZE_ZAHL.test(werte[0]))
      return [`${id}: timeout-minutes ${werte[0]} ist keine ganze Zahl über 0`];
    if (Number(werte[0]) > MAXIMUM_MINUTEN)
      return [`${id}: timeout-minutes ${werte[0]} über ${MAXIMUM_MINUTEN}`];
    return [];
  });
}

function datei(jobs) {
  return [
    "name: Probe",
    "jobs:",
    ...jobs.flatMap((job) => [`  ${job.id}:`, "    runs-on: ubuntu-latest", ...job.zeilen]),
  ].join("\n");
}

test("pruefleiter-zeitgrenze: jeder Job in pruefleiter.yml hat eine Zeitgrenze, und die drei Jobs gibt es noch", () => {
  const text = readFileSync(join(REPO_ROOT, WORKFLOW), "utf8");
  for (const id of PFLICHT_JOBS) assert.ok(jobBloecke(text).has(id), `${id} fehlt in ${WORKFLOW}`);
  assert.deepEqual(zeitgrenzenBefunde(text), []);
});

test("pruefleiter-zeitgrenze: ein Job ohne, mit doppelter, mit nicht-ganzzahliger oder mit zu hoher Zeitgrenze ist ein Befund", () => {
  const fall = (zeilen) => zeitgrenzenBefunde(datei([{ id: "a", zeilen }]));
  assert.deepEqual(fall(["    timeout-minutes: 30"]), []);
  assert.deepEqual(fall(["    timeout-minutes: 60"]), []);
  assert.deepEqual(fall(["    steps: []"]), ["a: 0 timeout-minutes statt genau einem"]);
  assert.deepEqual(fall(["    timeout-minutes: 30", "    timeout-minutes: 20"]), [
    "a: 2 timeout-minutes statt genau einem",
  ]);
  assert.deepEqual(fall(["    timeout-minutes: 0"]), [
    "a: timeout-minutes 0 ist keine ganze Zahl über 0",
  ]);
  assert.deepEqual(fall(["    timeout-minutes: 7.5"]), [
    "a: timeout-minutes 7.5 ist keine ganze Zahl über 0",
  ]);
  assert.deepEqual(fall(["    timeout-minutes: ${{ vars.GRENZE }}"]), [
    "a: timeout-minutes ${{ vars.GRENZE }} ist keine ganze Zahl über 0",
  ]);
  assert.deepEqual(fall(["    timeout-minutes: 61"]), ["a: timeout-minutes 61 über 60"]);
  assert.deepEqual(fall(["    timeout-minutes: 360"]), ["a: timeout-minutes 360 über 60"]);
});

test("pruefleiter-zeitgrenze: fehlt die Grenze nur in einem von mehreren Jobs, nennt der Befund genau diesen Job", () => {
  const text = datei([
    { id: "eins", zeilen: ["    timeout-minutes: 30"] },
    { id: "zwei", zeilen: ["    steps: []"] },
    { id: "drei", zeilen: ["    timeout-minutes: 10"] },
  ]);
  assert.deepEqual(zeitgrenzenBefunde(text), ["zwei: 0 timeout-minutes statt genau einem"]);
});
