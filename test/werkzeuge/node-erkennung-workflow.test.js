import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DATEI = ".github/workflows/node-erkennung.yml";
const text = () => readFileSync(DATEI, "utf8");
const TOKEN = "${{ secrets.UPDATE_WORKFLOW_TOKEN }}";

test("startet wöchentlich und von Hand", () => {
  assert.match(text(), /^on:\n {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \d"\n {2}workflow_dispatch:/m);
});

test("ruft die Node-Erkennung auf", () => {
  assert.match(text(), /run: node tools\/mutation-laeufe\.mjs node-erkennung$/m);
});

test("Checkout und gh nutzen das Update-Token, nie GITHUB_TOKEN", () => {
  const inhalt = text();
  assert.match(inhalt, new RegExp(`uses: actions/checkout@[0-9a-f]{40}\\n\\s+with:\\n\\s+token: ${TOKEN.replace(/[$.{}]/g, "\\$&")}`));
  assert.match(inhalt, new RegExp(`GH_TOKEN: ${TOKEN.replace(/[$.{}]/g, "\\$&")}`));
  assert.doesNotMatch(inhalt, /GITHUB_TOKEN|github\.token/);
});

test("das Token steht nur in env und with, nie in einem run-Text", () => {
  const zeilen = text().split("\n");
  const mitToken = zeilen.filter((zeile) => zeile.includes("secrets.UPDATE_WORKFLOW_TOKEN"));
  assert.ok(mitToken.length >= 3);
  for (const zeile of mitToken) assert.match(zeile, /^\s+(token|GH_TOKEN|HAT_TOKEN): \$\{\{ secrets\.UPDATE_WORKFLOW_TOKEN \}\}$/);
  assert.doesNotMatch(text(), /set -x|echo "?\$\{?(GH_TOKEN|HAT_TOKEN)/);
});

test("Rechte minimal, kein Auto-Merge", () => {
  const inhalt = text();
  assert.match(inhalt, /^permissions: \{\}$/m);
  assert.match(inhalt, /^ {4}permissions:\n {6}contents: read\n {6}pull-requests: read\n/m);
  assert.doesNotMatch(inhalt, /: write/);
  assert.doesNotMatch(inhalt, /gh pr merge|--auto|auto-merge/i);
});

test("fehlendes Geheimnis beendet den Lauf rot vor dem Aufruf", () => {
  const inhalt = text();
  const pruefung = inhalt.indexOf("test -n \"$HAT_TOKEN\"");
  assert.ok(pruefung > 0);
  assert.match(inhalt, /test -n "\$HAT_TOKEN" \|\| \{ echo "::error::UPDATE_WORKFLOW_TOKEN fehlt[^"]*"; exit 1; \}/);
  assert.ok(pruefung < inhalt.indexOf("mutation-laeufe.mjs node-erkennung"));
  assert.ok(pruefung < inhalt.indexOf("actions/checkout"));
});
