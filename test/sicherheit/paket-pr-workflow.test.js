import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const DATEI = ".github/workflows/node-erkennung.yml";
const MELDUNG = ".github/workflows/paket-gemeldet.yml";
const WORKFLOWS = ".github/workflows";
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
  const laeufe = [text(), readFileSync(MELDUNG, "utf8")].flatMap((inhalt) => inhalt.split("\n")).filter((zeile) => /^\s+run:/.test(zeile));
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

test("Der Workflow paket-gemeldet läuft nur bei push auf paket/** und kennt weder Geheimnis noch Umgebung noch fremden Code", () => {
  const inhalt = readFileSync(MELDUNG, "utf8");
  assert.match(inhalt, /^on:\n {2}push:\n {4}branches: \["paket\/\*\*"\]\n\npermissions: \{\}$/m);
  assert.equal(inhalt.match(/^ {2}[a-z-]+:$/gm).length, 2);
  assert.equal(inhalt.match(/permissions: \{\}/g).length, 2);
  assert.doesNotMatch(inhalt, /secrets\.|uses:|environment:/);
});

test("Kein Workflow startet sich über workflow_run selbst", () => {
  for (const datei of readdirSync(WORKFLOWS).filter((name) => name.endsWith(".yml"))) {
    const inhalt = readFileSync(`${WORKFLOWS}/${datei}`, "utf8");
    const eigener = /^name: (.+)$/m.exec(inhalt)?.[1];
    const genannt = /^ {4}workflows: \[(.*)\]$/m.exec(inhalt)?.[1];
    if (genannt === undefined) continue;
    const namen = genannt.split(",").map((name) => name.trim().replace(/^["']|["']$/g, ""));
    assert.ok(!namen.includes(eigener), `${datei} startet sich über workflow_run selbst`);
  }
});

test("node-erkennung hat keinen Auslöser push und startet paket-pr über workflow_run auf paket-gemeldet", () => {
  const inhalt = text();
  assert.doesNotMatch(inhalt, /^ {2}push:/m);
  assert.match(inhalt, /^ {2}workflow_run:\n {4}workflows: \[paket-gemeldet\]\n {4}types: \[completed\]\n {4}branches: \["paket\/\*\*"\]$/m);
  assert.doesNotMatch(inhalt, /^ {2}paket-gemeldet:/m);
});
