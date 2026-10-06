import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  installProcessGuards,
  onUnhandledRejection,
  onUncaughtException,
} from "../src/process-guards.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function captureErr(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return logs.join("\n");
}

test("T-P0-01: installProcessGuards registriert beide Handler", () => {
  assert.ok(process.listeners("unhandledRejection").includes(onUnhandledRejection));
  assert.ok(process.listeners("uncaughtException").includes(onUncaughtException));
  const before = process
    .listeners("uncaughtException")
    .filter((l) => l === onUncaughtException).length;
  installProcessGuards();
  const after = process
    .listeners("uncaughtException")
    .filter((l) => l === onUncaughtException).length;
  assert.equal(after, before);
});

test("T-P0-02: onUnhandledRejection loggt und kehrt zurueck (kein throw/exit)", () => {
  let ret;
  const out = captureErr(() => {
    ret = onUnhandledRejection(new Error("boom-rejection"));
  });
  assert.equal(ret, undefined);
  assert.match(out, /\[guard\] unhandledRejection/);
  assert.match(out, /boom-rejection/);
});

test("T-P0-03: onUncaughtException loggt stack, nie ein Secret", () => {
  const SECRET = "postgres://user:pw@db.internal:5432/secretdb";
  const err = new Error("ECONNREFUSED beim Boot");
  let ret;
  const out = captureErr(() => {
    ret = onUncaughtException(err);
  });
  assert.equal(ret, undefined);
  assert.match(out, /\[guard\] uncaughtException/);
  assert.ok(out.includes(err.stack), "stack soll geloggt werden (Diagnose)");
  assert.ok(!out.includes(SECRET), "Handler darf kein Secret aus config ziehen");
});

function firstImportLine(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
  const found = lines.find((l) => /^\s*import\b/.test(l));
  return found ? found.trim() : null;
}

test("T-P0-07: process-guards ist erste Importzeile in server.js", () => {
  assert.equal(firstImportLine("src/server.js"), 'import "./process-guards.js";');
});

test("T-P0-07: process-guards ist erste Importzeile in mcp-server.js", () => {
  assert.equal(firstImportLine("src/mcp-server.js"), 'import "./process-guards.js";');
});
