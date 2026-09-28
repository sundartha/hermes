import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/workflows-pruefen.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const CONTINUE_ON_ERROR_LINE = 8;
const OR_TRUE_LINE = 7;

const CLEAN_WORKFLOW = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  ci:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npm test",
  "",
].join("\n");

function workflowWithStep(stepLines) {
  return [
    "name: CI",
    "on: [push]",
    "jobs:",
    "  ci:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    ...stepLines,
    "",
  ].join("\n");
}

function runCheck(files) {
  const dir = mkdtempSync(join(tmpdir(), "workflows-pruefen-"));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    const run = spawnSync(process.execPath, [SCRIPT_PATH, dir], { encoding: "utf8" });
    return { status: run.status, output: `${run.stdout}${run.stderr}`, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("workflows-pruefen: continue-on-error stoppt die Pruefung und nennt Datei und Zeile", () => {
  const result = runCheck({
    "ci.yml": workflowWithStep(["      - run: npm test", "        continue-on-error: true"]),
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, new RegExp(`ci\\.yml:${CONTINUE_ON_ERROR_LINE}: continue-on-error`));
  assert.ok(result.output.includes(join(result.dir, "ci.yml")), result.output);
});

test("workflows-pruefen: '|| true' in einem run-Befehl stoppt die Pruefung", () => {
  const result = runCheck({ "ci.yml": workflowWithStep(["      - run: foo || true"]) });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, new RegExp(`ci\\.yml:${OR_TRUE_LINE}: \\|\\| true`));
});

test("workflows-pruefen: '||true' ohne Leerzeichen stoppt die Pruefung ebenfalls", () => {
  const result = runCheck({ "ci.yml": workflowWithStep(["      - run: foo ||true"]) });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, new RegExp(`ci\\.yml:${OR_TRUE_LINE}: \\|\\|true`));
});

test("workflows-pruefen: ein Fund in einer zweiten Datei wird auch neben einer sauberen gemeldet", () => {
  const result = runCheck({
    "a-sauber.yml": CLEAN_WORKFLOW,
    "b-drift.yml": workflowWithStep(["      - run: npm test", "        continue-on-error: false"]),
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, new RegExp(`b-drift\\.yml:${CONTINUE_ON_ERROR_LINE}:`));
  assert.doesNotMatch(result.output, /a-sauber\.yml/);
});

test("workflows-pruefen: ein sauberer Workflow ergibt Exit 0 ohne Ausgabe", () => {
  const result = runCheck({ "ci.yml": CLEAN_WORKFLOW });
  assert.equal(result.status, EXIT_OK);
  assert.equal(result.output, "");
});
