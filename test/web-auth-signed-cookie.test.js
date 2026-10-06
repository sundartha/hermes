import { test } from "node:test";
import assert from "node:assert/strict";
import { signValue, readSignedCookie } from "../src/web-auth.js";

const SECRET = "test-session-secret-readsignedcookie";

function fakeReqWithCookie(name, rawValue) {
  return { headers: { cookie: `${name}=${encodeURIComponent(rawValue)}` } };
}

test("readSignedCookie: Cookie fehlt komplett -> null", () => {
  const req = { headers: {} };
  assert.equal(readSignedCookie(req, "session", SECRET), null);
});

test("readSignedCookie: anderer Cookie-Name gesetzt, gesuchter fehlt -> null", () => {
  const req = fakeReqWithCookie("oauth_state", signValue("wert", SECRET));
  assert.equal(readSignedCookie(req, "session", SECRET), null);
});

test("readSignedCookie: vorhanden, aber falsch signiert -> null (fail-closed)", () => {
  const req = fakeReqWithCookie("session", "sess123.bogus-signature");
  assert.equal(readSignedCookie(req, "session", SECRET), null);
});

test("readSignedCookie: vorhanden, mit ANDEREM Secret signiert -> null", () => {
  const req = fakeReqWithCookie("session", signValue("sess123", "anderes-secret"));
  assert.equal(readSignedCookie(req, "session", SECRET), null);
});

test("readSignedCookie: korrekt signiert -> liefert den urspruenglichen Wert", () => {
  const req = fakeReqWithCookie("session", signValue("sess123", SECRET));
  assert.equal(readSignedCookie(req, "session", SECRET), "sess123");
});
