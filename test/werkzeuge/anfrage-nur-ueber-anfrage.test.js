import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes-tests/anfrage-mit-frist";
const ANFRAGE_DATEI = "src/utils/anfrage.js";
const PRODUKT = "src/probe-anfrage.js";
const MIT_FRIST = 'fetch("https://x.test", { signal: AbortSignal.timeout(5000) });\n';

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

async function erwarteBefund(quelltext) {
  const gefunden = await befunde(PRODUKT, quelltext);
  assert.equal(gefunden.length, 1, `Anfrage-Regel: ${quelltext} wurde nicht genau einmal gemeldet`);
  assert.match(gefunden[0].message, /`anfrage\(url, \{ fristMs \}\)`/);
  assert.match(gefunden[0].message, /src\/utils\/anfrage\.js/);
}

async function erwarteKeinen(datei, quelltext) {
  const gefunden = await befunde(datei, quelltext);
  assert.deepEqual(gefunden, [], `Anfrage-Regel: ${datei} wurde gemeldet`);
}

const FAELLE = {
  "ein Aufruf ohne Frist": 'fetch("https://x.test");\n',
  "ein Aufruf mit eigener Frist": MIT_FRIST,
  "ein Alias": 'const f = fetch;\nf("https://x.test");\n',
  "fetch als Standardwert": "export const a = (fetchImpl = fetch) => fetchImpl;\n",
  "fetch als Wert im Objekt": "export const a = { fetchImpl: fetch };\n",
  "fetch als Argument": "export const a = (b) => b(fetch);\n",
  "globalThis.fetch": 'globalThis.fetch("https://x.test");\n',
  "global.fetch als Wert": "export const a = global.fetch;\n",
  "fetch aus globalThis entpackt": 'const { fetch: f } = globalThis;\nf("https://x.test");\n',
  "https.request": 'import https from "node:https";\nhttps.request("https://x.test");\n',
  "http.get": 'import { get } from "node:http";\nget("http://x.test");\n',
};

for (const [name, quelltext] of Object.entries(FAELLE)) {
  test(`Anfrage-Regel: ${name} in src/ ist ein Fehler, der anfrage() nennt`, () => erwarteBefund(quelltext));
}

test("Anfrage-Regel: anfrage() selbst bleibt erlaubt", () =>
  erwarteKeinen(PRODUKT, 'import { anfrage } from "./utils/anfrage.js";\nanfrage("https://x.test", { fristMs: 5 });\n'));
test("Anfrage-Regel: ein lokaler Parameter namens fetch ist kein globales fetch", () =>
  erwarteKeinen(PRODUKT, "export const a = (fetch) => fetch(1);\n"));
test("Anfrage-Regel: eine Methode namens fetch ist kein globales fetch", () =>
  erwarteKeinen(PRODUKT, "export const a = (b) => b.fetch(1);\n"));
test("Anfrage-Regel: src/utils/anfrage.js darf fetch aufrufen", () => erwarteKeinen(ANFRAGE_DATEI, "export const a = (u) => fetch(u);\n"));
test("Anfrage-Regel: eine andere Datei in src/utils/ darf es nicht", async () => {
  const gefunden = await befunde("src/utils/anderes.js", 'fetch("https://x.test");\n');
  assert.equal(gefunden.length, 1);
});
test("Anfrage-Regel: unter test/ gilt die Fristregel, fetch mit Frist bleibt still", () =>
  erwarteKeinen("test/probe-anfrage.js", MIT_FRIST));
test("Anfrage-Regel: unter test/ meldet fetch ohne Frist die Testmeldung", async () => {
  const gefunden = await befunde("test/probe-anfrage.js", 'fetch("https://x.test");\n');
  assert.equal(gefunden.length, 1);
  assert.match(gefunden[0].message, /abrufMitFrist/);
});

test("Anfrage-Regel: es gibt keine Bestandsliste mehr", () => {
  assert.equal(existsSync(resolve(WURZEL, "tools/basis/anfrage-mit-frist.json")), false);
});
