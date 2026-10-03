import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/workflows-pruefen.mjs");
const LISTED_NAME = "wiederherstellung.yml";
const SECOND_LISTED_NAME = "rotproben.yml";
const OTHER_NAME = "nachtlauf.yml";
const SECRET_LINE = "          ZUGANG: ${{ secrets.ZUGANG }}";
const LIST_MESSAGE = "secrets nur in Workflows aus tools/basis/geheimnis-workflows.json";
const PULL_REQUEST_MESSAGE = "secrets in einem Workflow, der für Pull Requests läuft";
const NOT_PULL_REQUEST = ["on:", "  schedule:", "    - cron: '0 3 * * *'", "  workflow_dispatch:"];
const PULL_REQUEST = ["on:", "  pull_request:", "    branches: [master]"];
const ENVIRONMENT_MESSAGE =
  "Environment produktion nur in Workflows aus tools/basis/geheimnis-workflows.json";
const INLINE_PRODUCTION = "    environment: produktion";
const QUOTED_PRODUCTION = "    environment: 'produktion'";
const BLOCK_PRODUCTION = "      name: produktion";
const FLOW_PRODUCTION = "    environment: { name: produktion, url: https://example.invalid }";
const OTHER_ENVIRONMENT = "    environment: rotproben";

function workflowLines(triggerLines) {
  return [
    "name: Probe",
    ...triggerLines,
    "jobs:",
    "  probe:",
    "    runs-on: ubuntu-latest",
    "    environment: produktion",
    "    steps:",
    "      - name: Schritt",
    "        env:",
    SECRET_LINE,
    "        run: echo ok",
    "",
  ];
}

function environmentLines(environment) {
  return [
    "name: Probe",
    ...NOT_PULL_REQUEST,
    "jobs:",
    "  probe:",
    "    runs-on: ubuntu-latest",
    ...environment,
    "    steps:",
    "      - name: Schritt",
    "        run: echo ok",
    "",
  ];
}

function runTool(context, name, { lines, target }) {
  const directory = probeDirectory(context, { [name]: lines.join("\n") });
  const run = runIn(directory, process.execPath, [TOOL, directory]);
  const where = `${name}:${lines.indexOf(target) + 1}: `;
  return { status: run.status, output: `${run.stdout}${run.stderr}`, where };
}

function check(context, name, triggerLines) {
  return runTool(context, name, { lines: workflowLines(triggerLines), target: SECRET_LINE });
}

function checkEnvironment(context, name, environment) {
  const target = environment.at(-1);
  return runTool(context, name, { lines: environmentLines(environment), target });
}

test("geheimnis-workflows: ein nicht gelisteter Workflow ohne PR-Ausloeser darf keine secrets enthalten", (context) => {
  const result = check(context, OTHER_NAME, NOT_PULL_REQUEST);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`${result.where}${LIST_MESSAGE}`), result.output);
  assert.ok(!result.output.includes(PULL_REQUEST_MESSAGE), result.output);
});

test("geheimnis-workflows: der gelistete Workflow ohne PR-Ausloeser darf secrets benutzen", (context) => {
  const result = check(context, LISTED_NAME, NOT_PULL_REQUEST);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
});

test("geheimnis-workflows: rotproben.yml steht ebenfalls auf der Liste und darf secrets benutzen", (context) => {
  const result = check(context, SECOND_LISTED_NAME, NOT_PULL_REQUEST);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
});

test("geheimnis-workflows: der gelistete Workflow mit pull_request bleibt gesperrt", (context) => {
  const result = check(context, LISTED_NAME, PULL_REQUEST);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`${result.where}${PULL_REQUEST_MESSAGE}`), result.output);
  assert.ok(!result.output.includes(LIST_MESSAGE), result.output);
});

test("geheimnis-workflows: der gelistete Workflow ohne erkennbaren Ausloeser bleibt gesperrt", (context) => {
  const result = check(context, LISTED_NAME, []);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`${result.where}${PULL_REQUEST_MESSAGE}`), result.output);
});

test("geheimnis-workflows: ein nicht gelisteter Workflow darf das Environment produktion nicht nennen", (context) => {
  const result = checkEnvironment(context, OTHER_NAME, [INLINE_PRODUCTION]);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`${result.where}${ENVIRONMENT_MESSAGE}`), result.output);
});

test("geheimnis-workflows: environment produktion in Anfuehrungszeichen bleibt ausserhalb der Liste gesperrt", (context) => {
  const result = checkEnvironment(context, OTHER_NAME, [QUOTED_PRODUCTION]);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`${result.where}${ENVIRONMENT_MESSAGE}`), result.output);
});

test("geheimnis-workflows: die Blockform mit name: produktion ist ausserhalb der Liste gesperrt", (context) => {
  const result = checkEnvironment(context, OTHER_NAME, ["    environment:", BLOCK_PRODUCTION]);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`${result.where}${ENVIRONMENT_MESSAGE}`), result.output);
});

test("geheimnis-workflows: die einzeilige Form mit geschweiften Klammern ist ausserhalb der Liste gesperrt", (context) => {
  const result = checkEnvironment(context, OTHER_NAME, [FLOW_PRODUCTION]);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`${result.where}${ENVIRONMENT_MESSAGE}`), result.output);
});

test("geheimnis-workflows: ein anderes Environment wie rotproben ist nicht betroffen", (context) => {
  const result = checkEnvironment(context, OTHER_NAME, [OTHER_ENVIRONMENT]);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
});

test("geheimnis-workflows: der gelistete Workflow darf das Environment produktion nennen", (context) => {
  const result = checkEnvironment(context, LISTED_NAME, [INLINE_PRODUCTION]);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
});
