import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";

const HTTP_FOUND = 302;

test('GET "/" -> 302 auf /auth/login (Landing-Redirect, kein 404/Auth-Sackgasse)', async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/`, { redirect: "manual" });
    assert.equal(res.status, HTTP_FOUND);
    assert.equal(res.headers.get("location"), "/auth/login");
  } finally {
    await srv.stop();
  }
});
