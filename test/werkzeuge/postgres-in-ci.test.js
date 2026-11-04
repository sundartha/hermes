import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { hauptversionLautSquawk } from "../gemeinsam/echtes-postgres.js";
import { REPO_ROOT } from "./probe-repo.js";
import { workflowJobLines, workflowStepLines } from "./workflow-dateien.js";

const VARIABLE = "HERMES_TEST_POSTGRES_URL";
const ACTION = ".github/actions/postgres/action.yml";
const BILD = /^ {8}POSTGRES_IMAGE: postgres:(\d+)\.\d+@sha256:[0-9a-f]{64}$/m;
const START = ["      - name: Postgres starten", "        uses: ./.github/actions/postgres"];
const MIT_POSTGRES = [
  { datei: "ci.yml", job: "wirkungsteil", schritt: "Testwirkung" },
  { datei: "ci.yml", job: "tests", schritt: "Tests" },
  { datei: "ci.yml", job: "mutationsplan", schritt: "Mutationsplan" },
  { datei: "ci.yml", job: "mutationspruefung", schritt: "Mutationsprüfung" },
  { datei: "ci.yml", job: "mutationsurteil", schritt: "Mutationsurteil" },
  { datei: "vorpruefung.yml", job: "ci-lokal", schritt: "ci-lokal mit teuren Schritten" },
];

function hauptversionDerAction() {
  const treffer = BILD.exec(readFileSync(join(REPO_ROOT, ACTION), "utf8"));
  assert.ok(treffer, `${ACTION}: Bild postgres mit Version und Digest fehlt`);
  return Number(treffer[1]);
}

function startetPostgresVor({ datei, job, schritt }) {
  const zeilen = workflowJobLines(datei, job);
  const start = zeilen.indexOf(START[0]);
  assert.ok(start !== -1 && zeilen[start + 1] === START[1], `${datei} › ${job}: Postgres starten mit ./.github/actions/postgres fehlt`);
  assert.ok(start < zeilen.indexOf(`      - name: ${schritt}`), `${datei} › ${job}: Postgres startet erst nach ${schritt}`);
}

function setztAdresse({ datei, schritt }) {
  const zeilen = workflowStepLines(datei, schritt);
  const umgebung = zeilen.indexOf("        env:");
  const befehl = zeilen.findIndex((zeile) => zeile.startsWith("        run:"));
  const eintraege = umgebung === -1 || befehl < umgebung ? [] : zeilen.slice(umgebung + 1, befehl);
  return eintraege.some((zeile) => zeile.startsWith(`          ${VARIABLE}: postgres://`));
}

test("CI: Tests, Testwirkung, Mutationsplan, Mutationsprüfung und Mutationsurteil laufen gegen echtes Postgres in der Hauptversion aus tools/basis/squawk.toml", () => {
  assert.equal(hauptversionDerAction(), hauptversionLautSquawk());
  for (const ort of MIT_POSTGRES) {
    startetPostgresVor(ort);
    assert.ok(setztAdresse(ort), `${ort.datei} › ${ort.schritt} setzt ${VARIABLE} nicht`);
  }
});
