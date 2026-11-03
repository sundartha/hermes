import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowJobLines, workflowStepLines } from "./workflow-dateien.js";

const CI = "ci.yml";
const JOB = "pruefungen";
const SCHRITT = "Testwirkung";
const JOB_GRENZE = /^ {4}timeout-minutes: (\d+)$/;
const SCHRITT_GRENZE = /^ {8}timeout-minutes: (\d+)$/;
const LAENGSTER_GEMESSENER_JOB_MINUTEN = 59;
const LAENGSTE_GEMESSENE_TESTWIRKUNG_MINUTEN = 57;
const JOB_OBERGRENZE = 90;
const SCHRITT_OBERGRENZE = 75;

function grenzen(zeilen, muster) {
  return zeilen
    .map((zeile) => muster.exec(zeile))
    .filter(Boolean)
    .map((treffer) => Number(treffer[1]));
}

test("CI: der Job Prüfungen bricht nach höchstens 90 Minuten ab und trägt trotzdem den längsten gemessenen Lauf", () => {
  const werte = grenzen(workflowJobLines(CI, JOB), JOB_GRENZE);
  assert.equal(werte.length, 1, "Job pruefungen braucht genau ein timeout-minutes");
  assert.ok(werte[0] <= JOB_OBERGRENZE, `Job pruefungen: ${werte[0]} min über ${JOB_OBERGRENZE}`);
  assert.ok(
    werte[0] > LAENGSTER_GEMESSENER_JOB_MINUTEN,
    `Job pruefungen: ${werte[0]} min trägt den gemessenen Lauf nicht`,
  );
});

test("CI: der Schritt Testwirkung hat eine eigene Zeitgrenze unter der des Jobs und über dem längsten gemessenen Lauf", () => {
  const schritt = grenzen(workflowStepLines(CI, SCHRITT), SCHRITT_GRENZE);
  const job = grenzen(workflowJobLines(CI, JOB), JOB_GRENZE);
  assert.equal(schritt.length, 1, "Schritt Testwirkung braucht genau ein timeout-minutes");
  assert.ok(
    schritt[0] <= SCHRITT_OBERGRENZE,
    `Testwirkung: ${schritt[0]} min über ${SCHRITT_OBERGRENZE}`,
  );
  assert.ok(
    schritt[0] > LAENGSTE_GEMESSENE_TESTWIRKUNG_MINUTEN,
    `Testwirkung: ${schritt[0]} min trägt den gemessenen Lauf nicht`,
  );
  assert.ok(schritt[0] < job[0], "Testwirkung muss früher abbrechen als der Job");
});
