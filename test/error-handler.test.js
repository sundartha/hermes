import { test } from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "../src/middleware.js";

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headersSent: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  return res;
}

function captureConsoleError(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

test("T-P4-AC4-01: generische 500 {error:'internal error'}, KEIN err.message/stack im Body", () => {
  const res = fakeRes();
  const err = new Error("ROH_SECRET_token=abc123");
  err.stack = "Error: ROH_SECRET_token=abc123\n  at leak (secret.js:1:1)";
  captureConsoleError(() => errorHandler(err, {}, res, () => {}));

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "internal error" });
  const bodyStr = JSON.stringify(res.body);
  assert.doesNotMatch(
    bodyStr,
    /ROH_SECRET|abc123|secret\.js/,
    "kein err.message/stack im Client-Body",
  );
});

test("T-P4-AC4-02: err.stack wird server-seitig laut geloggt (nur Log, nie Response)", () => {
  const res = fakeRes();
  const err = new Error("boom");
  err.stack = "Error: boom\n  at x (y.js:1:1)";
  const logs = captureConsoleError(() => errorHandler(err, {}, res, () => {}));
  assert.ok(
    logs.some((l) => /boom/.test(l)),
    "Fehler wird server-seitig geloggt",
  );
});

test("T-P4-AC4-03: headersSent -> an next(err) delegieren (Express-Default uebernimmt)", () => {
  const res = fakeRes();
  res.headersSent = true;
  let delegated = null;
  const err = new Error("late");
  captureConsoleError(() =>
    errorHandler(err, {}, res, (e) => {
      delegated = e;
    }),
  );
  assert.equal(delegated, err);
  assert.equal(res.statusCode, null, "kein erneuter Status-Write nach headersSent");
});
