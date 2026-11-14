import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");

test("der Bedrohungskatalog nimmt keine Basis an, mit der er nichts vergleicht", () => {
  const lauf = spawnSync(process.execPath, ["tools/katalog-pruefen.mjs", "--basis", "irgendein-stand"], { cwd: WURZEL, encoding: "utf8" });
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.stderr, /basis/);
});
