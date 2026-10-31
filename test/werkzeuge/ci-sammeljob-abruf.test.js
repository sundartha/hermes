import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { env } from "node:process";
import { test } from "node:test";

import { workflowStepScript } from "./workflow-dateien.js";

const CI = "ci.yml";
const SAMMELSCHRITT = "Alle Jobs erfolgreich";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const ALLE_ERFOLGREICH = { pruefungen: "success", tests: "success", mutationsplan: "success", mutationspruefung: "success", mutationsurteil: "success" };
const ABRUF_OHNE_PRUEFUNGEN = { ...ALLE_ERFOLGREICH, pruefungen: "skipped", tests: "skipped" };

function sammeljob(ereignis, ergebnisse) {
  const needs = Object.fromEntries(Object.entries(ergebnisse).map(([job, result]) => [job, { result }]));
  const umgebung = { ...env, NEEDS: JSON.stringify(needs), EREIGNIS: ereignis };
  const lauf = spawnSync("bash", ["-c", workflowStepScript(CI, SAMMELSCHRITT)], { encoding: "utf8", env: umgebung });
  return { status: lauf.status, meldung: lauf.stdout + lauf.stderr };
}

test("Sammeljob: workflow_dispatch mit übersprungenen Prüfungen und Tests ist grün", () => {
  const lauf = sammeljob("workflow_dispatch", ABRUF_OHNE_PRUEFUNGEN);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.meldung);
});

test("Sammeljob: workflow_dispatch mit fehlgeschlagenen oder abgebrochenen Prüfungen und Tests ist rot", () => {
  for (const [job, result] of [["pruefungen", "failure"], ["tests", "failure"], ["pruefungen", "cancelled"], ["tests", "cancelled"]]) {
    const lauf = sammeljob("workflow_dispatch", { ...ABRUF_OHNE_PRUEFUNGEN, [job]: result });
    assert.equal(lauf.status, EXIT_ROT, `${job} ${result}: ${lauf.meldung}`);
    assert.match(lauf.meldung, new RegExp(`${job}: ${result}`));
  }
});

test("Sammeljob: workflow_dispatch mit übersprungenem Mutationsjob ist rot", () => {
  for (const job of ["mutationsplan", "mutationspruefung", "mutationsurteil"]) {
    const lauf = sammeljob("workflow_dispatch", { ...ABRUF_OHNE_PRUEFUNGEN, [job]: "skipped" });
    assert.equal(lauf.status, EXIT_ROT, `${job}: ${lauf.meldung}`);
    assert.match(lauf.meldung, new RegExp(`${job}: skipped`));
  }
});

test("Sammeljob: pull_request mit übersprungenen Prüfungen und Tests ist rot", () => {
  const lauf = sammeljob("pull_request", ABRUF_OHNE_PRUEFUNGEN);
  assert.equal(lauf.status, EXIT_ROT, lauf.meldung);
  assert.match(lauf.meldung, /pruefungen: skipped/);
  assert.match(lauf.meldung, /tests: skipped/);
});

test("Sammeljob: merge_group mit übersprungenen Prüfungen und Tests ist rot", () => {
  const lauf = sammeljob("merge_group", ABRUF_OHNE_PRUEFUNGEN);
  assert.equal(lauf.status, EXIT_ROT, lauf.meldung);
  assert.match(lauf.meldung, /pruefungen: skipped/);
  assert.match(lauf.meldung, /tests: skipped/);
});

test("Sammeljob: ohne Ereignis und bei push bleiben übersprungene Jobs rot, lauter Erfolge grün", () => {
  for (const ereignis of ["", "push"]) {
    assert.equal(sammeljob(ereignis, ABRUF_OHNE_PRUEFUNGEN).status, EXIT_ROT, ereignis);
    assert.equal(sammeljob(ereignis, ALLE_ERFOLGREICH).status, EXIT_GRUEN, ereignis);
  }
});
