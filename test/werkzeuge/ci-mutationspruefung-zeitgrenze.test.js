import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowJobLines, workflowStepLines } from "./workflow-dateien.js";

const CI = "ci.yml";
const JOB = "mutationspruefung";
const SCHRITT = "Mutationsprüfung";
const JOB_GRENZE = /^ {4}timeout-minutes: (\d+)$/;
const SCHRITT_GRENZE = /^ {8}timeout-minutes: (\d+)$/;
const WEITERLAUFEN = /continue-on-error/;
const LAENGSTER_GEMESSENER_TEILJOB_MINUTEN = 153;
const LAENGSTER_GEMESSENER_SCHRITT_MINUTEN = 153;
const JOB_OBERGRENZE = 210;
const SCHRITT_OBERGRENZE = 180;

function grenzen(zeilen, muster) {
  return zeilen
    .map((zeile) => muster.exec(zeile))
    .filter(Boolean)
    .map((treffer) => Number(treffer[1]));
}

test("CI: der Job Mutationsprüfung bricht nach höchstens 210 Minuten ab und trägt trotzdem den längsten gemessenen Teil", () => {
  const werte = grenzen(workflowJobLines(CI, JOB), JOB_GRENZE);
  assert.equal(werte.length, 1, "Job mutationspruefung braucht genau ein timeout-minutes");
  assert.ok(
    werte[0] <= JOB_OBERGRENZE,
    `Job mutationspruefung: ${werte[0]} min über ${JOB_OBERGRENZE}`,
  );
  assert.ok(
    werte[0] > LAENGSTER_GEMESSENER_TEILJOB_MINUTEN,
    `Job mutationspruefung: ${werte[0]} min trägt den gemessenen Teil nicht`,
  );
});

test("CI: der Schritt Mutationsprüfung hat eine eigene Zeitgrenze unter der des Jobs und über dem längsten gemessenen Teil", () => {
  const schritt = grenzen(workflowStepLines(CI, SCHRITT), SCHRITT_GRENZE);
  const job = grenzen(workflowJobLines(CI, JOB), JOB_GRENZE);
  assert.equal(schritt.length, 1, "Schritt Mutationsprüfung braucht genau ein timeout-minutes");
  assert.ok(
    schritt[0] <= SCHRITT_OBERGRENZE,
    `Mutationsprüfung: ${schritt[0]} min über ${SCHRITT_OBERGRENZE}`,
  );
  assert.ok(
    schritt[0] > LAENGSTER_GEMESSENER_SCHRITT_MINUTEN,
    `Mutationsprüfung: ${schritt[0]} min trägt den gemessenen Teil nicht`,
  );
  assert.ok(
    schritt[0] < job[0],
    "Mutationsprüfung muss früher abbrechen als der Job, damit das Zeit-Log noch hochgeladen wird",
  );
});

test("CI: ein Teil, der an der Zeitgrenze abbricht, bleibt rot", () => {
  assert.equal(workflowJobLines(CI, JOB).filter((zeile) => WEITERLAUFEN.test(zeile)).length, 0);
  assert.equal(
    workflowStepLines(CI, SCHRITT).filter((zeile) => WEITERLAUFEN.test(zeile)).length,
    0,
  );
});
