import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowJobLines, workflowLines } from "./workflow-dateien.js";

const CI = "ci.yml";
const SAMMELJOB = "ci";
const JOB_KOPF = /^ {2}([a-z][\w-]*):$/;
const NEEDS = /^ {4}needs: \[(.*)\]$/;

function alleJobs() {
  const zeilen = workflowLines(CI);
  return zeilen.slice(zeilen.indexOf("jobs:") + 1).flatMap((zeile) => JOB_KOPF.exec(zeile)?.[1] ?? []);
}

test("der Sammeljob CI wartet auf jeden anderen Job von ci.yml, damit ein roter Job den Pflicht-Check CI rot macht", () => {
  const gebraucht = workflowJobLines(CI, SAMMELJOB).flatMap((zeile) => NEEDS.exec(zeile)?.[1].split(", ") ?? []);
  assert.deepEqual(gebraucht.toSorted(), alleJobs().filter((job) => job !== SAMMELJOB).toSorted());
});
