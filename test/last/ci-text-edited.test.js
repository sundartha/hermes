import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const CI = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const PRUEFUNGEN = ["pruefungen", "semgrep", "tests", "webtests", "codeql", "lastlauf"];
const TEXTLESER = ["rotprobe", "abdeckung", "mutation"];

const WORKFLOW = parse(CI);

function jobText(name) {
  assert.ok(WORKFLOW.jobs[name], `Job ${name} fehlt in ci.yml`);
  return WORKFLOW.jobs[name].if;
}

function laeuft(job, ereignis, aktion, aenderungen) {
  const bedingung = jobText(job);
  if (bedingung === undefined) return true;
  const github = { event_name: ereignis, event: { action: aktion, changes: aenderungen } };
  return Boolean(new Function("github", "always", `return ${bedingung};`)(github, () => true));
}

test("ci-text-edited: Textänderung am PR startet genau Rotprobe, Abdeckung und Mutation, die schweren Prüfungen nicht", () => {
  const edited = (job) => laeuft(job, "pull_request", "edited", { body: { from: "alt" } });
  for (const job of TEXTLESER) assert.equal(edited(job), true, job);
  for (const job of PRUEFUNGEN) assert.equal(edited(job), false, job);
  assert.equal(edited("ci"), true);
});

test("ci-text-edited: Titeländerung ohne Textänderung startet keine Arbeit", () => {
  for (const job of [...TEXTLESER, ...PRUEFUNGEN]) {
    assert.equal(laeuft(job, "pull_request", "edited", { title: { from: "alt" } }), false, job);
  }
});

test("ci-text-edited: opened, synchronize, reopened und Merge-Queue starten wie zuvor", () => {
  for (const aktion of ["opened", "synchronize", "reopened"]) {
    for (const job of [...TEXTLESER, "pruefungen", "semgrep", "tests", "webtests", "codeql"]) {
      assert.equal(laeuft(job, "pull_request", aktion, undefined), true, `${job} ${aktion}`);
    }
    assert.equal(laeuft("lastlauf", "pull_request", aktion, undefined), false, aktion);
  }
  for (const job of ["pruefungen", "semgrep", "tests", "webtests", "lastlauf"]) {
    assert.equal(laeuft(job, "merge_group", "checks_requested", undefined), true, job);
  }
  for (const job of TEXTLESER) assert.equal(laeuft(job, "merge_group", "checks_requested", undefined), false, job);
  assert.equal(laeuft("codeql", "merge_group", "checks_requested", undefined), false);
});

test("ci-text-edited: ein Textlauf bricht laufende Läufe nicht ab, ein neuer Push bricht ihn ab", () => {
  const regel = String(WORKFLOW.concurrency["cancel-in-progress"]);
  const bricht = (aktion) => Boolean(new Function("github", `return ${regel.replace(/^\$\{\{|\}\}$/g, "")};`)({ event_name: "pull_request", event: { action: aktion } }));
  assert.equal(bricht("edited"), false);
  assert.equal(bricht("synchronize"), true);
  assert.match(CI, /^ {2}group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.sha \}\}$/m);
});

function schrittRun(name) {
  const start = CI.indexOf(`- name: ${name}\n`);
  assert.ok(start >= 0, `Schritt ${name} fehlt`);
  const zeilen = CI.slice(start).split("\n\n")[0].split("\n");
  const i = zeilen.findIndex((z) => z.trim() === "run: |");
  return zeilen.slice(i + 1).map((z) => z.slice(10)).join("\n");
}

function fuehreAus(name, env, gh) {
  const ordner = mkdtempSync(join(tmpdir(), "text-edited-"));
  writeFileSync(join(ordner, "gh"), `#!/bin/sh\n${gh ?? "exit 1"}\n`);
  chmodSync(join(ordner, "gh"), 0o755);
  try {
    return spawnSync("bash", ["-c", schrittRun(name)], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${ordner}:${process.env.PATH}`, GITHUB_REPOSITORY: "o/r", KOPF: "abc", ...env },
    });
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function ghMitLaeufen(laeufe) {
  const json = JSON.stringify({ workflow_runs: laeufe });
  return `while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && jq -r "$2" <<'J'\n${json}\nJ\nshift; done`;
}

const lauf = (titel, status, ergebnis, zeit) => ({ display_title: titel, status, conclusion: ergebnis, created_at: zeit });

test("ci-text-edited: Sammel-Job im Textlauf lässt übersprungene schwere Jobs zu, sonst nicht", () => {
  const needs = JSON.stringify({ pruefungen: { result: "skipped" }, tests: { result: "skipped" }, rotprobe: { result: "success" } });
  assert.equal(fuehreAus("Alle Pflicht-Jobs erfolgreich", { NEEDS: needs, TEXT_LAUF: "true" }).status, 0);
  const r = fuehreAus("Alle Pflicht-Jobs erfolgreich", { NEEDS: needs, TEXT_LAUF: "false" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /pruefungen: skipped/);
  const rot = JSON.stringify({ rotprobe: { result: "failure" } });
  assert.equal(fuehreAus("Alle Pflicht-Jobs erfolgreich", { NEEDS: rot, TEXT_LAUF: "true" }).status, 1);
});

test("ci-text-edited: Textlauf ist nur grün, wenn der letzte Hauptlauf des Kopf-Commits grün abgeschlossen ist", () => {
  const schritt = "Hauptlauf des Kopf-Commits ist grün";
  const gruen = lauf("Titel", "completed", "success", "2026-11-22T10:00:00Z");
  assert.equal(fuehreAus(schritt, {}, ghMitLaeufen([gruen])).status, 0);
  const rot = fuehreAus(schritt, {}, ghMitLaeufen([lauf("Titel", "completed", "failure", "2026-11-22T10:00:00Z")]));
  assert.equal(rot.status, 1);
  assert.match(rot.stdout, /Hauptlauf/);
  assert.equal(fuehreAus(schritt, {}, ghMitLaeufen([lauf("Titel", "in_progress", null, "2026-11-22T10:00:00Z")])).status, 1);
  assert.equal(fuehreAus(schritt, {}, ghMitLaeufen([])).status, 1);
  assert.equal(fuehreAus(schritt, {}, ghMitLaeufen([lauf("CI-Text-Lauf", "completed", "success", "2026-11-22T11:00:00Z")])).status, 1);
  const neuerRot = [gruen, lauf("Titel", "completed", "failure", "2026-11-22T11:00:00Z")];
  assert.equal(fuehreAus(schritt, {}, ghMitLaeufen(neuerRot)).status, 1);
  assert.equal(fuehreAus(schritt, {}, ghMitLaeufen([...neuerRot].reverse())).status, 1);
  assert.equal(fuehreAus(schritt, {}, "exit 1").status, 1);
});

test("ci-text-edited: Der Hauptlauf-Schritt läuft nur im Textlauf", () => {
  assert.match(CI, /- name: Hauptlauf des Kopf-Commits ist grün\n {8}if: \$\{\{ github\.event\.action == 'edited' \}\}\n/);
  assert.match(CI, /^on:\n(?:.*\n)*? {4}types: \[opened, synchronize, reopened, edited\]$/m);
});
