import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";
import { expectClean, expectFinding } from "./workflows-probe.mjs";

const FAKE_NAME = "zweiter-pruefer.yml";
const DUPLICATE_MESSAGE = "derselbe Workflow-Name steht schon in einer anderen Datei";
const REFERENCE_MESSAGE =
  "workflow_run nennt einen Workflow-Namen, der nicht zu genau einer Datei passt";
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
