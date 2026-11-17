import assert from "node:assert/strict";
import { test } from "node:test";

import { audit, auditAuthFailed } from "../../src/util.ts";

function zeile(t, aufruf) {
  const log = t.mock.method(console, "log", () => {});
  aufruf();
  assert.equal(log.mock.callCount(), 1);
  return log.mock.calls[0].arguments[0];
}

test("audit ohne Anfrage nennt ip=system, mit Anfrage deren Adresse", (t) => {
  assert.equal(zeile(t, () => audit("x")), "[audit] x ip=system");
  t.mock.restoreAll();
  assert.equal(zeile(t, () => audit("x", { ip: undefined })), "[audit] x ip=system");
  t.mock.restoreAll();
  assert.equal(zeile(t, () => audit("x", { ip: "203.0.113.7" }, "d=1")), "[audit] x ip=203.0.113.7 d=1");
});

test("auditAuthFailed nennt Pfad, Grund und Adresse", (t) => {
  assert.equal(
    zeile(t, () => auditAuthFailed({ ip: undefined, path: "/p" }, "no_session", "extra")),
    "[audit] auth_failed ip=system path=/p grund=no_session extra",
  );
});
