import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";
import { expectClean, expectFinding } from "./workflows-probe.mjs";

const FAKE_NAME = "zweiter-pruefer.yml";
const DUPLICATE_MESSAGE = "derselbe Workflow-Name steht schon in einer anderen Datei";
const REFERENCE_MESSAGE =
  "workflow_run nennt einen Workflow-Namen, der nicht zu genau einer Datei passt";
const PRUEFER_NAME_MESSAGE = "kein Job darf Prüfer heißen";
const ESCAPE_MESSAGE = "\\u-, \\U- und \\x-Escapes sind in Workflow-Dateien verboten";
const ANCHOR_MESSAGE = "YAML-Anker und -Aliase (&name, *name) sind in Workflow-Dateien verboten";
const JOB_FILE = "probe.yml";
const REAL_PRUEFER = readFileSync(join(REPO_ROOT, ".github/workflows/pruefer-pruefen.yml"), "utf8");

function pullRequestWorkflow(nameLine) {
  return [
    nameLine,
    "on:",
    "  pull_request:",
    "    branches: [master]",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  probe:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Ergebnis hochladen",
    "        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "        with:",
    "          name: pruefer-ergebnis-pr1",
    "          path: ergebnis",
    "",
  ];
}

function jobWorkflow(jobLines, headerLines = []) {
  return [
    "name: Probe",
    "on:",
    "  pull_request:",
    "    branches: [master]",
    "permissions:",
    "  contents: read",
    ...headerLines,
    "jobs:",
    "  probe:",
    ...jobLines,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Schritt",
    "        run: echo ok",
    "",
  ];
}

function expectJobFinding(context, { target, message, headerLines = [] }) {
  const jobLines = headerLines.includes(target) ? [] : [target];
  const lines = jobWorkflow(jobLines, headerLines);
  expectFinding(context, { name: JOB_FILE, lines, target, message });
}

function followUpWorkflow(triggerLines) {
  return [
    "name: Folgelauf",
    "on:",
    "  workflow_run:",
    ...triggerLines,
    "    types: [completed]",
    "permissions: {}",
    "jobs:",
    "  folgen:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Schritt",
    "        run: echo ok",
    "",
  ];
}

test("workflows-pruefen-namen: ein zweiter Workflow namens Prüfer prüfen mit pull_request ist verboten", (context) => {
  const target = "name: Prüfer prüfen";
  expectFinding(context, {
    name: FAKE_NAME,
    lines: pullRequestWorkflow(target),
    target,
    message: DUPLICATE_MESSAGE,
    files: { "pruefer-pruefen.yml": REAL_PRUEFER },
  });
});

test("workflows-pruefen-namen: steht der gleichnamige Workflow alphabetisch vorn, trifft die Meldung den echten", (context) => {
  const target = "name: Prüfer prüfen";
  const lines = REAL_PRUEFER.split("\n");
  expectFinding(context, {
    lines,
    target,
    message: DUPLICATE_MESSAGE,
    files: { "probe-b.yml": pullRequestWorkflow(target).join("\n") },
  });
});

test("workflows-pruefen-namen: ein Workflow namens CI neben ci.yml ist verboten", (context) => {
  const target = "name: CI";
  const lines = pullRequestWorkflow(target);
  expectFinding(context, { name: FAKE_NAME, lines, target, message: DUPLICATE_MESSAGE });
});

test("workflows-pruefen-namen: ein Name in anderer Schreibweise und in Anfuehrungszeichen gilt als gleich", (context) => {
  const target = 'name: " ci "';
  const lines = pullRequestWorkflow(target);
  expectFinding(context, { name: FAKE_NAME, lines, target, message: DUPLICATE_MESSAGE });
});

test("workflows-pruefen-namen: workflow_run auf einen Namen ohne passende Datei ist verboten", (context) => {
  const target = '    workflows: ["Bau"]';
  const lines = followUpWorkflow([target]);
  expectFinding(context, { name: "folgelauf.yml", lines, target, message: REFERENCE_MESSAGE });
});

test("workflows-pruefen-namen: workflow_run mit Namensliste als Block wird ebenfalls geprueft", (context) => {
  const target = "    workflows:";
  const lines = followUpWorkflow([target, "      - CI", "      - Bau"]);
  expectFinding(context, { name: "folgelauf.yml", lines, target, message: REFERENCE_MESSAGE });
});

test("workflows-pruefen-namen: workflow_run auf genau eine Datei mit diesem Namen ist erlaubt", (context) => {
  expectClean(context, "folgelauf.yml", followUpWorkflow(["    workflows:", "      - CI"]));
});

test("workflows-pruefen-namen: ein Jobname Prüfer in Anfuehrungszeichen mit Leerzeichen ist verboten", (context) => {
  expectJobFinding(context, { target: '    name: " Prüfer "', message: PRUEFER_NAME_MESSAGE });
});

test("workflows-pruefen-namen: ein Escape mit Backslash-u im Workflow ist verboten", (context) => {
  expectJobFinding(context, { target: '    name: "Pr\\u00fcfer"', message: ESCAPE_MESSAGE });
});

test("workflows-pruefen-namen: ein Escape mit Backslash-U im Workflow ist verboten", (context) => {
  expectJobFinding(context, { target: '    name: "Pr\\U000000fcfer"', message: ESCAPE_MESSAGE });
});

test("workflows-pruefen-namen: ein Escape mit Backslash-x im Workflow ist verboten", (context) => {
  expectJobFinding(context, { target: '    name: "Pr\\xfcfer"', message: ESCAPE_MESSAGE });
});

test("workflows-pruefen-namen: ein YAML-Anker im Workflow ist verboten", (context) => {
  const target = "  NAME: &n Prüfer";
  expectJobFinding(context, { target, message: ANCHOR_MESSAGE, headerLines: ["env:", target] });
});

test("workflows-pruefen-namen: ein YAML-Alias als Jobname ist verboten", (context) => {
  expectJobFinding(context, { target: "    name: *n", message: ANCHOR_MESSAGE });
});

test("workflows-pruefen-namen: cron-Ausdruecke, Globs und && bleiben erlaubt", (context) => {
  expectClean(context, "zeitplan.yml", [
    "name: Zeitplan",
    "on:",
    "  schedule:",
    '    - cron: "23 5 * * 0,2-6"',
    "  push:",
    "    branches: [master]",
    "    paths:",
    "      - tools/wochenbericht/**",
    '      - "**/*.md"',
    "permissions:",
    "  contents: read",
    "jobs:",
    "  bericht:",
    "    if: github.event_name == 'schedule' && github.event.schedule != '23 5 * * 1'",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Schritt",
    '        run: test -f a && echo "*.md" && ls ./*.js',
    "",
  ]);
});
