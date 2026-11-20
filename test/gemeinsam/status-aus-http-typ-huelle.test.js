import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/status-aus-http";
const eslint = new ESLint({ cwd: WURZEL });

async function befunde(quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, "src/call-duration.ts") });
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

const NAME_MIT_HUELLE =
  "export const a = (res: any) => {\n  const code = 410;\n  return res.status(code as number).json({});\n};\n";
const NAME_MIT_SATISFIES =
  "export const a = (res: any) => {\n  const code = 410;\n  return res.status(code satisfies number).json({});\n};\n";
const ZWEIG_MIT_HUELLE =
  "export const a = (res: any, x: boolean) => res.status((x ? 410 : 404) as const).json({});\n";
const PARAMETER_MIT_HUELLE = "export const a = (res: any, status: number) => res.status(status as number).end();\n";

test("Statuscode-Regel: ein Zahlen-Name mit as-Hülle ist ein Fehler", async () => {
  assert.equal((await befunde(NAME_MIT_HUELLE)).length, 1);
});
test("Statuscode-Regel: ein Zahlen-Name mit satisfies-Hülle ist ein Fehler", async () => {
  assert.equal((await befunde(NAME_MIT_SATISFIES)).length, 1);
});
test("Statuscode-Regel: eine Verzweigung mit Zahlen und Hülle ist ein Fehler", async () => {
  assert.equal((await befunde(ZWEIG_MIT_HUELLE)).length, 1);
});
test("Statuscode-Regel: ein durchgereichter Parameter mit Hülle bleibt erlaubt", async () => {
  assert.deepEqual(await befunde(PARAMETER_MIT_HUELLE), []);
});
