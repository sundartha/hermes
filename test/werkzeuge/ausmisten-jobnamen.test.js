import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { basisJobName, branchJobName } from "../../tools/tests-ausmisten/festgehalten.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const WORKFLOWS = ".github/workflows";
const AUFRUFER = "tests-ausmisten.yml";
const PAKET = 3;
const JOB_ANFANG = /^ {2}\S/;
const JOB_NAME = /^ {4}name: (.+)$/;
const AUFRUF = /^ {4}uses: \.\/\.github\/workflows\/(\S+)$/;
const MATRIX_PAKET = /\$\{\{ matrix\.paket \}\}/g;
const JOB_ID = /^ {2}(\S+):$/;
const JOB_NEEDS = /^ {4}needs: \[?([^\]]+)\]?$/;
const JOB_BEDINGUNG = /^ {4}if: (.+)$/;
const IMMER = "always() && ";
const HERKUNFT = [
  "(github.event.workflow_run.path == '.github/workflows/ausmisten-eingang.yml' || startsWith(github.event.workflow_run.path, '.github/workflows/ausmisten-eingang.yml@'))",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_repository.full_name == github.repository",
  "startsWith(github.event.workflow_run.head_branch, 'ausmisten/')",
  "github.event.workflow_run.conclusion == 'success'",
].join(" && ");
const PLANEN_UEBERSPRUNGEN = /^needs\.(\S+)\.result != 'skipped'$/;

function jobBloecke(datei) {
  const zeilen = readFileSync(join(REPO_ROOT, WORKFLOWS, datei), "utf8").split("\n");
  const bloecke = [];
  for (const zeile of zeilen.slice(zeilen.indexOf("jobs:") + 1)) {
    if (JOB_ANFANG.test(zeile)) bloecke.push([]);
    bloecke.at(-1)?.push(zeile);
  }
  return bloecke;
}

function ersterTreffer(block, muster) {
  return block.map((zeile) => muster.exec(zeile)?.[1]).find(Boolean);
}

function jobs(datei) {
  return jobBloecke(datei).map((block) => ({
    name: ersterTreffer(block, JOB_NAME),
    aufruf: ersterTreffer(block, AUFRUF),
  }));
}

function namenBeiGitHub(paket) {
  return jobs(AUFRUFER)
    .filter((job) => job.aufruf !== undefined)
    .flatMap((job) =>
      jobs(job.aufruf).map((innen) => `${job.name.replace(MATRIX_PAKET, String(paket))} / ${innen.name}`),
    );
}

test("ausmisten-jobnamen: melden sucht Basis- und Branch-Job unter den Namen, die die Workflow-Dateien GitHub geben", () => {
  const namen = namenBeiGitHub(PAKET);
  assert.ok(namen.includes(basisJobName(PAKET)), `${basisJobName(PAKET)} fehlt in ${namen.join(", ")}`);
  assert.ok(namen.includes(branchJobName(PAKET)), `${branchJobName(PAKET)} fehlt in ${namen.join(", ")}`);
});

function jobAbhaengigkeiten(datei) {
  return jobBloecke(datei).map((block) => ({
    id: ersterTreffer(block, JOB_ID),
    needs: (ersterTreffer(block, JOB_NEEDS) ?? "").split(", ").filter(Boolean),
    bedingung: ersterTreffer(block, JOB_BEDINGUNG),
  }));
}

function bedingungGilt(bedingung, herkunftStimmt, ergebnis) {
  if (bedingung === HERKUNFT) return herkunftStimmt;
  const planen = PLANEN_UEBERSPRUNGEN.exec(bedingung);
  assert.ok(planen, `unbekannte Bedingung: ${bedingung}`);
  return ergebnis[planen[1]] !== "skipped";
}

function laeuft({ needs, bedingung }, herkunftStimmt, ergebnis) {
  const immer = bedingung?.startsWith(IMMER) === true;
  const vorgaenger = needs.every((vorher) => {
    assert.ok(vorher in ergebnis, `${vorher} muss in der Datei vor dem Job stehen, der es braucht`);
    return ergebnis[vorher] === "success";
  });
  if (bedingung === undefined) return vorgaenger;
  const gilt = bedingungGilt(immer ? bedingung.slice(IMMER.length) : bedingung, herkunftStimmt, ergebnis);
  return gilt && (immer || vorgaenger);
}

function laufDurchspielen(datei, { herkunftStimmt, scheitert }) {
  const ergebnis = {};
  for (const job of jobAbhaengigkeiten(datei)) {
    const ausgang = scheitert === job.id ? "failure" : "success";
    ergebnis[job.id] = laeuft(job, herkunftStimmt, ergebnis) ? ausgang : "skipped";
  }
  return ergebnis;
}

test("ausmisten-jobnamen: bei fremder Herkunft des Laufs startet kein Job von tests-ausmisten.yml", () => {
  assert.deepEqual(laufDurchspielen(AUFRUFER, { herkunftStimmt: false }), {
    planen: "skipped",
    vorpruefen: "skipped",
    kette: "skipped",
    melden: "skipped",
  });
});

test("ausmisten-jobnamen: bei richtiger Herkunft läuft jeder Job, nach einem Fehler in planen nur melden", () => {
  assert.deepEqual(laufDurchspielen(AUFRUFER, { herkunftStimmt: true }), {
    planen: "success",
    vorpruefen: "success",
    kette: "success",
    melden: "success",
  });
  assert.deepEqual(laufDurchspielen(AUFRUFER, { herkunftStimmt: true, scheitert: "planen" }), {
    planen: "failure",
    vorpruefen: "skipped",
    kette: "skipped",
    melden: "success",
  });
});
