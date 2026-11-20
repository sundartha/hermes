import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/status-aus-http";
const TS = "src/telephony/failure-reason.ts";

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, TS) });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

test("HTTP-Konstanten: res.status(410 as const) ist ein Fehler", async () => {
  const gefunden = await befunde("export const a = (res) => res.status(410 as const);\n");
  assert.equal(gefunden.length, 1);
});

test("HTTP-Konstanten: res.status(410 satisfies number) ist ein Fehler", async () => {
  const gefunden = await befunde("export const a = (res) => res.status(410 satisfies number);\n");
  assert.equal(gefunden.length, 1);
});

test("HTTP-Konstanten: res.status(410) bleibt ein Fehler", async () => {
  const gefunden = await befunde("export const a = (res) => res.status(410);\n");
  assert.equal(gefunden.length, 1);
});

test("HTTP-Konstanten: res.status mit importiertem Namen bleibt erlaubt", async () => {
  const gefunden = await befunde('import { HTTP_GONE } from "../utils/http.ts";\nexport const a = (res) => res.status(HTTP_GONE);\n');
  assert.deepEqual(gefunden, []);
});
