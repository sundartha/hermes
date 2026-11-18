import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: WURZEL });

async function uhrBefunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  return ergebnis.messages.filter((meldung) => /Uhr als Wert übergeben/.test(meldung.message));
}

test("uhr-warten: Import von sleep aus utils/uhr-warten wird in Anrufdateien gemeldet", async () => {
  const befunde = await uhrBefunde("src/telephony/probe-uhr.js", 'import { sleep } from "../utils/uhr-warten.ts";\nexport const a = sleep;\n');
  assert.equal(befunde.length, 1);
});

test("uhr-warten: Import von defaultSetTimer aus utils/uhr-warten wird in Anrufdateien gemeldet", async () => {
  const befunde = await uhrBefunde("src/telephony/probe-uhr.js", 'import { defaultSetTimer } from "../utils/uhr-warten.ts";\nexport const a = defaultSetTimer;\n');
  assert.equal(befunde.length, 1);
});
