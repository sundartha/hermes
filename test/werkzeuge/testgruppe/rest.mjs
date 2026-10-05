import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

test("lässt einen Prozess zurück", () => {
  const enkel = spawn("sleep", ["600"], { stdio: "ignore" });
  writeFileSync(process.env.TESTGRUPPE_PIDS, JSON.stringify({ enkel: enkel.pid }));
  enkel.unref();
  assert.equal(process.env.TESTGRUPPE_ROT, undefined);
});
