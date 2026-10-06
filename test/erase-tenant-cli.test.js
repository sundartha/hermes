import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, BASE_ENV, tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const SCRIPT = "scripts/erase-tenant.js";
const SPAWN_TIMEOUT_MS = 8000;
const EXIT_REFUSED = 1;
const EXIT_OK = 0;
const TRANSCRIPT_SECRET_TEXT = "Mein Geheimnis lautet 12345";
const PRIVATE_NUMBER_SEED = "+4915100000999";
const REFUSED_INVOCATIONS = [[], [BOOTSTRAP_TENANT_ID]];

function seededDataDir() {
  return tempDataDir(
    seedState({
      calls: [
        seedCall({
          id: "call_erase_1",
          transcript: [{ role: "caller", text: TRANSCRIPT_SECRET_TEXT, at: "2026-01-01T00:00:00Z" }],
        }),
      ],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", privateNumber: PRIVATE_NUMBER_SEED }],
    }),
  );
}

function storeTextOf(dataDir) {
  return fs.readFileSync(path.join(dataDir, "store.json"), "utf8");
}

function runErase(dataDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: { ...BASE_ENV, DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`erase-tenant.js ist nicht rechtzeitig beendet. stdout:\n${stdout}\nstderr:\n${stderr}`));
    }, SPAWN_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("LAW-14 (Mechanismus, gruen) - ohne tenantId ODER ohne --confirm: Exit 1, Store byte-identisch", async () => {
  for (const args of REFUSED_INVOCATIONS) {
    const dataDir = seededDataDir();
    const before = storeTextOf(dataDir);
    const { code, stderr } = await runErase(dataDir, args);
    assert.equal(code, EXIT_REFUSED, `Invokation ${JSON.stringify(args)} muss fail-closed verweigern`);
    assert.match(stderr, /Aufruf: node scripts\/erase-tenant\.js/);
    assert.equal(storeTextOf(dataDir), before, "verweigerter Aufruf darf den Store nicht anfassen");
  }
});

test("LAW-14 (Mechanismus, gruen) - tenantId + --confirm: Exit 0, PII-freie Zaehlerzeile, Daten weg", async () => {
  const dataDir = seededDataDir();
  const { code, stdout } = await runErase(dataDir, [BOOTSTRAP_TENANT_ID, "--confirm"]);
  assert.equal(code, EXIT_OK);
  assert.match(stdout, /calls=1 .*transcriptSegments=\d+ .*privateNumber=\d/s);
  assert.doesNotMatch(stdout, new RegExp(TRANSCRIPT_SECRET_TEXT), "Erase-Log darf keinen Transkript-Text tragen (PII-frei)");
  const store = JSON.parse(storeTextOf(dataDir));
  assert.equal(store.calls.length, 0, "der Tenant-Call ist geloescht");
});
