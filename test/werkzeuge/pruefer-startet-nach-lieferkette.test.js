import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";

const PRUEFER = readFileSync(join(REPO_ROOT, ".github/workflows/pruefer-pruefen.yml"), "utf8");
const LIEFERKETTE = readFileSync(join(REPO_ROOT, ".github/workflows/lieferkette.yml"), "utf8");
const BEDINGUNG = /^ {4}if: (.+)$/gm;

function bedingungen() {
  return [...PRUEFER.matchAll(BEDINGUNG)].map(([, bedingung]) => bedingung);
}

test("der Prüfer startet nach dem schnellen Pflicht-Workflow Lieferkette, nicht nach der CI", () => {
  assert.match(PRUEFER, /workflow_run:\n {4}workflows: \["Lieferkette"\]/);
  assert.match(LIEFERKETTE, /^name: Lieferkette$/m);
  assert.match(LIEFERKETTE, /^ {2}pull_request:$/m);
  assert.doesNotMatch(PRUEFER, /workflows: \["CI"\]/);
});

test("beide Jobs des Prüfers prüfen Pfad und Ereignis des Lieferketten-Laufs und lassen die CI aus", () => {
  const liste = bedingungen();
  assert.equal(liste.length, 2);
  for (const bedingung of liste) {
    assert.ok(bedingung.includes("'.github/workflows/lieferkette.yml'"), bedingung);
    assert.ok(bedingung.includes("github.event.workflow_run.event == 'pull_request'"), bedingung);
    assert.ok(!bedingung.includes("ci.yml"), bedingung);
  }
});

const ERLAUBT = /contains\(fromJSON\('(\[[^']*\])'\), github\.event\.workflow_run\.conclusion\)/;
const ABSCHLUESSE = [
  "success",
  "failure",
  "cancelled",
  "action_required",
  "skipped",
  "stale",
  "neutral",
  "timed_out",
  "startup_failure",
];

function startetBei(bedingung, conclusion) {
  const [, liste] = ERLAUBT.exec(bedingung) ?? [];
  assert.ok(liste, `Keine Erlaubnisliste für den Abschluss in: ${bedingung}`);
  return JSON.parse(liste).includes(conclusion);
}

test("der Job pruefen startet nur nach success und failure des Lieferketten-Laufs, nicht nach jedem anderen Abschluss", () => {
  const [pruefen] = bedingungen();
  assert.ok(!pruefen.includes("conclusion == 'success'"), pruefen);
  const startet = ABSCHLUESSE.filter((conclusion) => startetBei(pruefen, conclusion));
  assert.deepEqual(startet, ["success", "failure"]);
});

const AUSDRUCK = /\$\{\{\s*(.+?)\s*\}\}/g;
const GRUPPE = /^concurrency:\n {2}group: (.+)\n {2}cancel-in-progress: true$/m.exec(PRUEFER)?.[1] ?? "";

const BEDINGT = /^(github[\w.]+) == '(\w+)' && format\('([^']*)', (github[\w.]+)\) \|\| ''$/;
const EINFACH = /^github[\w.]+$/;

function wertDesAusdrucks(ausdruck, kontext) {
  if (EINFACH.test(ausdruck)) return kontext[ausdruck];
  const [, schluessel, vergleich, muster, einsetzen] = BEDINGT.exec(ausdruck) ?? [];
  assert.ok(schluessel, `Ausdruck ${ausdruck} gehört nicht zu den ausgewerteten Formen`);
  return kontext[schluessel] === vergleich ? muster.replace("{0}", String(kontext[einsetzen])) : "";
}

function wertDerGruppe(kontext) {
  return GRUPPE.replace(AUSDRUCK, (_, ausdruck) => wertDesAusdrucks(ausdruck, kontext));
}

function lieferketteLauf(conclusion, runId) {
  return {
    "github.event.workflow_run.head_repository.full_name": "sundartha/hermes",
    "github.event.workflow_run.head_branch": "paket/x",
    "github.event.workflow_run.conclusion": conclusion,
    "github.run_id": runId,
  };
}

test("ein neuer Push bricht den laufenden Prüferlauf desselben Branches ab", () => {
  assert.match(PRUEFER, /^concurrency:\n {2}group: .+\n {2}cancel-in-progress: true$/m);
  const erster = wertDerGruppe(lieferketteLauf("success", 1));
  const zweiter = wertDerGruppe(lieferketteLauf("failure", 2));
  assert.equal(erster, "pruefer-sundartha/hermes-paket/x");
  assert.equal(zweiter, erster);
});

test("ein abgebrochener Auslöser teilt die Gruppe nicht und bricht den Prüferlauf des neuen Kopfes nicht ab", () => {
  const normal = wertDerGruppe(lieferketteLauf("success", 1));
  const abgebrochen = wertDerGruppe(lieferketteLauf("cancelled", 2));
  assert.notEqual(abgebrochen, normal);
  assert.equal(abgebrochen, "pruefer-sundartha/hermes-paket/x-abgebrochen-2");
  assert.notEqual(wertDerGruppe(lieferketteLauf("cancelled", 3)), abgebrochen);
});
