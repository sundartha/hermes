import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { probeDirectory, runIn } from "./probe-repo.js";
import { TOOL } from "./workflows-probe.mjs";

const PINNED_SETUP_NODE = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const WORKFLOW_DATEI = "workflows/ci.yml";
const ACTION_DATEI = "actions/probe/action.yml";
const LOKALE_ACTION = "./.github/actions/probe";
const BACKSLASH = String.fromCharCode(92);
const SHA_MELDUNG = "ist nicht per 40-stelliger Commit-SHA eingebunden";
const NUR_COMPOSITE = "lokale Actions nur mit runs.using: composite";
const ERSTE_ACTION_ZEILE = "name: Probe";
const PULL_REQUEST_AUSLOESER = ["on:", "  pull_request:", "    branches: [master]"];
const WORKFLOW_RUN_AUSLOESER = ["on:", "  workflow_run:", '    workflows: ["CI"]'];
const GEHEIMNIS_WORKFLOW_DATEI = "workflows/notfall.yml";
const LOKAL_NICHT_ERLAUBT =
  "lokale Actions nur in Workflows außerhalb von tools/basis/geheimnis-workflows.json und ohne workflow_run";

function workflow(verweis, ausloeser = PULL_REQUEST_AUSLOESER) {
  return [
    "name: CI",
    ...ausloeser,
    "permissions:",
    "  contents: read",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - uses: ${verweis}`,
    "",
  ].join("\n");
}

function action(schritte) {
  return [ERSTE_ACTION_ZEILE, "runs:", "  using: composite", "  steps:", ...schritte, ""].join(
    "\n",
  );
}

function zeileVon(text, gesucht) {
  return text.split("\n").indexOf(gesucht) + 1;
}

function pruefe(context, dateien) {
  const wurzel = probeDirectory(context, dateien);
  const lauf = runIn(wurzel, process.execPath, [
    TOOL,
    join(wurzel, "workflows"),
    join(wurzel, "actions"),
  ]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

function befundInActionText(context, text, { zeile, meldung }) {
  const lauf = pruefe(context, { [WORKFLOW_DATEI]: workflow(LOKALE_ACTION), [ACTION_DATEI]: text });
  return { lauf, erwartet: `${ACTION_DATEI}:${zeile}: ${meldung}` };
}

function befundInAction(context, schritte, { schritt, meldung }) {
  const text = action(schritte);
  return befundInActionText(context, text, { zeile: zeileVon(text, schritt), meldung });
}

function befundImWorkflow(context, verweis, weitere = {}) {
  const text = workflow(verweis);
  const lauf = pruefe(context, { [WORKFLOW_DATEI]: text, ...weitere });
  return {
    lauf,
    erwartet: `${WORKFLOW_DATEI}:${zeileVon(text, `      - uses: ${verweis}`)}: ${verweis} ${SHA_MELDUNG}`,
  };
}

function lokaleActionIn(context, { datei, ausloeser }) {
  const text = workflow(LOKALE_ACTION, ausloeser);
  const lauf = pruefe(context, {
    [datei]: text,
    [ACTION_DATEI]: action([`    - uses: ${PINNED_SETUP_NODE}`]),
  });
  const zeile = zeileVon(text, `      - uses: ${LOKALE_ACTION}`);
  return { lauf, erwartet: `${datei}:${zeile}: ${LOKALE_ACTION}: ${LOKAL_NICHT_ERLAUBT}` };
}

test("workflows-pruefen: eine lokale Action in einem Workflow mit workflow_run stoppt die Prüfung", (context) => {
  const { lauf, erwartet } = lokaleActionIn(context, {
    datei: WORKFLOW_DATEI,
    ausloeser: WORKFLOW_RUN_AUSLOESER,
  });
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: eine lokale Action in einem Workflow der Geheimnis-Liste stoppt die Prüfung", (context) => {
  const { lauf, erwartet } = lokaleActionIn(context, {
    datei: GEHEIMNIS_WORKFLOW_DATEI,
    ausloeser: PULL_REQUEST_AUSLOESER,
  });
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: eine vorhandene lokale Action unter .github/actions ist ohne SHA erlaubt", (context) => {
  const lauf = pruefe(context, {
    [WORKFLOW_DATEI]: workflow(LOKALE_ACTION),
    [ACTION_DATEI]: action([`    - uses: ${PINNED_SETUP_NODE}`]),
  });
  assert.equal(lauf.status, 0, lauf.ausgabe);
  assert.equal(lauf.ausgabe, "");
});

test("workflows-pruefen: ohne ausdrücklichen Actions-Ordner gilt ein Nachbarordner actions nicht als .github/actions", (context) => {
  const text = workflow(LOKALE_ACTION);
  const wurzel = probeDirectory(context, {
    [WORKFLOW_DATEI]: text,
    [ACTION_DATEI]: action([`    - uses: ${PINNED_SETUP_NODE}`]),
  });
  const lauf = runIn(wurzel, process.execPath, [TOOL, join(wurzel, "workflows")]);
  const zeile = zeileVon(text, `      - uses: ${LOKALE_ACTION}`);
  assert.equal(lauf.status, 1);
  assert.ok(
    lauf.stderr.includes(`${WORKFLOW_DATEI}:${zeile}: ${LOKALE_ACTION} ${SHA_MELDUNG}`),
    lauf.stderr,
  );
});

test("workflows-pruefen: eine fehlende lokale Action stoppt die Prüfung", (context) => {
  const { lauf, erwartet } = befundImWorkflow(context, "./.github/actions/fehlt");
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: ein Verweis auf das Verzeichnis über .github/actions stoppt die Prüfung", (context) => {
  const { lauf, erwartet } = befundImWorkflow(context, "./.github/actions/..", {
    "action.yml": action([`    - uses: ${PINNED_SETUP_NODE}`]),
  });
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: eine per Tag eingebundene Action in einer lokalen Action stoppt die Prüfung", (context) => {
  const schritt = "    - uses: actions/setup-node@v4";
  const { lauf, erwartet } = befundInAction(context, [schritt], {
    schritt,
    meldung: `actions/setup-node@v4 ${SHA_MELDUNG}`,
  });
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: npm ci ohne --ignore-scripts in einer lokalen Action stoppt die Prüfung", (context) => {
  const schritt = "      run: npm ci";
  const { lauf, erwartet } = befundInAction(context, ["    - shell: bash", schritt], {
    schritt,
    meldung: "npm ci ohne --ignore-scripts",
  });
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: ein Escape in einer lokalen Action stoppt die Prüfung", (context) => {
  const schritt = `      run: "npm${BACKSLASH}x20ci"`;
  const { lauf, erwartet } = befundInAction(context, ["    - shell: bash", schritt], {
    schritt,
    meldung: `${BACKSLASH}u-, ${BACKSLASH}U- und ${BACKSLASH}x-Escapes sind in Workflow-Dateien verboten`,
  });
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: ein Cache in einer lokalen Action stoppt die Prüfung", (context) => {
  const schritt = "        cache: npm";
  const { lauf, erwartet } = befundInAction(
    context,
    [`    - uses: ${PINNED_SETUP_NODE}`, "      with:", schritt],
    { schritt, meldung: "cache: und actions/cache sind in Workflow-Dateien verboten" },
  );
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: secrets in einer lokalen Action stoppen die Prüfung", (context) => {
  const schritt = "      run: echo ${{ secrets.TOKEN }}";
  const { lauf, erwartet } = befundInAction(context, ["    - shell: bash", schritt], {
    schritt,
    meldung: "secrets nur in Workflows aus tools/basis/geheimnis-workflows.json",
  });
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

function befundOhneComposite(context, runs, zeile) {
  const text = [ERSTE_ACTION_ZEILE, ...runs, ""].join("\n");
  return befundInActionText(context, text, {
    zeile: zeileVon(text, zeile),
    meldung: NUR_COMPOSITE,
  });
}

test("workflows-pruefen: eine lokale Action mit using: node20 stoppt die Prüfung", (context) => {
  const using = "  using: node20";
  const { lauf, erwartet } = befundOhneComposite(
    context,
    ["runs:", using, "  main: index.js"],
    using,
  );
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: eine lokale Action mit using: docker in Flow-Schreibweise stoppt die Prüfung", (context) => {
  const runs = "runs: { using: docker, image: Dockerfile }";
  const { lauf, erwartet } = befundOhneComposite(context, [runs], runs);
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});

test("workflows-pruefen: eine lokale Action ohne runs.using stoppt die Prüfung", (context) => {
  const text = [
    ERSTE_ACTION_ZEILE,
    "runs:",
    "  steps:",
    `    - uses: ${PINNED_SETUP_NODE}`,
    "",
  ].join("\n");
  const { lauf, erwartet } = befundInActionText(context, text, {
    zeile: zeileVon(text, ERSTE_ACTION_ZEILE),
    meldung: NUR_COMPOSITE,
  });
  assert.equal(lauf.status, 1);
  assert.ok(lauf.ausgabe.includes(erwartet), lauf.ausgabe);
});
