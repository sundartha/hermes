import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { test } from "node:test";

const MODUL = new URL("../../tools/mutationspruefung/nur-sandbox-rot.mjs", import.meta.url).href;
const ROT = "test/rot.test.mjs";
const ANDERE = "test/andere.test.mjs";
const MARKE = "andere-geladen";
const AUFRUF = "gegenprobe.mjs";
const GRUENER_FALL = 'import { test } from "node:test";\ntest("fall", () => {});\n';

function ordnerMit(context, dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "gegenprobe-datei-"));
  mkdirSync(join(ordner, "test"));
  for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(ordner, name), inhalt);
  context.after(() => rmSync(ordner, { recursive: true, force: true }));
  return ordner;
}

function gegenprobe(ordner, tests) {
  const ohneTestKontext = Object.fromEntries(Object.entries(env).filter(([name]) => name !== "NODE_TEST_CONTEXT"));
  const skript = `const { ohneSandboxGruen } = await import(${JSON.stringify(MODUL)}); console.log(JSON.stringify(ohneSandboxGruen([{ datei: ${JSON.stringify(ROT)}, test: "fall" }], ${JSON.stringify(tests)})));`;
  writeFileSync(join(ordner, AUFRUF), skript);
  const lauf = spawnSync(execPath, [AUFRUF], { cwd: ordner, env: ohneTestKontext, encoding: "utf8" });
  assert.equal(lauf.status, 0, lauf.stderr);
  return JSON.parse(lauf.stdout);
}

test("Gegenprobe ohne Sandbox startet nur die Datei des roten Falls", (context) => {
  const ordner = ordnerMit(context, {
    [ROT]: GRUENER_FALL,
    [ANDERE]: `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(MARKE)}, "");\n`,
  });
  assert.deepEqual(gegenprobe(ordner, [ROT, ANDERE]), [{ datei: ROT, test: "fall" }]);
  assert.equal(existsSync(join(ordner, MARKE)), false);
});

test("Gegenprobe ohne Sandbox bleibt rot, wenn die Datei des roten Falls nicht unter den Tests ist", (context) => {
  const ordner = ordnerMit(context, { [ROT]: GRUENER_FALL });
  assert.deepEqual(gegenprobe(ordner, [ANDERE]), []);
});
