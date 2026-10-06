import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import { ROOT, tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

function runCheckSetup(env) {
  const child = spawn(process.execPath, ["scripts/check-setup.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`check-setup.js ist nicht rechtzeitig beendet. Output bisher:\n${output}`));
    }, 8000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

test("npm run check crasht nicht mehr am toten config.ownerNumber (Proxy-Guard-Regression)", async () => {
  const dataDir = tempDataDir();
  const { code, output } = await runCheckSetup({ DATA_DIR: dataDir });
  assert.doesNotMatch(output, /TypeError: config\.ownerNumber existiert nicht/);
  assert.doesNotMatch(output, /Node\.js v\d/);
  assert.match(output, /Ergebnis:/);
  assert.equal(code, 1);
});

test("npm run check meldet die aktive Owner-Nummer aus dem Store (C-P5: kein Provider-Filter mehr)", async () => {
  const seed = seedState({
    numbers: [
      {
        id: "num_telnyx_only",
        e164: "+4915199999",
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Test" }],
  });
  const dataDir = tempDataDir(seed);
  const { output } = await runCheckSetup({ DATA_DIR: dataDir });
  assert.match(output, /Owner-Nummer \(Store\): \+4915199999/);
  assert.doesNotMatch(output, /Keine aktive Owner-Nummer im Store/);
});
