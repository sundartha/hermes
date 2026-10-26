import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowJobLines, workflowStepLines } from "./workflow-dateien.js";

const CI = "ci.yml";
const MATRIX = /^ {8}teil: \[([\d, ]+)\]$/;
const AUSGABE = /^ {6}(teil-\d+): \$\{\{ steps\.bestanden\.outputs\.(teil-\d+) \}\}$/;
const MELDUNG = 'run: echo "teil-$TEIL=';
const SUMME = "BESTANDEN: ${{ toJSON(needs.tests.outputs) }}";

function matrixTeile(job) {
  const treffer = job.map((zeile) => MATRIX.exec(zeile)).find(Boolean);
  assert.ok(treffer, "Job tests hat keine Matrix teil: [..]");
  return treffer[1].split(",").map((teil) => `teil-${teil.trim()}`);
}

function ausgaben(job) {
  const beginn = job.indexOf("    outputs:");
  assert.notEqual(beginn, -1, "Job tests hat keine outputs");
  const eintraege = [];
  for (const zeile of job.slice(beginn + 1)) {
    const treffer = AUSGABE.exec(zeile);
    if (!treffer) break;
    eintraege.push(treffer);
  }
  return eintraege;
}

test("CI: jeder Matrix-Teil der Regressionstests reicht seine bestandenen Tests an die Summe im Sammeljob weiter", () => {
  const job = workflowJobLines(CI, "tests");
  const eintraege = ausgaben(job);
  assert.deepEqual(
    eintraege.map(([, name]) => name),
    matrixTeile(job),
  );
  for (const [, name, quelle] of eintraege) assert.equal(quelle, name);
  assert.ok(
    workflowStepLines(CI, "Bestandene Tests melden").some((zeile) =>
      zeile.trim().startsWith(MELDUNG),
    ),
    "Schritt Bestandene Tests melden schreibt nicht teil-$TEIL",
  );
  assert.ok(
    workflowStepLines(CI, "Bestandene Tests aller Teile").some((zeile) => zeile.trim() === SUMME),
    "Sammeljob summiert nicht needs.tests.outputs",
  );
});
