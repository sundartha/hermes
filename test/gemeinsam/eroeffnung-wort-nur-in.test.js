import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });

const NAMEN = ["eroeffnung-platzhalter", "eroeffnung-schreiben", "offenlegung-lesen"];

function dieseRegeln(ergebnis) {
  return ergebnis.messages.filter((meldung) => meldung.ruleId === "hermes/wort-nur-in" && NAMEN.some((name) => meldung.message.startsWith(`${name}:`)));
}

async function meldungen(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return dieseRegeln(ergebnis);
}

const VERSTOESSE = [
  ["eroeffnung-platzhalter", 'export const a = "{{eroeffnung}}";\n'],
  ["eroeffnung-platzhalter", 'export const a = "{{ opening_line }}";\n'],
  ["eroeffnung-schreiben", 'export const a = { first_message: "Hallo" };\n'],
  ["eroeffnung-schreiben", 'export const a = { opening_line: "Hallo" };\n'],
  ["offenlegung-lesen", "export const a = (locale) => locale.disclosure(null);\n"],
  ["offenlegung-lesen", "export const a = (disclosure) => disclosure(null);\n"],
];

for (const [name, quelltext] of VERSTOESSE) {
  test(`${name}: außerhalb von anrufstart.ts und src/i18n rot (${quelltext.trim()})`, async () => {
    const gefunden = await meldungen("src/probe-eroeffnung.js", quelltext);
    assert.equal(gefunden.length, 1);
    assert.match(gefunden[0].message, new RegExp(`^${name}: .*anrufstart\\.ts`));
  });

  test(`${name}: in src/anrufe/start/anrufstart.ts grün (${quelltext.trim()})`, async () => {
    assert.deepEqual(await meldungen("src/anrufe/start/anrufstart.ts", quelltext), []);
  });

  test(`${name}: unter src/i18n grün (${quelltext.trim()})`, async () => {
    assert.deepEqual(await meldungen("src/i18n/locales.ts", quelltext), []);
    assert.deepEqual(await meldungen("src/i18n/texte-paket.ts", quelltext), []);
  });
}

const ERLAUBT_UEBERALL = [
  "export const a = (agent) => agent.first_message;\n",
  "export const a = (zeile) => zeile.opening_line;\n",
  "export const a = { disclosure: 1 };\n",
  "export const a = (locale) => locale.disclosure;\n",
];

for (const quelltext of ERLAUBT_UEBERALL) {
  test(`Lesen und andere Formen bleiben überall grün: ${quelltext.trim()}`, async () => {
    assert.deepEqual(await meldungen("src/probe-eroeffnung.js", quelltext), []);
  });
}

for (const datei of ["src/elevenlabs/outbound.js", "src/elevenlabs/inbound-initiation.js", "src/claude.js"]) {
  test(`${datei}: kein Schreiber und kein Leser der Eröffnung oder Offenlegung außerhalb von anrufstart.ts`, async () => {
    const [ergebnis] = await eslint.lintFiles([datei]);
    assert.deepEqual(dieseRegeln(ergebnis), []);
  });
}
