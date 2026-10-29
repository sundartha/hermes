import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";

import { REPO_ROOT } from "./probe-repo.js";

const REGEL = "no-restricted-syntax";
const HANDLER_IN_DER_FIXTURE = 2;
const ROUTENDATEI = "src/routes/rotprobe.js";
const MELDUNG_ANFANG = "Eine Route steht in Router-Form";
const EINZEL_HANDLER = readFileSync(
  join(REPO_ROOT, "test/werkzeuge/fixtures-neu/intern-anrufpause.txt"),
  "utf8",
);
const ROUTER_FORM = [
  'import { Router } from "express";',
  "export function makeRotprobeRoutes({ store }) {",
  "  const router = Router();",
  '  router.get("/rotprobe", (req, res) => res.json({ an: store.an }));',
  "  return router;",
  "}",
].join("\n");
const HANDLER_FORMEN = [
  ["Funktionsdeklaration", "export function fooHandler(req, res) {\n  res.json({});\n}"],
  ["Konstante", "export const fooHandler = (req, res) => res.json({});"],
  ["Umbenennung beim Export", "const foo = (req, res) => res.json({});\nexport { foo as fooHandler };"],
  ["Export des Namens", "const fooHandler = (req, res) => res.json({});\nexport { fooHandler };"],
  ["Standardexport", "export default function fooHandler(req, res) {\n  res.json({});\n}"],
  ["Standardexport eines Namens", "const fooHandler = (req, res) => res.json({});\nexport default fooHandler;"],
  ["Export des Namens als Standardexport", "const fooHandler = () => {};\nexport { fooHandler as default };"],
  ["Sammelexport mit Namen", 'export * as fooHandler from "./foo.js";'],
  ["Zerlegung einer Liste beim Export", "export const [fooHandler] = laden();"],
  ["Zerlegung mit Vorgabewert", "export const { a: fooHandler = laden() } = obj;"],
  ["Zerlegung als Rest", "export const { ...fooHandler } = obj;"],
  ["Verschachtelte Zerlegung", "export const { a: { fooHandler } } = obj;"],
  ["Liste mit Rest", "export const [a, ...fooHandler] = liste;"],
  ["Sammelexport mit Namen in Anfuehrungszeichen", 'export * as "fooHandler" from "./foo.js";'],
  ["Standardexport eines benannten Funktionsausdrucks", "export default (function fooHandler() {});"],
  ["Klasse", "export class FooHandler {}"],
  ["Standardexport einer Klasse", "export default class FooHandler {}"],
  ["Zerlegung beim Export", "export const { fooHandler } = laden();"],
  ["Anfuehrungszeichen im Export", 'const foo = () => {};\nexport { foo as "fooHandler" };'],
];

let repoEslint;

function eslint() {
  repoEslint ??= new ESLint({ cwd: REPO_ROOT });
  return repoEslint;
}

async function meldungen(filePath, quelltext) {
  const [ergebnis] = await eslint().lintText(`${quelltext}\n`, { filePath });
  return ergebnis.messages.filter(({ ruleId }) => ruleId === REGEL);
}

test("route-in-router-form: der Einzel-Handler aus der Fixture ist unter src/routes rot, mit dem Weg in der Meldung", async () => {
  const befunde = await meldungen(ROUTENDATEI, EINZEL_HANDLER);
  assert.equal(befunde.length, HANDLER_IN_DER_FIXTURE);
  for (const { message } of befunde) {
    assert.ok(message.startsWith(MELDUNG_ANFANG), message);
    assert.ok(message.includes("make<Name>Routes"), message);
    assert.ok(message.includes("src/routes/_validation.js"), message);
  }
});

test("route-in-router-form: jede Schreibweise eines exportierten Handler-Namens ist unter src/routes rot", async () => {
  for (const [fall, quelltext] of HANDLER_FORMEN) {
    const befunde = await meldungen(ROUTENDATEI, quelltext);
    assert.equal(befunde.length, 1, fall);
    assert.ok(befunde[0].message.startsWith(MELDUNG_ANFANG), fall);
  }
});

test("route-in-router-form: die Router-Form, ein Handler ohne Export und errorHandler ausserhalb von src/routes bleiben frei", async () => {
  assert.deepEqual(await meldungen(ROUTENDATEI, ROUTER_FORM), []);
  assert.deepEqual(await meldungen(ROUTENDATEI, "const fooHandler = () => {};\nexport const x = 1;"), []);
  assert.deepEqual(await meldungen("src/middleware.js", "export function errorHandler() {}"), []);
  assert.deepEqual(await meldungen("src/wiring/rotprobe.js", HANDLER_FORMEN[0][1]), []);
});

test("route-in-router-form: Schluessel und Vorgabewerte einer Zerlegung mit Handler-Namen sind keine Exporte", async () => {
  const zeilen = [
    "export const { fooHandler: ziel } = obj;",
    "export const { ziel = fooHandler } = obj;",
    "export const { [fooHandler]: ziel } = obj;",
  ];
  for (const zeile of zeilen) assert.deepEqual(await meldungen(ROUTENDATEI, zeile), [], zeile);
});

test("route-in-router-form: unter src/routes gilt die Demeter-Regel weiter", async () => {
  const befunde = await meldungen(ROUTENDATEI, "export const tief = (objekt) => objekt.aa.bb.cc.dd.ee;");
  assert.ok(befunde.length > 0);
  for (const { message } of befunde) assert.ok(message.includes("Gesetz von Demeter"), message);
});

test("route-in-router-form: alle Dateien unter src/routes sind heute frei", async () => {
  const ergebnisse = await eslint().lintFiles(["src/routes"]);
  assert.ok(ergebnisse.length > 0);
  const betroffen = ergebnisse.filter(({ messages }) =>
    messages.some(({ ruleId, message }) => ruleId === REGEL && message.startsWith(MELDUNG_ANFANG)),
  );
  assert.deepEqual(
    betroffen.map(({ filePath }) => filePath),
    [],
  );
});
