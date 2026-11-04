import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowJobLines, workflowStepLines } from "./workflow-dateien.js";

const CI = "mutationsteile.yml";
const JOB = "mutationsteil";
const SCHRITT = "Mutationsprüfung";
const WEITERLAUFEN = /continue-on-error/;

test("CI: ein Teil, der an der Zeitgrenze abbricht, bleibt rot", () => {
  assert.equal(workflowJobLines(CI, JOB).filter((zeile) => WEITERLAUFEN.test(zeile)).length, 0);
  assert.equal(
    workflowStepLines(CI, SCHRITT).filter((zeile) => WEITERLAUFEN.test(zeile)).length,
    0,
  );
});
