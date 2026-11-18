import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const NEU = join(WURZEL, "tools/neu.mjs");
const ordner = [];

after(() => {
  for (const eintrag of ordner) rmSync(eintrag, { recursive: true, force: true });
});

test("ein neuer Test im Bereich posteingang wird angelegt und importiert die Inbox-Route", () => {
  const root = mkdtempSync(join(tmpdir(), "neu-posteingang-"));
  ordner.push(root);
  mkdirSync(join(root, "tools"));
  mkdirSync(join(root, "src/routes"), { recursive: true });
  cpSync(join(WURZEL, "tools/bereiche.json"), join(root, "tools/bereiche.json"));
  writeFileSync(join(root, "src/routes/api-inbox.ts"), "export {};\n");
  const ergebnis = spawnSync(process.execPath, [NEU, "--wurzel", root, "test", "posteingang", "probe-xyz"], { cwd: root, encoding: "utf8" });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  const text = readFileSync(join(root, "test/posteingang/probe-xyz.test.js"), "utf8");
  assert.match(text, /src\/routes\/api-inbox\.ts/);
});
