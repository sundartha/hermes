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
const NAME_EXPRESSION_MESSAGE =
  "in Jobnamen sind nur Text, ${{ matrix.<schlüssel> }}, ${{ strategy.job-index }} und ${{ strategy.job-total }} erlaubt";
const TAG_MESSAGE = "YAML-Tags (!!…, !…) sind in Workflow-Dateien verboten";
const DYNAMIC_MATRIX_MESSAGE =
  "ein Jobname nur aus ${{ matrix.<schlüssel> }} verlangt eine feste Matrix ohne ${{ }}";
const FLOW_JOB_MESSAGE = "Jobs nur in Block-Schreibweise, je Schlüssel eine Zeile";
const MATRIX_KEYS = ["    strategy:", "      matrix:"];
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

function expectMatrixJobFinding(context, { target, message, matrixLines }) {
  const lines = jobWorkflow([target, ...matrixLines]);
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

test("workflows-pruefen-namen: ein Jobname Prü${{ '' }}fer mit leerem Ausdruck ist verboten", (context) => {
  expectJobFinding(context, {
    target: "    name: Prü${{ '' }}fer",
    message: NAME_EXPRESSION_MESSAGE,
  });
});

test("workflows-pruefen-namen: ein Jobname aus einem Ausdruck mit format ist verboten", (context) => {
  expectJobFinding(context, {
    target: "    name: ${{ format('Pr{0}fer', 'ü') }}",
    message: NAME_EXPRESSION_MESSAGE,
  });
});

test("workflows-pruefen-namen: ein Jobname aus github.run_id ist verboten", (context) => {
  expectJobFinding(context, {
    target: "    name: Lauf ${{ github.run_id }}",
    message: NAME_EXPRESSION_MESSAGE,
  });
});

test("workflows-pruefen-namen: ein Jobname mit dem YAML-Tag !!str ist verboten", (context) => {
  expectJobFinding(context, { target: "    name: !!str Prüfer", message: TAG_MESSAGE });
});

test("workflows-pruefen-namen: ein eigener YAML-Tag im Workflow ist verboten", (context) => {
  const target = "  NAME: !eigen Wert";
  expectJobFinding(context, { target, message: TAG_MESSAGE, headerLines: ["env:", target] });
});

test("workflows-pruefen-namen: ein Jobname aus Text und Matrix-Wert, der Prüfer ergeben kann, ist verboten", (context) => {
  expectMatrixJobFinding(context, {
    target: "    name: Prü${{ matrix.t }}",
    message: PRUEFER_NAME_MESSAGE,
    matrixLines: [...MATRIX_KEYS, "        t: [fer]"],
  });
});

test("workflows-pruefen-namen: ein Matrix-Wert Prüfer für einen Jobnamen aus der Matrix ist verboten", (context) => {
  expectMatrixJobFinding(context, {
    target: "    name: ${{ matrix.t }}",
    message: PRUEFER_NAME_MESSAGE,
    matrixLines: [...MATRIX_KEYS, '        t: [eins, "Prüfer"]'],
  });
});

test("workflows-pruefen-namen: ein Jobname nur aus der Matrix mit Ausdruck in der Matrix ist verboten", (context) => {
  expectMatrixJobFinding(context, {
    target: "    name: ${{ matrix.t }}",
    message: DYNAMIC_MATRIX_MESSAGE,
    matrixLines: ["    strategy:", "      matrix: ${{ fromJSON(needs.vorher.outputs.liste) }}"],
  });
});

test("workflows-pruefen-namen: ein mit Backslash fortgesetzter Jobname Prüfer ist verboten", (context) => {
  const target = '    name: "Prü\\';
  const lines = jobWorkflow([target, '      fer"']);
  expectFinding(context, { name: JOB_FILE, lines, target, message: PRUEFER_NAME_MESSAGE });
});

test("workflows-pruefen-namen: ein Job in Flow-Schreibweise ist verboten", (context) => {
  const target = "  probe: {name: Probe, runs-on: ubuntu-latest, steps: [{run: echo ok}]}";
  const block = jobWorkflow([]);
  const lines = [...block.slice(0, block.indexOf("  probe:")), target, ""];
  expectFinding(context, { name: JOB_FILE, lines, target, message: FLOW_JOB_MESSAGE });
});

test("workflows-pruefen-namen: Jobnamen wie in ci.yml und Verneinung in if: bleiben erlaubt", (context) => {
  expectClean(
    context,
    JOB_FILE,
    jobWorkflow([
      "    name: Tests ${{ matrix.teil }}/${{ strategy.job-total }}",
      "    if: ${{ !cancelled() }}",
      ...MATRIX_KEYS,
      "        teil: [1, 2, 3, 4]",
    ]),
  );
});
