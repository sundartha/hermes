import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint } from "eslint";

import { REPO_ROOT } from "./probe-repo.js";

const RULE = "hermes/keine-steuerung-ueber-meldung";
const GELDPFAD = "src/billing/metering.js";

let repoEslint;

function eslint() {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  return repoEslint;
}

async function roteZeilen(filePath, zeilen) {
  const [ergebnis] = await eslint().lintText(`${zeilen.join("\n")}\n`, { filePath });
  return ergebnis.messages.filter(({ ruleId }) => ruleId === RULE).map(({ line }) => zeilen[line - 1]);
}

const STEUERUNG = [
  'export const a = (err) => err.message.includes("decline");',
  'export const b = (errorMessage) => errorMessage.startsWith("x");',
  'export const c = (msg) => msg.toLowerCase().includes("x");',
  'export const d = (msg) => msg.trim().toLowerCase().endsWith("x");',
  "export const e = (err) => String(err).match(/x/);",
  'export const f = (err) => err.toString().indexOf("x");',
  'export const g = (err) => err.message?.includes("x");',
  "export const h = (fehler) => fehler.lastError.toString().search(/x/);",
];

test("keine-steuerung-ueber-meldung: jede Entscheidung über den Meldungstext im Geldpfad ist rot", async () => {
  assert.deepEqual(await roteZeilen(GELDPFAD, STEUERUNG), STEUERUNG);
});

test("keine-steuerung-ueber-meldung: Kommentar, Zwischenaufruf mit Argument und getypte Felder bleiben grün", async () => {
  const zeilen = [
    'export const a = (err) => err.providerDecline === "x";',
    'export const b = (msg) => msg.slice(1).includes("x");',
    'export const c = (text) => text.includes("message");',
    'export const d = (e) => e.toString().includes("x");',
    'export const e = (liste) => liste.includes("x");',
    "export const f = (err) => String(err);",
  ];
  assert.deepEqual(await roteZeilen(GELDPFAD, ["// err.message.includes(\"x\")", ...zeilen]), []);
});

test("keine-steuerung-ueber-meldung: die zwei begründeten Ausnahmen und Dateien außerhalb von src/ bleiben grün", async () => {
  for (const datei of ["src/elevenlabs/outbound.js", "src/llm/adapters/anthropic.js", "scripts/probe.mjs"])
    assert.deepEqual(await roteZeilen(datei, STEUERUNG), [], datei);
});

test("keine-steuerung-ueber-meldung: src/ ist heute frei, und es gibt genau zwei Ausnahmen mit Grund", async () => {
  const ergebnisse = await eslint().lintFiles(["src"]);
  const meldungen = ergebnisse.flatMap(({ filePath, messages }) =>
    messages.filter(({ ruleId }) => ruleId === RULE).map(({ line }) => `${filePath}:${line}`),
  );
  assert.deepEqual(meldungen, []);
  const config = await eslint().calculateConfigForFile(GELDPFAD);
  const [, ...ausnahmen] = config.rules[RULE];
  assert.deepEqual(
    ausnahmen.map(({ datei }) => datei),
    ["src/elevenlabs/outbound.js", "src/llm/adapters/anthropic.js"],
  );
  assert.ok(ausnahmen.every(({ grund }) => grund.length > 0));
});
