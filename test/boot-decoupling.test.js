// P0/AC6: pg-Store ist eine HARTE Dependency (Persistenz auch fuer Telefonie).
// Ist die pg-DB beim Boot unerreichbar, MUSS der Prozess mit einer klaren, secret-
// freien Diagnose sterben (exit 1) - KEIN stiller json-Fallback (Split-Brain), KEINE
// rohe pg-Rejection (Connection-String-Leak). Kindprozess-Test (echter Boot).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_ENV, tempDataDir } from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Port 1 -> sofortiges ECONNREFUSED (kein Haengen). Credentials im String, um den
// Secret-Leak-Check scharf zu machen.
const BAD_URL = "postgres://baduser:s3cretpass@127.0.0.1:1/nodb";

function spawnServer(envOverride) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["src/server.js"], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, ...BASE_ENV, ...envOverride, DATA_DIR: tempDataDir() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("exit", (code, signal) => resolve({ code, signal, out }));
  });
}

test("T-P0-06: STORE_BACKEND=pg + unreachable DATABASE_URL -> exit(1), secret-frei", async () => {
  const { code, out } = await spawnServer({
    STORE_BACKEND: "pg",
    DATABASE_URL: BAD_URL,
    SESSION_SECRET: "x",
    PORT: "0",
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${out}`);
  assert.match(out, /\[store\]/, "klare Store-Diagnose erwartet");
  assert.ok(!out.includes(BAD_URL), `Connection-String darf NICHT im Log stehen:\n${out}`);
  assert.ok(!out.includes("s3cretpass"), `Passwort darf NICHT im Log stehen:\n${out}`);
});
