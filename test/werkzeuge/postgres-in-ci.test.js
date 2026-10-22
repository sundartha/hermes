import assert from "node:assert/strict";
import { test } from "node:test";

import { hauptversionLautSquawk } from "../gemeinsam/echtes-postgres.js";
import { workflowLines, workflowStepLines } from "./workflow-dateien.js";

const CI = "ci.yml";
const VARIABLE = "HERMES_TEST_POSTGRES_URL";
const JOB_KOPF = /^ {2}[a-z][\w-]*:$/;
const BILD = /^ {8}image: postgres:(\d+)\.\d+@sha256:[0-9a-f]{64}$/;

function jobZeilen(job) {
  const zeilen = workflowLines(CI);
  const beginn = zeilen.indexOf(`  ${job}:`);
  assert.notEqual(beginn, -1, `Job ${job} fehlt in ${CI}`);
  const rest = zeilen.slice(beginn + 1);
  const ende = rest.findIndex((zeile) => JOB_KOPF.test(zeile));
  return ende === -1 ? rest : rest.slice(0, ende);
}

function postgresBild(job) {
  const zeilen = jobZeilen(job);
  const dienst = zeilen.indexOf("      postgres:");
  assert.ok(zeilen.includes("    services:") && dienst !== -1, `Job ${job} hat keinen Dienst postgres`);
  const treffer = BILD.exec(zeilen[dienst + 1] ?? "");
  assert.ok(treffer, `Job ${job}: Bild postgres mit Version und Digest fehlt`);
  return Number(treffer[1]);
}

function setztAdresse(schritt) {
  const zeilen = workflowStepLines(CI, schritt);
  const umgebung = zeilen.indexOf("        env:");
  const befehl = zeilen.findIndex((zeile) => zeile.startsWith("        run:"));
  const eintraege = umgebung === -1 || befehl < umgebung ? [] : zeilen.slice(umgebung + 1, befehl);
  return eintraege.some((zeile) => zeile.startsWith(`          ${VARIABLE}: postgres://`));
}

test("CI: Tests und Testwirkung laufen gegen echtes Postgres in der Hauptversion aus tools/basis/squawk.toml", () => {
  const hauptversion = hauptversionLautSquawk();
  assert.equal(postgresBild("tests"), hauptversion);
  assert.equal(postgresBild("pruefungen"), hauptversion);
  assert.ok(setztAdresse("Tests"), `Schritt Tests setzt ${VARIABLE} nicht`);
  assert.ok(setztAdresse("Testwirkung"), `Schritt Testwirkung setzt ${VARIABLE} nicht`);
});
