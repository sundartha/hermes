import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import konfiguration from "../../eslint.config.js";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGELN = ["no-restricted-globals", "no-restricted-properties", "no-restricted-imports", "no-restricted-syntax"];
const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext, filter) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter(filter);
}

const uhrBefunde = (datei, quelltext) =>
  befunde(datei, quelltext, (meldung) => REGELN.includes(meldung.ruleId) && /Uhr als Wert übergeben/.test(meldung.message));

const VERSTOESSE = [
  ["new Date() ohne Argument", "export const a = () => new Date();\n"],
  ["performance.now()", "export const a = () => performance.now();\n"],
  ["setImmediate", "export const a = () => setImmediate(() => 1);\n"],
  ["globalThis.setImmediate", "export const a = () => globalThis.setImmediate(() => 1);\n"],
  ["Import von sleep", 'import { sleep } from "../utils/timer.ts";\nexport const a = sleep;\n'],
  ["Import von defaultSetTimer", 'import { defaultSetTimer } from "../utils/timer.ts";\nexport const a = defaultSetTimer;\n'],
  ["tiefer Import von defaultSetTimer", 'import { defaultSetTimer } from "../../../utils/timer.ts";\nexport const a = defaultSetTimer;\n'],
  ["Import von sleep ohne Endung", 'import { sleep } from "../utils/timer";\nexport const a = sleep;\n'],
];

const ERLAUBT = [
  ["new Date(x) mit Argument", "export const a = (x) => new Date(x);\n"],
  ["MS_PER_SECOND aus utils/timer", 'import { MS_PER_SECOND } from "../utils/timer.ts";\nexport const a = MS_PER_SECOND;\n'],
  [
    "alle MS_PER-Konstanten aus utils/timer",
    'import { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY } from "../utils/timer.ts";\nexport const a = [MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY];\n',
  ],
];

const PROBEN = [
  "src/telephony/probe-uhr.js",
  "src/telephony/alert-sms.ts",
  "src/elevenlabs/probe-uhr.js",
  "src/elevenlabs/opening-line.ts",
];

for (const probe of PROBEN) {
  for (const [name, quelltext] of VERSTOESSE) {
    test(`uhr-als-wert-erweitert: ${name} in ${probe} wird einmal gemeldet`, async () => {
      assert.equal((await uhrBefunde(probe, quelltext)).length, 1);
    });
  }
  for (const [name, quelltext] of ERLAUBT) {
    test(`uhr-als-wert-erweitert: ${name} in ${probe} wird nicht gemeldet`, async () => {
      assert.deepEqual(await uhrBefunde(probe, quelltext), []);
    });
  }
}

for (const [name, quelltext] of VERSTOESSE) {
  test(`uhr-als-wert-erweitert: ${name} ausserhalb der Anrufordner wird nicht gemeldet`, async () => {
    assert.deepEqual(await uhrBefunde("src/utils/probe-uhr.js", quelltext), []);
  });
}

test("uhr-als-wert-erweitert: die Demeter-Regel gilt in Anrufdateien weiter", async () => {
  const quelltext = "export const a = (x) => x.b.c.d.e.f;\n";
  const syntax = (meldung) => meldung.ruleId === "no-restricted-syntax";
  const anruf = await befunde("src/telephony/probe-uhr.js", quelltext, syntax);
  const allgemein = await befunde("src/utils/probe-uhr.js", quelltext, syntax);
  assert.ok(allgemein.length > 0);
  assert.equal(anruf.length, allgemein.length);
});

test("uhr-als-wert-erweitert: der Bestand wächst nicht über 9 Dateien", () => {
  const bestand = konfiguration.find((block) => block.name === "uhr-als-wert")?.ignores ?? [];
  assert.ok(bestand.length <= 9);
});
