import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DATEI = ".github/workflows/node-erkennung.yml";
const text = () => readFileSync(DATEI, "utf8");

function job(name) {
  const treffer = new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n|\\n)+)`, "m").exec(text());
  assert.ok(treffer, `Job ${name} fehlt`);
  return treffer[1];
}

test("Der Job paket-pr läuft in der Umgebung paket-pr", () => {
  assert.match(job("paket-pr"), /^ {4}environment: paket-pr$/m);
});

test("Die Bedingung des Jobs paket-pr verlangt workflow_run auf master, einen Paket-Branch und dasselbe Repository", () => {
  const bedingung = /^ {4}if: >-\n((?: {6}.*\n)+)/m.exec(job("paket-pr"))?.[1] ?? "";
  assert.match(bedingung, /github\.event_name == 'workflow_run'/);
  assert.match(bedingung, /github\.ref == 'refs\/heads\/master'/);
  assert.match(bedingung, /startsWith\(github\.event\.workflow_run\.head_branch, 'paket\/'\)/);
  assert.match(bedingung, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(bedingung, /github\.event\.workflow_run\.conclusion == 'success'/);
});

test("App-ID und Schlüssel stehen nur in Zeilen der Form NAME: secrets", () => {
  const zeilen = text().split("\n").filter((zeile) => zeile.includes("secrets.SUNDARTHA_AGENT"));
  assert.equal(zeilen.length, 2);
  for (const zeile of zeilen) assert.match(zeile, /^\s+(APP_ID|APP_SCHLUESSEL): \$\{\{ secrets\.SUNDARTHA_AGENT_(APP_ID|PRIVATE_KEY) \}\}$/);
});

test("Keine run-Zeile enthält einen Ausdruck, und der Schlüssel geht nur über die Standardeingabe", () => {
  const laeufe = text().split("\n").filter((zeile) => /^\s+run:/.test(zeile));
  assert.ok(laeufe.length >= 3);
  for (const zeile of laeufe) assert.doesNotMatch(zeile, /\$\{\{/);
  const aufruf = laeufe.filter((zeile) => zeile.includes("paket-pr"));
  assert.equal(aufruf.length, 1);
  assert.match(aufruf[0], /^\s+run: printf '%s' "\$APP_SCHLUESSEL" \| node tools\/mutation-laeufe\.mjs paket-pr /);
  assert.equal(aufruf[0].split("$APP_SCHLUESSEL").length, 2);
});

test("Der Job paket-pr checkt den Paket-Branch nicht aus", () => {
  const inhalt = job("paket-pr");
  assert.doesNotMatch(inhalt, /^\s+ref:/m);
  assert.doesNotMatch(inhalt, /head_sha/);
});

test("Der Job, der bei push läuft, kennt kein Geheimnis", () => {
  const inhalt = job("paket-gemeldet");
  assert.match(inhalt, /github\.event_name == 'push'/);
  assert.doesNotMatch(inhalt, /secrets\./);
});
