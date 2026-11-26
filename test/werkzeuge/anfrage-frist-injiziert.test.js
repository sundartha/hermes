import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes-tests/anfrage-mit-frist";
const ANFRAGE_DATEI = "src/utils/anfrage.ts";
const PRODUKT = "src/probe-anfrage.js";
const IMPORT = 'import { anfrage } from "./utils/anfrage.ts";\n';

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

const BEFUNDE = {
  "injiziertes _fetch im entpackten Parameter ohne fristMs": `${IMPORT}export function m(c, { _fetch = anfrage } = {}) { return _fetch("https://x.test", { method: "POST" }); }\n`,
  "injiziertes _fetch als Parameter ohne fristMs": `${IMPORT}export function m(c, _fetch = anfrage) { return _fetch("https://x.test", { method: "POST" }); }\n`,
  "anfrage ganz ohne Optionen": `${IMPORT}anfrage("https://x.test");\n`,
  "anfrage mit Optionen ohne Objekt-Literal": `${IMPORT}export const a = (optionen) => anfrage("https://x.test", optionen);\n`,
  "ein Alias von anfrage ohne fristMs": `${IMPORT}const f = anfrage;\nf("https://x.test", {});\n`,
  "anfrage mit Spread allein": `${IMPORT}export const a = (rest) => anfrage("https://x.test", { ...rest });\n`,
};

for (const [name, quelltext] of Object.entries(BEFUNDE)) {
  test(`Frist-Regel: ${name} wird einmal gemeldet`, async () => {
    const gefunden = await befunde(PRODUKT, quelltext);
    assert.equal(gefunden.length, 1);
    assert.match(gefunden[0].message, /fristMs/);
    assert.match(gefunden[0].message, /src\/utils\/anfrage\.ts/);
  });
}

const OHNE_BEFUND = {
  "_fetch mit fristMs": `${IMPORT}export function m(c, { _fetch = anfrage } = {}) { return _fetch("https://x.test", { fristMs: 5 }); }\n`,
  "anfrage mit fristMs und Spread": `${IMPORT}export const a = (rest) => anfrage("https://x.test", { fristMs: 5, ...rest });\n`,
  "Parameter _fetch ohne Vorgabe anfrage": "export function m(c, { _fetch } = {}) { return _fetch('https://x.test', {}); }\n",
  "bloßes Weiterreichen": `${IMPORT}export const a = (c, b) => b(c, { _fetch: anfrage });\nexport const w = (c, _fetch = anfrage) => a(c, { _fetch });\n`,
};

for (const [name, quelltext] of Object.entries(OHNE_BEFUND)) {
  test(`Frist-Regel: ${name} bleibt still`, async () => {
    assert.deepEqual(await befunde(PRODUKT, quelltext), []);
  });
}

test("Frist-Regel: src/utils/anfrage.js selbst bleibt still", async () => {
  assert.deepEqual(await befunde(ANFRAGE_DATEI, 'export const a = (u) => fetch(u);\n'), []);
});
