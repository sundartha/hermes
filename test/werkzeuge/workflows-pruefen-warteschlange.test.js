import assert from "node:assert/strict";
import { test } from "node:test";

import { expectClean, expectFinding, runCheck } from "./workflows-probe.mjs";

const QUEUE_TRIGGER = ["  merge_group:", "    types: [checks_requested]"];
const SECRET = "          GH_TOKEN: ${{ secrets.BOT_TOKEN }}";
const PULL_REQUEST_SECRETS = "secrets in einem Workflow, der für Pull Requests läuft";
const OUTSIDE_LIST = "secrets nur in Workflows aus tools/basis/geheimnis-workflows.json";
const JOB_CONDITION =
  "if: eines Jobs nennt pull_request, aber nicht merge_group; in der Warteschlange würde der Job übersprungen und zählte als bestanden";
const PULL_REQUEST_ONLY = "    if: github.event.pull_request.base.ref == 'master'";
const BOTH_EVENTS =
  "    if: github.event_name == 'merge_group' || github.event.pull_request.base.ref == 'master'";

function secretWorkflow(triggers) {
  return [
    "name: Soll und Rot-Proben",
    "on:",
    "  workflow_dispatch:",
    ...triggers,
    "permissions: {}",
    "jobs:",
    "  rotproben:",
    "    name: Rot-Proben",
    "    runs-on: ubuntu-latest",
    "    environment: rotproben",
    "    steps:",
    "      - name: Rot-Proben",
    "        env:",
    SECRET,
    "        run: node tools/rotproben-woche.mjs",
    "",
  ];
}

function conditionalWorkflow(triggers, condition) {
  return [
    "name: Bedingt",
    "on:",
    ...triggers,
    "permissions:",
    "  contents: read",
    "jobs:",
    "  bedingt:",
    condition,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Schritt",
    "        run: echo ok",
    "",
  ];
}

test("ein Workflow der Secret-Liste mit merge_group und secrets ist rot", (context) => {
  expectFinding(context, {
    name: "rotproben.yml",
    lines: secretWorkflow(QUEUE_TRIGGER),
    target: SECRET,
    message: PULL_REQUEST_SECRETS,
  });
});

test("derselbe Workflow der Secret-Liste ohne merge_group bleibt grün", (context) => {
  expectClean(context, "rotproben.yml", secretWorkflow([]));
});

test("ein nicht gelisteter Workflow mit merge_group und secrets bleibt rot", (context) => {
  const output = expectFinding(context, {
    name: "rotprobe.yml",
    lines: secretWorkflow(QUEUE_TRIGGER),
    target: SECRET,
    message: OUTSIDE_LIST,
  });
  assert.ok(output.includes(PULL_REQUEST_SECRETS), output);
});

test("ein Job-if nur mit pull_request in einem Workflow mit merge_group ist rot", (context) => {
  expectFinding(context, {
    name: "bedingt.yml",
    lines: conditionalWorkflow(QUEUE_TRIGGER, PULL_REQUEST_ONLY),
    target: PULL_REQUEST_ONLY,
    message: JOB_CONDITION,
  });
});

test("ein Job-if, das auch merge_group nennt, bleibt grün", (context) => {
  expectClean(context, "bedingt.yml", conditionalWorkflow(QUEUE_TRIGGER, BOTH_EVENTS));
});

test("ohne merge_group im Auslöser gilt die Regel zum Job-if nicht", (context) => {
  const triggers = ["  pull_request:", "    branches: [master]"];
  expectClean(context, "bedingt.yml", conditionalWorkflow(triggers, PULL_REQUEST_ONLY));
});

test("merge_group in der Kurzschreibweise des Auslösers zählt ebenso", (context) => {
  const lines = conditionalWorkflow([], PULL_REQUEST_ONLY);
  lines[1] = "on: [pull_request, merge_group]";
  const result = runCheck(context, { "bedingt.yml": lines.join("\n") });
  assert.equal(result.status, 1, result.output);
  const where = `bedingt.yml:${lines.indexOf(PULL_REQUEST_ONLY) + 1}: ${JOB_CONDITION}`;
  assert.ok(result.output.includes(where), result.output);
});
