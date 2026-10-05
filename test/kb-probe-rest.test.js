import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
test("KB-Probe lässt sleep zurück", () => {
  const kind = spawn("sleep", ["300"], { stdio: "ignore" });
  assert.ok(Number.isInteger(kind.pid));
  if (process.env.KB_PROBE_PIDS) writeFileSync(process.env.KB_PROBE_PIDS, `sleep=${kind.pid}\n`);
  kind.unref();
});
