import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { patternFlagFor } from "./i18n-catalog-run.mjs";

const TARGET_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "al-p10b-lookup.test.js");

const CHILD_TIMEOUT_MS = 30_000;

function runFilteredAgainstTarget() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--test", patternFlagFor("gates"), TARGET_FILE],
      { timeout: CHILD_TIMEOUT_MS },
    );
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stdout += d));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout }));
  });
}

test("AL-P10b-Hooks: Gates-Filter gegen al-p10b-lookup.test.js terminiert sauber ohne hookFailed", async () => {
  const { code, signal, stdout } = await runFilteredAgainstTarget();
  assert.equal(signal, null, `Kindprozess wurde per Signal beendet (Haenger?): ${signal}`);
  assert.equal(code, 0, `Kindprozess EXIT ${code}, Ausgabe:\n${stdout}`);
  assert.doesNotMatch(stdout, /hookFailed/, "after()-Hook darf bei fehlendem before() nicht werfen");
});
