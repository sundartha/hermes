import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";

function rawGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "GET" },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test('GET "/" -> 302 auf /auth/login (Landing-Redirect, kein 404/Auth-Sackgasse)', async () => {
  const srv = await startServer();
  try {
    const res = await rawGet(`${srv.localUrl}/`);
    assert.equal(res.status, 302);
    assert.equal(res.location, "/auth/login");
  } finally {
    await srv.stop();
  }
});
