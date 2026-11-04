import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowJobLines } from "./workflow-dateien.js";

const CI = "ci.yml";
const JOB = "pruefungen";
const JOB_GRENZE = /^ {4}timeout-minutes: (\d+)$/;
const LAENGSTER_GEMESSENER_JOB_MINUTEN = 59;
const JOB_OBERGRENZE = 90;

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
