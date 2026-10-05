import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/workflows-pruefen.mjs");
const LISTED_NAME = "pruefer-pruefen.yml";
const FOLLOW_UP_NAME = "pruefer-nachstellen.yml";
const OTHER_NAME = "nachtlauf.yml";
const CHECKOUT = "        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const SECRET_LINE = "          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}";
const ENVIRONMENT = "    environment: pruefer";
const WORKFLOW_RUN = ["on:", "  workflow_run:", '    workflows: ["CI"]', "    types: [completed]"];
const PULL_REQUEST = ["on:", "  pull_request:", "    branches: [master]"];
const PUSH = ["on:", "  push:", "    branches: [master]"];
const PULL_REQUEST_MESSAGE = "secrets in einem Workflow, der für Pull Requests läuft";
const PULL_REQUEST_TARGET_MESSAGE = "pull_request_target ist als Auslöser verboten";
const LIST_MESSAGE = "secrets nur in Workflows aus tools/basis/geheimnis-workflows.json";
const ENVIRONMENT_LIST_MESSAGE =
  "environment: nur in Workflows aus tools/basis/geheimnis-workflows.json";
const NO_ENVIRONMENT_MESSAGE = "secrets nur in Jobs mit environment:";
const CHECKOUT_REF_MESSAGE = "actions/checkout mit ref: oder repository: in einem Job mit secrets";
const GIT_SWITCH_MESSAGE =
  "git checkout, switch, worktree, restore oder reset in einem Job mit secrets";
const OTHER_TRIGGER_MESSAGE =
  "workflow_run in einem Workflow aus der Liste nur als einziger Auslöser";
const WRITE_PERMISSION_MESSAGE =
  "statuses: write, checks: write und write-all nur in Workflows mit workflow_run als einzigem Auslöser";
const PRUEFER_NAME_MESSAGE = "kein Job darf Prüfer heißen";

function secretWorkflow({ trigger = WORKFLOW_RUN, jobLines = [ENVIRONMENT], extra = [] } = {}) {
  return [
    "name: Probe",
    ...trigger,
    "permissions: {}",
    "jobs:",
    "  pruefen:",
    "    runs-on: ubuntu-latest",
    ...jobLines,
    "    steps:",
    "      - name: Checkout",
    CHECKOUT,
    "        with:",
    "          persist-credentials: false",
    ...extra,
    "      - name: Holen",
    "        run: git fetch --no-tags origin master",
    "      - name: Pruefen",
    "        env:",
    SECRET_LINE,
    "        run: node pruefen.mjs",
    "",
  ];
}

function plainWorkflow(trigger, headerLines, jobLines = ["  melden:"]) {
  return [
    "name: Probe",
    ...trigger,
    ...headerLines,
    "jobs:",
    ...jobLines,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Prüfer-Programm installieren",
    "        run: echo ok",
    "",
  ];
}

