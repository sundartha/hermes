import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import konfiguration from "../../eslint.config.js";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGELN = ["no-restricted-globals", "no-restricted-properties", "no-restricted-imports"];
const eslint = new ESLint({ cwd: WURZEL });

async function uhrBefunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => REGELN.includes(meldung.ruleId) && /Uhr als Wert übergeben/.test(meldung.message));
}

const VERSTOESSE = [
  ["Date.now()", "export const a = () => Date.now();\n"],
  ["setTimeout", "export const a = () => setTimeout(() => 1, 5);\n"],
  ["setInterval", "export const a = () => setInterval(() => 1, 5);\n"],
  ["globalThis.setTimeout", "export const a = () => globalThis.setTimeout(() => 1, 5);\n"],
  ["globalThis.setInterval", "export const a = () => globalThis.setInterval(() => 1, 5);\n"],
  ["Import aus node:timers", 'import { setTimeout as warte } from "node:timers";\nexport const a = warte;\n'],
  ["Import aus node:timers/promises", 'import { setTimeout as warte } from "node:timers/promises";\nexport const a = warte;\n'],
];

const PROBEN = [
  "src/telephony/probe-uhr.js",
  "src/telephony/absender-registrierung.ts",
  "src/elevenlabs/probe-uhr.js",
  "src/elevenlabs/opening-line.ts",
];

for (const probe of PROBEN) {
  for (const [name, quelltext] of VERSTOESSE) {
    test(`uhr-als-wert: ${name} in ${probe} wird gemeldet`, async () => {
      const gefunden = await uhrBefunde(probe, quelltext);
      assert.equal(gefunden.length, 1);
    });
  }
}

test("uhr-als-wert: ein Wert ohne Zeitaufruf wird nicht gemeldet", async () => {
  assert.deepEqual(await uhrBefunde("src/telephony/probe-uhr.js", "export const a = (jetzt) => jetzt + 1;\n"), []);
});

test("uhr-als-wert: ausserhalb der Anrufordner gilt die Regel nicht", async () => {
  assert.deepEqual(await uhrBefunde("src/utils/probe-uhr.js", VERSTOESSE[0][1]), []);
});

test("uhr-als-wert: die Bestandsdatei ist ausgenommen, process.env bleibt dort gesperrt", async () => {
  const [ergebnis] = await eslint.lintText("export const a = () => Date.now() + process.env.X;\n", {
    filePath: resolve(WURZEL, "src/telephony/outbound-gates.js"),
  });
  const ids = ergebnis.messages.map((meldung) => `${meldung.ruleId}:${/Uhr als Wert/.test(meldung.message)}`);
  assert.ok(ids.includes("no-restricted-properties:false"));
  assert.ok(!ids.includes("no-restricted-properties:true"));
});

test("uhr-als-wert: process.env bleibt auch in neuen Anrufdateien gesperrt", async () => {
  const [ergebnis] = await eslint.lintText("export const a = () => process.env.X;\n", {
    filePath: resolve(WURZEL, "src/telephony/probe-uhr.js"),
  });
  assert.equal(ergebnis.messages.filter((meldung) => meldung.ruleId === "no-restricted-properties").length, 1);
});

const bestand = konfiguration.find((block) => block.name === "uhr-als-wert")?.ignores ?? [];

test("uhr-als-wert: der Bestand nennt genau die 15 Dateien mit Zeitaufruf", () => {
  assert.equal(bestand.length, 15);
  assert.equal(new Set(bestand).size, 15);
});

for (const datei of bestand) {
  test(`uhr-als-wert: Bestandsdatei ${datei} existiert und enthält noch einen Zeitaufruf`, () => {
    const pfad = resolve(WURZEL, datei);
    assert.ok(existsSync(pfad));
    assert.match(readFileSync(pfad, "utf8"), /Date\.now|setTimeout|setInterval|node:timers/);
  });
}
