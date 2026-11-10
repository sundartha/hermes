import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BAD_URL = "postgres://baduser:s3cretpass@127.0.0.1:1/nodb";

function lauf(code, env) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: ROOT,
    env: kindUmgebung({ ...BASE_ENV, DATA_DIR: tempDataDir(), ...env }),
    encoding: "utf8",
    timeout: 20000,
  });
}

const PG = { STORE_BACKEND: "pg", DATABASE_URL: BAD_URL };

test("Import von store.js mit pg und unerreichbarer Datenbank laeuft ohne Wirkung durch", () => {
  const r = lauf('const s = await import("./src/store.js"); console.log("OK " + typeof s.oeffneSpeicher);', PG);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK function/);
  assert.ok(!r.stderr.includes("[store]"), r.stderr);
});

test("pg: Zugriff vor oeffneSpeicher() ist ein harter Fehler", () => {
  const r = lauf(
    'const s = await import("./src/store.js"); try { s.load(); console.log("KEIN FEHLER"); } catch (e) { console.log("FEHLER " + e.message); }',
    PG,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /FEHLER .*oeffneSpeicher/);
});

test("pg: oeffneSpeicher() bei unerreichbarer Datenbank bricht mit [store] FATAL und Exit 1, ohne Geheimnis", () => {
  const r = lauf('const s = await import("./src/store.js"); await s.oeffneSpeicher(); console.log("WEITER");', PG);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /\[store\] FATAL/);
  assert.ok(!r.stderr.includes("s3cretpass"));
  assert.ok(!r.stdout.includes("WEITER"));
});

test("json: erster Zugriff oeffnet von selbst, Werte bleiben null, oeffneSpeicher ist idempotent", () => {
  const r = lauf(
    `const s = await import("./src/store.js");
const a = s.oeffneSpeicher(); const b = s.oeffneSpeicher();
console.log(JSON.stringify({ gleich: a === b, zustellung: s.webhookZustellung, register: s.stripeEreignisRegister, pool: s.poolZustand(), tenants: Array.isArray(s.load().numbers) }));`,
    { STORE_BACKEND: "json" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { gleich: true, zustellung: null, register: null, pool: null, tenants: true });
});
