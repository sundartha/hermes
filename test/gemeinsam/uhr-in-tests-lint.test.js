import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import konfiguration from "../../eslint.config.js";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });
const block = konfiguration.find((eintrag) => eintrag.name === "uhr-in-tests");
const FESTE_AUSNAHMEN = ["test/echt-warten.js", "test/gemeinsam/testgruppe.mjs", "test/gemeinsam/ppid-waechter.mjs"];
const bestand = (block?.ignores ?? []).filter((datei) => !FESTE_AUSNAHMEN.includes(datei));
const BESTAND_HOECHSTENS = 322;

async function meldungen(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages;
}

async function uhrBefunde(datei, quelltext) {
  return (await meldungen(datei, quelltext)).filter((meldung) => /gemeinsame Uhr/.test(meldung.message));
}

const VERSTOESSE = [
  ["Date.now()", "export const a = () => Date.now();\n"],
  ["performance.now()", "export const a = () => performance.now();\n"],
  ["globalThis.performance.now()", "export const a = () => globalThis.performance.now();\n"],
  ["new Date() ohne Argument", "export const a = () => new Date();\n"],
  ["process.hrtime()", "export const a = () => process.hrtime();\n"],
  ["process.hrtime.bigint()", "export const a = () => process.hrtime.bigint();\n"],
];

const PROBEN = ["test/anrufe/probe-uhr.test.js", "test/gemeinsam/probe-uhr.mjs", "test/abrechnung/probe-uhr.cjs"];

for (const probe of PROBEN) {
  for (const [name, quelltext] of VERSTOESSE) {
    test(`uhr-in-tests: ${name} in ${probe} wird einmal gemeldet`, async () => {
      assert.equal((await uhrBefunde(probe, quelltext)).length, 1);
    });
  }
}

test("uhr-in-tests: new Date(wert), Date.parse und t.mock.timers bleiben frei", async () => {
  const quelltext = [
    'export const a = (wert) => [new Date("2026-01-01"), new Date(wert), Date.parse(wert)];',
    'export const b = (t) => t.mock.timers.enable({ apis: ["Date"] });',
    "",
  ].join("\n");
  for (const probe of PROBEN) {
    assert.deepEqual(await uhrBefunde(probe, quelltext), []);
  }
});

test("uhr-in-tests: die festen Ausnahmen werden nicht gemeldet", async () => {
  for (const datei of FESTE_AUSNAHMEN) {
    assert.deepEqual(await uhrBefunde(datei, VERSTOESSE[0][1]), []);
  }
});

test("uhr-in-tests: eine Bestandsdatei wird nicht gemeldet", async () => {
  assert.ok(bestand.length > 0);
  assert.deepEqual(await uhrBefunde(bestand[0], VERSTOESSE[0][1]), []);
});

test("uhr-in-tests: ausserhalb von test/ gilt der Block nicht", async () => {
  assert.deepEqual(await uhrBefunde("tools/probe-uhr.mjs", VERSTOESSE[0][1]), []);
});

test("uhr-in-tests: setTimeout in einer neuen Testdatei meldet weiter der Block zeitglieder-in-tests", async () => {
  const gefunden = await meldungen("test/anrufe/probe-uhr.test.js", "export const a = () => setTimeout(() => 1, 5);\n");
  assert.equal(gefunden.filter((meldung) => /Echte Wartezeit/.test(meldung.message)).length, 1);
});

for (const [name, quelltext] of [
  ["Atomics.wait", "export const a = (x) => Atomics.wait(x, 0, 0, 5);\n"],
  ["globalThis.setTimeout", "export const a = () => globalThis.setTimeout(() => 1, 5);\n"],
  ["globalThis.setInterval", "export const a = () => globalThis.setInterval(() => 1, 5);\n"],
]) {
  test(`uhr-in-tests: ${name} in einer neuen Testdatei bleibt als echte Wartezeit gemeldet`, async () => {
    const gefunden = await meldungen("test/anrufe/probe-uhr.test.js", quelltext);
    assert.equal(gefunden.filter((meldung) => /Echte Wartezeit/.test(meldung.message)).length, 1);
  });
}

test("uhr-in-tests: Demeter und uebersprungene Tests bleiben in Testdateien gesperrt", async () => {
  const demeter = await meldungen("test/anrufe/probe-uhr.test.js", "export const a = (x) => x.b.c.d.e.f;\n");
  assert.ok(demeter.some((meldung) => /Demeter/.test(meldung.message)));
  const quelltext = 'import { test } from "node:test";\ntest.skip("x", () => 1);\n';
  const uebersprungen = await meldungen("test/anrufe/probe-uhr.test.js", quelltext);
  assert.ok(uebersprungen.some((meldung) => /uebersprungener Test/.test(meldung.message)));
});

test("uhr-in-tests: der Bestand wächst nie über die heutige Zahl und nennt keine Datei doppelt", () => {
  assert.ok(bestand.length > 0);
  assert.ok(bestand.length <= BESTAND_HOECHSTENS);
  assert.equal(new Set(bestand).size, bestand.length);
});

test("uhr-in-tests: jede Bestandsdatei liegt unter test/, existiert und enthält noch einen Uhr-Zugriff", () => {
  const ohneTreffer = bestand.filter((datei) => {
    const vorhanden = datei.startsWith("test/") && existsSync(resolve(WURZEL, datei));
    return !vorhanden || !/Date\.now|performance\.now|new Date\(\s*\)|process\.hrtime/.test(readFileSync(resolve(WURZEL, datei), "utf8"));
  });
  assert.deepEqual(ohneTreffer, []);
});
