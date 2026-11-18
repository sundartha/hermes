import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/status-aus-http";
const STATUSMODUL = "src/utils/http.ts";

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

const EIGENE = [
  ["const-Zahl", "const HTTP_ZU_VIELE_ANFRAGEN = 429;\nexport const a = HTTP_ZU_VIELE_ANFRAGEN;\n"],
  ["export-Zahl", "export const HTTP_GONE = 410;\n"],
  ["let-Zahl", "let HTTP_X = 1;\nexport const a = () => HTTP_X;\n"],
  ["typisierte Zahl", "const HTTP_STATUS_MAX: number = 599;\nexport const a = HTTP_STATUS_MAX;\n"],
];

for (const [name, quelltext] of EIGENE) {
  test(`HTTP-Konstanten: eine eigene HTTP_*-Zahl (${name}) in src/ ist ein Fehler`, async () => {
    const gefunden = await befunde(name.includes("typisiert") ? "src/telephony/failure-reason.ts" : "src/probe-http.js", quelltext);
    assert.equal(gefunden.length, 1);
    assert.match(gefunden[0].message, /src\/utils\/http\.ts/);
  });
}

const ERLAUBT = [
  ["Text", 'const HTTP_POST = "POST";\nexport const a = HTTP_POST;\n'],
  ["anderer Name", "const SIP_NOT_FOUND = 404;\nexport const a = SIP_NOT_FOUND;\n"],
  ["Import", 'import { HTTP_NOT_FOUND } from "./utils/http.js";\nexport const a = HTTP_NOT_FOUND;\n'],
];

for (const [name, quelltext] of ERLAUBT) {
  test(`HTTP-Konstanten: ${name} bleibt erlaubt`, async () => {
    assert.deepEqual(await befunde("src/probe-http.js", quelltext), []);
  });
}

test("HTTP-Konstanten: das Statusmodul darf HTTP_*-Zahlen deklarieren", async () => {
  assert.deepEqual(await befunde(STATUSMODUL, "export const HTTP_GONE = 410;\n"), []);
});

test("HTTP-Konstanten: test/ ist nicht Teil der Regel", async () => {
  assert.deepEqual(await befunde("test/probe-http.js", "export const HTTP_GONE = 410;\n"), []);
});
