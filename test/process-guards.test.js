// P0/OT-1: globales Crash-Netz. Unit-Tests gegen die benannten Handler (ohne
// echten Prozess-Crash) + statischer Import-Order-Check (Regressions-Schutz).
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

// Spy auf console.error: sammelt die zusammengesetzten Log-Zeilen, stellt das
// Original im finally wieder her (kein Leak zwischen Tests).
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

// T-P0-01: Side-Effect beim Import registriert GENAU unsere benannten Handler.
test("T-P0-01: installProcessGuards registriert beide Handler", () => {
  assert.ok(process.listeners("unhandledRejection").includes(onUnhandledRejection));
  assert.ok(process.listeners("uncaughtException").includes(onUncaughtException));
  // Idempotenz-Anker: erneuter Aufruf darf den Handler nicht doppelt anhaengen.
  const before = process
    .listeners("uncaughtException")
    .filter((l) => l === onUncaughtException).length;
  installProcessGuards();
  const after = process
    .listeners("uncaughtException")
    .filter((l) => l === onUncaughtException).length;
  assert.equal(after, before);
});

// T-P0-02: unhandledRejection loggt [guard], wirft nicht, exitet nicht.
test("T-P0-02: onUnhandledRejection loggt und kehrt zurueck (kein throw/exit)", () => {
  let ret;
  const out = captureErr(() => {
    ret = onUnhandledRejection(new Error("boom-rejection"));
  });
  assert.equal(ret, undefined);
  assert.match(out, /\[guard\] unhandledRejection/);
  assert.match(out, /boom-rejection/);
});

// T-P0-03: uncaughtException loggt diagnostisch (stack), aber secret-frei -
// der Handler zieht NUR aus dem err, nie aus config/Connection-String/Env.
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

// Erste statische Importzeile einer Quelldatei (nach Shebang/Kommentaren).
function firstImportLine(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
  const found = lines.find((l) => /^\s*import\b/.test(l));
  return found ? found.trim() : null;
}

// T-P0-07: Guard-Import MUSS die erste Importzeile sein (vor store.js) - sonst
// entkommen Boot-Rejections wieder (ESM-Eval-Order). Statischer Re-Regressions-Schutz.
test("T-P0-07: process-guards ist erste Importzeile in server.js", () => {
  assert.equal(firstImportLine("src/server.js"), 'import "./process-guards.js";');
});

test("T-P0-07: process-guards ist erste Importzeile in mcp-server.js", () => {
  assert.equal(firstImportLine("src/mcp-server.js"), 'import "./process-guards.js";');
});
