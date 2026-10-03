import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/workflows-pruefen.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const WORKFLOW_FILE = "probe.yml";
const PINNED_CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const PULL_REQUEST_TRIGGER = ["on:", "  pull_request:", "    branches: [master]"];
const WORKFLOW_RUN_TRIGGER = ["on:", "  workflow_run:", '    workflows: ["CI"]'];

function workflow(triggerLines, stepLines) {
  return [
    "name: Probe",
    ...triggerLines,
    "jobs:",
    "  probe:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    ...stepLines,
    "",
  ].join("\n");
}

function lineNumberOf(content, text) {
  return content.split("\n").findIndex((line) => line.includes(text)) + 1;
}

function runCheck(content) {
  const dir = mkdtempSync(join(tmpdir(), "workflows-pruefen-lieferkette-"));
  try {
    writeFileSync(join(dir, WORKFLOW_FILE), content);
    const run = spawnSync(process.execPath, [SCRIPT_PATH, dir], { encoding: "utf8" });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertFindingAt(content, text) {
  const result = runCheck(content);
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, new RegExp(`probe\\.yml:${lineNumberOf(content, text)}: `));
  return result.output;
}

function assertClean(content) {
  const result = runCheck(content);
  assert.equal(result.status, EXIT_OK, result.output);
  assert.equal(result.output, "");
}

test("workflows-pruefen: eine per Tag eingebundene Action stoppt die Pruefung", () => {
  const content = workflow(PULL_REQUEST_TRIGGER, ["      - uses: actions/checkout@v4"]);
  const output = assertFindingAt(content, "actions/checkout@v4");
  assert.match(output, /actions\/checkout@v4/);
});

test("workflows-pruefen: eine gekuerzte Commit-SHA stoppt die Pruefung", () => {
  const content = workflow(PULL_REQUEST_TRIGGER, ["      - uses: actions/checkout@11d5960"]);
  assertFindingAt(content, "actions/checkout@11d5960");
});

test("workflows-pruefen: eine Action per voller Commit-SHA mit Versionshinweis ist erlaubt", () => {
  assertClean(workflow(PULL_REQUEST_TRIGGER, [`      - uses: ${PINNED_CHECKOUT} # v4`]));
});

test("workflows-pruefen: der Ausloeser pull_request_target stoppt die Pruefung", () => {
  const content = workflow(["on:", "  pull_request_target:"], ["      - run: npm test"]);
  assertFindingAt(content, "pull_request_target");
});

test("workflows-pruefen: npm ci ohne --ignore-scripts stoppt die Pruefung", () => {
  const content = workflow(PULL_REQUEST_TRIGGER, ["      - run: npm ci"]);
  assertFindingAt(content, "npm ci");
});

test("workflows-pruefen: npm ci mit --ignore-scripts=false stoppt die Pruefung", () => {
  const content = workflow(PULL_REQUEST_TRIGGER, ["      - run: npm ci --ignore-scripts=false"]);
  assertFindingAt(content, "npm ci");
});

test("workflows-pruefen: npm ci mit --ignore-scripts und ein Schritt namens npm ci sind erlaubt", () => {
  assertClean(
    workflow(PULL_REQUEST_TRIGGER, ["      - name: npm ci", "        run: npm ci --ignore-scripts"]),
  );
});

test("workflows-pruefen: ein Secret in einem Workflow fuer Pull Requests stoppt die Pruefung", () => {
  const content = workflow(PULL_REQUEST_TRIGGER, ['      - run: echo "${{ secrets.BEISPIEL }}"']);
  assertFindingAt(content, "secrets.BEISPIEL");
});

test("workflows-pruefen: auch secrets.GITHUB_TOKEN stoppt einen Workflow fuer Pull Requests", () => {
  const content = workflow(
    ["on: [push, pull_request]"],
    ["      - run: gh pr view", "        env:", "          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}"],
  );
  assertFindingAt(content, "secrets.GITHUB_TOKEN");
});

test("workflows-pruefen: github.token ist in einem Workflow fuer Pull Requests erlaubt", () => {
  assertClean(
    workflow(PULL_REQUEST_TRIGGER, [
      "      - run: gh pr view",
      "        env:",
      "          GH_TOKEN: ${{ github.token }}",
    ]),
  );
});

test("workflows-pruefen: workflow_run gilt nicht als Pull Request, Secrets nur aus der Liste", () => {
  const content = workflow(WORKFLOW_RUN_TRIGGER, ['      - run: echo "${{ secrets.BEISPIEL }}"']);
  const output = assertFindingAt(content, "secrets.BEISPIEL");
  assert.doesNotMatch(output, /Pull Requests/);
});

test("workflows-pruefen: ein Workflow ohne erkennbaren Ausloeser wird wie einer fuer Pull Requests geprueft", () => {
  const content = workflow([], ['      - run: echo "${{ secrets.BEISPIEL }}"']);
  assertFindingAt(content, "secrets.BEISPIEL");
});
