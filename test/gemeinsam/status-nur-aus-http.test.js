import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/status-aus-http";
const STATUSMODUL = "src/utils/http.ts";
const IMPORT = 'import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "./utils/http.js";\n';

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

const ZAHL = "export const a = (res) => res.status(404).json({});\n";
const LOKALE_ZAHL = "const HTTP_GONE = 410;\nexport const a = (res) => res.status(HTTP_GONE).json({});\n";
const ZAHL_IM_ZWEIG = `${IMPORT}export const a = (res, x) => res.status(x ? HTTP_NOT_FOUND : 500).end();\n`;
const ZAHL_HINTER_ODER = `${IMPORT}export const a = (res, x) => res.status(x || 500).end();\n`;
const NAME = `${IMPORT}export const a = (res) => res.status(HTTP_NOT_FOUND).json({});\n`;
const NAMEN_IN_AUSDRUECKEN = `${IMPORT}export const a = (res, x) => res.status(x ? HTTP_NOT_FOUND : HTTP_SERVER_ERROR || HTTP_NOT_FOUND).end();\n`;
const PARAMETER = "export const a = (res, status) => res.status(status).end();\n";
const FELD = "export const a = (res, err) => res.status(err.status).end();\n";

async function erwarteBefund(quelltext) {
  const gefunden = await befunde("src/probe-status.js", quelltext);
  assert.equal(gefunden.length, 1, "Statuscode-Regel: der Verstoß wurde nicht gemeldet");
  assert.match(gefunden[0].message, /src\/utils\/http\.ts/);
}

async function erwarteKeinen(datei, quelltext) {
  const gefunden = await befunde(datei, quelltext);
  assert.deepEqual(gefunden, [], `Statuscode-Regel: ${datei} wurde gemeldet`);
}

test("Statuscode-Regel: res.status(404) in src/ ist ein Fehler, der auf das Statusmodul verweist", () => erwarteBefund(ZAHL));
test("Statuscode-Regel: eine lokale Zahlen-Konstante als Statuscode ist ein Fehler", () => erwarteBefund(LOKALE_ZAHL));
test("Statuscode-Regel: eine Zahl im Zweig einer Bedingung ist ein Fehler", () => erwarteBefund(ZAHL_IM_ZWEIG));
test("Statuscode-Regel: eine Zahl hinter || ist ein Fehler", () => erwarteBefund(ZAHL_HINTER_ODER));

test("Statuscode-Regel: ein Name aus dem Statusmodul bleibt erlaubt", () => erwarteKeinen("src/probe-status.js", NAME));
test("Statuscode-Regel: Namen aus dem Statusmodul in Bedingung und || bleiben erlaubt", () =>
  erwarteKeinen("src/probe-status.js", NAMEN_IN_AUSDRUECKEN));
test("Statuscode-Regel: ein durchgereichter Parameter bleibt erlaubt", () => erwarteKeinen("src/probe-status.js", PARAMETER));
test("Statuscode-Regel: ein durchgereichtes Feld bleibt erlaubt", () => erwarteKeinen("src/probe-status.js", FELD));
test("Statuscode-Regel: das Statusmodul selbst ist nicht Teil der Regel", () => erwarteKeinen(STATUSMODUL, ZAHL));
test("Statuscode-Regel: test/ ist nicht Teil der Regel", () => erwarteKeinen("test/probe-status.js", ZAHL));
test("Statuscode-Regel: scripts/ ist nicht Teil der Regel", () => erwarteKeinen("scripts/probe-status.mjs", ZAHL));
test("Statuscode-Regel: apps/ ist nicht Teil der Regel", () => erwarteKeinen("apps/web/src/probe-status.js", ZAHL));
