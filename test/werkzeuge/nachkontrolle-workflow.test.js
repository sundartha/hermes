import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(".github/workflows/live.yml", "utf8");
const start = text.indexOf("\n  nachkontrolle:\n");
const nachfolger = text.indexOf("\n  grafana-einspielen:\n");
const job = start < 0 ? "" : text.slice(start, nachfolger > start ? nachfolger : undefined);

test("der Job nachkontrolle wartet auf Entscheiden und Deploy", () => {
  assert.match(job, /^ {4}needs: \[entscheiden, deploy\]$/m);
});

test("er läuft nach Erfolg und Fehlschlag des Deploys, nicht nach Überspringen oder Abbruch", () => {
  assert.match(
    job,
    /^ {4}if: always\(\) && \(needs\.deploy\.result == 'success' \|\| needs\.deploy\.result == 'failure'\)$/m,
  );
});

test("Rechte minimal: lesen, Issues schreiben, kein Schreiben an Code", () => {
  assert.match(
    job,
    /^ {4}permissions:\n {6}contents: read\n {6}issues: write\n {6}pull-requests: read\n/m,
  );
  assert.doesNotMatch(job, /contents: write|pull-requests: write/);
});

test("Checkout mit voller Historie und ohne gespeicherte Zugangsdaten, Node 22, npm ci", () => {
  assert.match(job, /actions\/checkout@[0-9a-f]{40}\n\s+with:\n\s+fetch-depth: 0\n\s+persist-credentials: false/);
  assert.match(job, /node-version: 22/);
  assert.match(job, /run: npm ci --ignore-scripts$/m);
});

test("Frist 45 Minuten und Aufruf des Befehls mit dem Commit aus entscheiden", () => {
  assert.match(job, /^ {4}timeout-minutes: 45$/m);
  assert.match(job, /^ {10}COMMIT: \$\{\{ needs\.entscheiden\.outputs\.commit \}\}$/m);
  assert.match(job, /run: node tools\/deploy-weg\.mjs nachkontrolle --commit "\$COMMIT"$/m);
});

test("Zugang: UPDATE_WORKFLOW_TOKEN, GITHUB_TOKEN und Produktions-URL nur als Umgebungswerte", () => {
  assert.match(job, /^ {10}UPDATE_WORKFLOW_TOKEN: \$\{\{ secrets\.UPDATE_WORKFLOW_TOKEN \}\}$/m);
  assert.match(job, /^ {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.match(job, /^ {10}PRODUKTION_URL: https:\/\/app\.sundartha\.com$/m);
  const zeilen = job.split("\n").filter((zeile) => zeile.includes("secrets."));
  assert.equal(zeilen.length, 1);
  assert.doesNotMatch(job, /run:.*(secrets\.|TOKEN)/);
});

test("kein Auto-Merge und keine Umgebung produktion", () => {
  assert.doesNotMatch(job, /gh pr merge|--auto|auto-merge/i);
  assert.doesNotMatch(job, /environment:/);
});
