import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import konfiguration from "../../eslint.config.js";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });
const block = konfiguration.find((eintrag) => eintrag.name === "uhr-als-wert-quellen");
const bestand = block?.ignores ?? [];

async function uhrBefunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => /Uhr als Wert übergeben/.test(meldung.message));
}

const VERSTOESSE = [
  ["Date.now()", "export const a = () => Date.now();\n"],
  ["performance.now()", "export const a = () => performance.now();\n"],
  ["new Date() ohne Argument", "export const a = () => new Date();\n"],
  ["setTimeout", "export const a = () => setTimeout(() => 1, 5);\n"],
  ["setInterval", "export const a = () => setInterval(() => 1, 5);\n"],
  ["setImmediate", "export const a = () => setImmediate(() => 1);\n"],
  ["process.hrtime", "export const a = () => process.hrtime();\n"],
  ["globalThis.setTimeout", "export const a = () => globalThis.setTimeout(() => 1, 5);\n"],
  ["Import von sleep aus utils/uhr-warten", 'import { sleep } from "../utils/uhr-warten.js";\nexport const a = sleep;\n'],
  ["Import von defaultSetTimer aus utils/timer", 'import { defaultSetTimer } from "../utils/timer.js";\nexport const a = defaultSetTimer;\n'],
  ["Import aus node:timers", 'import { setTimeout as warte } from "node:timers";\nexport const a = warte;\n'],
  ["Import aus node:timers/promises", 'import { setTimeout as warte } from "node:timers/promises";\nexport const a = warte;\n'],
];

const ORDNER = ["store", "routes", "billing", "queue", "worker", "consult", "conversation"];

const PROBEN = [
  ...ORDNER.map((ordner) => `src/${ordner}/probe-uhr.js`),
  "src/store/cost-evidence.ts",
  "src/routes/_call-request.ts",
  "src/billing/activation.ts",
  "src/queue/zeitplan-frist.ts",
  "src/consult/question.ts",
  "src/conversation/elevenlabs-agent-config.ts",
];

for (const probe of PROBEN) {
  for (const [name, quelltext] of VERSTOESSE) {
    test(`uhr-als-wert-quellen: ${name} in ${probe} wird einmal gemeldet`, async () => {
      const gefunden = await uhrBefunde(probe, quelltext);
      assert.equal(gefunden.length, 1);
    });
  }
}

test("uhr-als-wert-quellen: new Date(wert) und Date.parse werden nicht gemeldet", async () => {
  const quelltext = "export const a = (wert) => [new Date(wert), Date.parse(wert)];\n";
  for (const ordner of ORDNER) {
    assert.deepEqual(await uhrBefunde(`src/${ordner}/probe-uhr.js`, quelltext), []);
  }
});

test("uhr-als-wert-quellen: ausserhalb der sieben Ordner gilt die Regel nicht", async () => {
  assert.deepEqual(await uhrBefunde("src/utils/probe-uhr.js", VERSTOESSE[0][1]), []);
});

test("uhr-als-wert-quellen: die Cent-Regel im Speicher und die Router-Form in Routen gelten weiter", async () => {
  const [store] = await eslint.lintText("export const a = (t) => { t.costCents = 1; };\n", {
    filePath: resolve(WURZEL, "src/store/probe-uhr.js"),
  });
  assert.equal(store.messages.filter((meldung) => /Cent-Stände schreiben/.test(meldung.message)).length, 1);
  const [route] = await eslint.lintText("export const a = () => Date.now();\n", {
    filePath: resolve(WURZEL, "src/routes/probe-uhr.js"),
  });
  assert.equal(route.messages.filter((meldung) => /Uhr als Wert/.test(meldung.message)).length, 1);
});

test("uhr-als-wert-quellen: process.env bleibt in neuen Dateien der Ordner gesperrt", async () => {
  const [ergebnis] = await eslint.lintText("export const a = () => process.env.X;\n", {
    filePath: resolve(WURZEL, "src/queue/probe-uhr.js"),
  });
  assert.equal(ergebnis.messages.filter((meldung) => meldung.ruleId === "no-restricted-properties").length, 1);
});

test("uhr-als-wert-quellen: eine Bestandsdatei wird nicht gemeldet", async () => {
  assert.ok(bestand.length > 0);
  assert.deepEqual(await uhrBefunde(bestand[0], VERSTOESSE[0][1]), []);
});

test("uhr-als-wert-quellen: der Bestand wächst nie über 46 Dateien und nennt keine Datei doppelt", () => {
  assert.ok(bestand.length > 0);
  assert.ok(bestand.length <= 46);
  assert.equal(new Set(bestand).size, bestand.length);
});

for (const datei of bestand) {
  test(`uhr-als-wert-quellen: Bestandsdatei ${datei} liegt in einem der Ordner und enthält noch einen Zeitaufruf`, () => {
    const pfad = resolve(WURZEL, datei);
    assert.match(datei, new RegExp(`^src/(${ORDNER.join("|")})/`));
    assert.ok(existsSync(pfad));
    assert.match(readFileSync(pfad, "utf8"), /Date\.now|performance\.now|new Date\(\)|setTimeout|setInterval|setImmediate|node:timers|hrtime|utils\/(timer|uhr-warten)/);
  });
}
