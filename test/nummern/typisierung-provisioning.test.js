import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));

test("Typisierung Nummernkauf-Auftrag: provisioning ist TypeScript, die JS-Fassung ist weg", () => {
  const dateien = execFileSync("git", ["ls-files", "src/worker"], { cwd: WURZEL, encoding: "utf8" }).split("\n");
  assert.ok(dateien.includes("src/worker/provisioning.ts"));
  assert.ok(!dateien.includes("src/worker/provisioning.js"));
});
