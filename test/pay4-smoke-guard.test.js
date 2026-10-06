import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestKey } from "../scripts/smoke-stripe-payment.mjs";

test("isTestKey: akzeptiert sk_test_-Key", () => {
  assert.equal(isTestKey("sk_test_abc123"), true);
});

test("isTestKey: verweigert sk_live_-Key (fail-closed)", () => {
  assert.equal(isTestKey("sk_live_abc123"), false);
});

test("isTestKey: verweigert leeren/fehlenden Key", () => {
  assert.equal(isTestKey(""), false);
  assert.equal(isTestKey(undefined), false);
  assert.equal(isTestKey(null), false);
});

test("isTestKey: verweigert Nicht-String", () => {
  assert.equal(isTestKey(12345), false);
});
