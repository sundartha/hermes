import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  installProcessGuards,
  onUnhandledRejection,
  onUncaughtException,
} from "../src/process-guards.js";

function captureErr(fn) {
  const logs = [];
  const stderr = mock.method(console, "error", (...teile) => logs.push(teile.map(String).join(" ")));
  try {
    fn();
  } finally {
    stderr.mock.restore();
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