function run(context, files) {
  const directory = probeDirectory(context, files);
  const result = runIn(directory, process.execPath, [TOOL, directory]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectFinding(context, { name = LISTED_NAME, lines, target, message }) {
  const result = run(context, { [name]: lines.join("\n") });
  assert.equal(result.status, 1, result.output);
  const where = `${name}:${lines.indexOf(target) + 1}: ${message}`;
  assert.ok(result.output.includes(where), `${where} fehlt in:\n${result.output}`);
  return result.output;
}

function expectClean(context, name, lines) {
  const result = run(context, { [name]: lines.join("\n") });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
}

test("workflows-pruefen-pruefer: der gelistete Prueferworkflow mit workflow_run und Environment ist erlaubt", (context) => {
  expectClean(context, LISTED_NAME, secretWorkflow());
});

test("workflows-pruefen-pruefer: secrets bleiben bei pull_request auch im gelisteten Workflow verboten", (context) => {
  const lines = secretWorkflow({ trigger: PULL_REQUEST });
  expectFinding(context, { lines, target: SECRET_LINE, message: PULL_REQUEST_MESSAGE });
});

test("workflows-pruefen-pruefer: ein on-Block als Liste ohne Einrueckung mit pull_request gilt als PR-Workflow", (context) => {
  const lines = secretWorkflow({ trigger: ["on:", "- pull_request"] });
  expectFinding(context, { lines, target: SECRET_LINE, message: PULL_REQUEST_MESSAGE });
});

test("workflows-pruefen-pruefer: pull_request_target bleibt verboten", (context) => {
  const target = "  pull_request_target:";
  const lines = secretWorkflow({ trigger: ["on:", target] });
  expectFinding(context, { lines, target, message: PULL_REQUEST_TARGET_MESSAGE });
});

test("workflows-pruefen-pruefer: actions/checkout mit ref: im Job mit secrets ist verboten", (context) => {
  const target = "          ref: ${{ github.event.workflow_run.head_sha }}";
  const lines = secretWorkflow({ extra: [target] });
  expectFinding(context, { lines, target, message: CHECKOUT_REF_MESSAGE });
});

test("workflows-pruefen-pruefer: actions/checkout mit repository: im Job mit secrets ist verboten", (context) => {
  const target = "          repository: ${{ github.event.workflow_run.head_repository.full_name }}";
  const lines = secretWorkflow({ extra: [target] });
  expectFinding(context, { lines, target, message: CHECKOUT_REF_MESSAGE });
});

test("workflows-pruefen-pruefer: actions/checkout mit ref: in einem Job ohne secrets bleibt erlaubt", (context) => {
  const lines = plainWorkflow(WORKFLOW_RUN, ["permissions: {}"]).toSpliced(
    -1,
    0,
    "      - name: Checkout",
    CHECKOUT,
    "        with:",
    "          ref: ${{ github.event.workflow_run.head_sha }}",
    "          path: pr",
    "          persist-credentials: false",
  );
  expectClean(context, FOLLOW_UP_NAME, lines);
});

function expectSwitchFinding(context, command) {
  const target = `        run: ${command}`;
  const lines = secretWorkflow({ extra: ["      - name: Wechseln", target] });
  expectFinding(context, { lines, target, message: GIT_SWITCH_MESSAGE });
}

test("workflows-pruefen-pruefer: git checkout FETCH_HEAD im Job mit secrets ist verboten", (context) => {
  expectSwitchFinding(context, "git checkout FETCH_HEAD");
});

test("workflows-pruefen-pruefer: git -C pr switch --detach FETCH_HEAD im Job mit secrets ist verboten", (context) => {
  expectSwitchFinding(context, "git -C pr switch --detach FETCH_HEAD");
});

test("workflows-pruefen-pruefer: git worktree add pr FETCH_HEAD im Job mit secrets ist verboten", (context) => {
  expectSwitchFinding(context, "git worktree add pr FETCH_HEAD");
});

test("workflows-pruefen-pruefer: git restore --source FETCH_HEAD . im Job mit secrets ist verboten", (context) => {
  expectSwitchFinding(context, "git restore --source FETCH_HEAD .");
});

test("workflows-pruefen-pruefer: git reset --hard FETCH_HEAD im Job mit secrets ist verboten", (context) => {
  expectSwitchFinding(context, "git reset --hard FETCH_HEAD");
});

test("workflows-pruefen-pruefer: gh pr checkout 1 im Job mit secrets ist verboten", (context) => {
  expectSwitchFinding(context, "gh pr checkout 1");
});

test("workflows-pruefen-pruefer: ein Workflow mit Secret ausserhalb der Liste ist verboten", (context) => {
  const lines = secretWorkflow();
  expectFinding(context, { name: OTHER_NAME, lines, target: SECRET_LINE, message: LIST_MESSAGE });
});

test("workflows-pruefen-pruefer: der gelistete workflow_run-Workflow mit weiterem Ausloeser ist verboten", (context) => {
  const lines = secretWorkflow({ trigger: [...WORKFLOW_RUN, "  workflow_dispatch:"] });
  expectFinding(context, { lines, target: "on:", message: OTHER_TRIGGER_MESSAGE });
});

test("workflows-pruefen-pruefer: workflow_run mit weiterem Ausloeser in der Kurzform ist verboten", (context) => {
  const target = "on: [workflow_run, push]";
  const lines = secretWorkflow({ trigger: [target] });
  expectFinding(context, { lines, target, message: OTHER_TRIGGER_MESSAGE });
});

test("workflows-pruefen-pruefer: ein Job mit secrets ohne environment: ist verboten", (context) => {
  const lines = secretWorkflow({ jobLines: [] });
  expectFinding(context, { lines, target: SECRET_LINE, message: NO_ENVIRONMENT_MESSAGE });
});

test("workflows-pruefen-pruefer: secrets ausserhalb eines Jobs sind verboten", (context) => {
  const target = "  TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}";
  const lines = secretWorkflow({ trigger: [...WORKFLOW_RUN, "env:", target] });
  expectFinding(context, { lines, target, message: NO_ENVIRONMENT_MESSAGE });
});

test("workflows-pruefen-pruefer: environment: ausserhalb der Liste ist verboten", (context) => {
  const lines = plainWorkflow(WORKFLOW_RUN, [], ["  melden:", ENVIRONMENT]);
  expectFinding(context, {
    name: OTHER_NAME,
    lines,
    target: ENVIRONMENT,
    message: ENVIRONMENT_LIST_MESSAGE,
  });
});

function expectWriteFinding(context, { trigger, target }) {
  const header = target.startsWith(" ") ? ["permissions:", target] : [target];
  const lines = plainWorkflow(trigger, header);
  expectFinding(context, { name: OTHER_NAME, lines, target, message: WRITE_PERMISSION_MESSAGE });
}

test("workflows-pruefen-pruefer: statuses: write in einem pull_request-Workflow ist verboten", (context) => {
  expectWriteFinding(context, { trigger: PULL_REQUEST, target: "  statuses: write" });
});

test("workflows-pruefen-pruefer: statuses: write in einem push-Workflow ist verboten", (context) => {
  expectWriteFinding(context, { trigger: PUSH, target: "  statuses: write" });
});

test("workflows-pruefen-pruefer: checks: write in einem pull_request-Workflow ist verboten", (context) => {
  expectWriteFinding(context, { trigger: PULL_REQUEST, target: "  checks: write" });
});

test("workflows-pruefen-pruefer: permissions: write-all in einem pull_request-Workflow ist verboten", (context) => {
  expectWriteFinding(context, { trigger: PULL_REQUEST, target: "permissions: write-all" });
});

test("workflows-pruefen-pruefer: statuses: write in einem Workflow nur mit workflow_run ist erlaubt", (context) => {
  expectClean(
    context,
    OTHER_NAME,
    plainWorkflow(WORKFLOW_RUN, ["permissions:", "  statuses: write"]),
  );
});

test("workflows-pruefen-pruefer: ein Job mit name: Pruefer ist verboten", (context) => {
  const target = "    name: Prüfer";
  const lines = plainWorkflow(PULL_REQUEST, [], ["  pruefen:", target]);
  expectFinding(context, { name: OTHER_NAME, lines, target, message: PRUEFER_NAME_MESSAGE });
});

test("workflows-pruefen-pruefer: ein Job mit dem Schluessel Pruefer ist verboten", (context) => {
  const target = "  Prüfer:";
  const lines = plainWorkflow(PULL_REQUEST, [], [target]);
  expectFinding(context, { name: OTHER_NAME, lines, target, message: PRUEFER_NAME_MESSAGE });
});

test("workflows-pruefen-pruefer: Namen, die Pruefer nur enthalten, sind erlaubt", (context) => {
  const lines = plainWorkflow(PULL_REQUEST, [], ["  pruefen:", "    name: Prüfer prüfen"]);
  expectClean(context, OTHER_NAME, lines);
});

test("workflows-pruefen-pruefer: die echten Workflows pruefer-pruefen.yml und pruefer-nachstellen.yml sind erlaubt", (context) => {
  const files = Object.fromEntries(
    [LISTED_NAME, FOLLOW_UP_NAME].map((name) => [
      name,
      readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8"),
    ]),
  );
  const result = run(context, files);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
});

test("workflows-pruefen-pruefer: alle Workflows des Repos bestehen die verschaerfte Pruefung", () => {
  const result = runIn(REPO_ROOT, process.execPath, [TOOL]);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(`${result.stdout}${result.stderr}`, "");
});
