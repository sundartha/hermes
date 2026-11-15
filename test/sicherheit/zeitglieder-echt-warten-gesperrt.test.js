import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LISTE = JSON.parse(readFileSync(resolve(WURZEL, "tools/basis/echte-wartezeiten.json"), "utf8"));
const eslint = new ESLint({ cwd: WURZEL });
const REGEL = "hermes-tests/kein-echt-warten";
const NEUE_DATEI = "test/anrufe/neu-ohne-liste.test.js";
const GELISTET = "test/posteingang/posteingang-poll-seite.test.js";

async function meldungen(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL || /Echte Wartezeit/.test(meldung.message));
}

const NEUE_BEZUEGE = [
  ["statischer Import", 'import { echtWarten } from "../echt-warten.js";\nexport const a = echtWarten;\n'],
  ["dynamischer Import", 'const { echtWarten } = await import("../echt-warten.js");\nexport const a = echtWarten;\n'],
  ["require", 'const { echtWarten } = require("../echt-warten.js");\nexport const a = echtWarten;\n'],
];

for (const [name, quelltext] of NEUE_BEZUEGE) {
  test(`neue Testdatei außerhalb der Liste: ${name} von echt-warten meldet Lint mit der Absicht`, async () => {
    const gefunden = await meldungen(NEUE_DATEI, quelltext);
    assert.equal(gefunden.length, 1);
    assert.equal(gefunden[0].ruleId, REGEL);
    assert.match(gefunden[0].message, /simulierte Zeit \(t\.mock\.timers, jumpClock aus test\/fake-clock\.js\)/);
    assert.match(gefunden[0].message, /nur noch für den Altbestand/);
  });
}

test("neue Testdatei außerhalb der Liste: setTimeout mit festem Wert meldet weiterhin", async () => {
  const gefunden = await meldungen(NEUE_DATEI, "setTimeout(() => {}, 100);\n");
  assert.equal(gefunden.length, 1);
  assert.equal(gefunden[0].ruleId, "no-restricted-globals");
});

test("gelistete Datei mit Import von echt-warten bleibt grün", async () => {
  assert.ok(LISTE.includes(GELISTET));
  assert.deepEqual(await meldungen(GELISTET, NEUE_BEZUEGE[1][1]), []);
});

test("gelistete Datei ohne Import meldet: Datei aus Liste streichen", async () => {
  const gefunden = await meldungen(GELISTET, "export const a = 1;\n");
  assert.equal(gefunden.length, 1);
  assert.equal(gefunden[0].message, `Datei aus Liste streichen: ${GELISTET} nutzt echt-warten nicht mehr.`);
});

test("Datei ohne Bezug und nicht in der Liste bleibt grün", async () => {
  assert.deepEqual(await meldungen(NEUE_DATEI, 'const text = "echt-warten.js";\nexport const a = text;\n'), []);
});

test("die Liste ist sortiert und ohne Doppelte", () => {
  assert.deepEqual(LISTE, [...new Set(LISTE)].sort());
});
