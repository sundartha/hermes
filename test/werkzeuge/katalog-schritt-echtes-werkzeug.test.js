import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");

test("der Schritt katalog ruft das echte Katalog-Werkzeug ohne unbekanntes Argument auf und endet grün", () => {
  const lauf = spawnSync(process.execPath, ["tools/pruefen.mjs", "katalog", "--basis", "HEAD"], { cwd: WURZEL, encoding: "utf8" });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Alles grün\./);
});
