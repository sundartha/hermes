import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(".github/workflows/live.yml", "utf8");
const auf = text.indexOf("\non:\n");
const ende = text.indexOf("\npermissions:", auf);
const ausloeser = text.slice(auf, ende);
const start = text.indexOf("\n  deploy:\n");
const nachfolger = text.indexOf("\n  nachkontrolle:\n", start);
const deployJob = text.slice(start, nachfolger);

test("live.yml startet nur per workflow_dispatch, nicht nach dem Staging-Lauf", () => {
  assert.ok(auf > 0 && ende > auf);
  assert.doesNotMatch(ausloeser, /workflow_run/);
  assert.match(ausloeser, /^ {2}workflow_dispatch:$/m);
  assert.deepEqual(ausloeser.match(/^ {2}[a-z_]+:$/gm), ["  workflow_dispatch:"]);
});

test("der Job deploy hat keine Bedingung mehr an workflow_run", () => {
  assert.ok(start > 0 && nachfolger > start);
  assert.doesNotMatch(deployJob, /workflow_run/);
});

test("der Job deploy läuft nur bei Entscheidung ja und auf master", () => {
  assert.match(
    deployJob,
    /^ {4}if: >-\n {6}needs\.entscheiden\.outputs\.deploy == 'ja' &&\n {6}github\.ref == 'refs\/heads\/master'\n {4}runs-on:/m,
  );
});

test("Hörtest-Weg von Hand: Eingaben aufgabe deploy und grafana bleiben", () => {
  assert.match(ausloeser, /options: \[deploy, grafana\]/);
  assert.match(ausloeser, /default: deploy/);
  assert.match(text, /if: github\.event_name == 'workflow_dispatch' && inputs\.aufgabe == 'grafana'/);
});
