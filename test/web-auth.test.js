import { test } from "node:test";
import assert from "node:assert/strict";
import { signValue, verifyValue, makePkce } from "../src/web-auth.js";

const SECRET = "test-session-secret-0123456789";

test("signValue/verifyValue round-trip + Manipulation -> null", () => {
  const signed = signValue("sess123", SECRET);
  assert.equal(verifyValue(signed, SECRET), "sess123");
  assert.equal(verifyValue(signed + "x", SECRET), null, "manipuliert -> null");
  assert.equal(verifyValue("garbage", SECRET), null);
});

test("makePkce liefert verifier + S256-challenge", () => {
  const { verifier, challenge } = makePkce();
  assert.ok(verifier.length >= 43 && challenge.length >= 43);
  assert.notEqual(verifier, challenge);
});
