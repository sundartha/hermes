import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/status-aus-http";

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

const TS = "src/telephony/failure-reason.ts";

const FAELLE = [
  ["Ziffer im Namen", "src/probe-http.js", "const HTTP_2XX_MIN = 200;\nexport const a = HTTP_2XX_MIN;\n"],
  ["as const", TS, "const HTTP_GONE = 410 as const;\nexport const a = HTTP_GONE;\n"],
  ["satisfies number", TS, "const HTTP_GONE = 410 satisfies number;\nexport const a = HTTP_GONE;\n"],
  ["as const und satisfies verschachtelt", TS, "const HTTP_GONE = (410 as const) satisfies number;\nexport const a = HTTP_GONE;\n"],
];

for (const [name, datei, quelltext] of FAELLE) {
  test(`HTTP-Konstanten: eine eigene HTTP_*-Zahl (${name}) ist ein Fehler`, async () => {
    const gefunden = await befunde(datei, quelltext);
    assert.equal(gefunden.length, 1);
    assert.match(gefunden[0].message, /src\/utils\/http\.ts/);
  });
}

test("HTTP-Konstanten: res.status mit lokaler Zahl as const ist ein Fehler", async () => {
  const gefunden = await befunde(TS, "const CODE = 410 as const;\nexport const a = (res) => res.status(CODE);\n");
  assert.equal(gefunden.length, 1);
});

test("HTTP-Konstanten: res.status mit lokaler Zahl ohne Hülle bleibt ein Fehler", async () => {
  const gefunden = await befunde(TS, "const CODE = 410;\nexport const a = (res) => res.status(CODE);\n");
  assert.equal(gefunden.length, 1);
});

test("HTTP-Konstanten: Text mit as const bleibt erlaubt", async () => {
  assert.deepEqual(await befunde(TS, 'const HTTP_POST = "POST" as const;\nexport const a = HTTP_POST;\n'), []);
});
