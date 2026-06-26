// P5 — Landing-Redirect: "/" hat kein Index -> 302 auf den Login (Akzeptanz 5).
// Server-Spawn via startServer (json-Default genuegt: der Redirect ist unkonditional,
// VOR Basic-Auth + express.static gemountet -> greift ohne Web-Login-Infra). Getrennte
// Datei (pglite NICHT mit child-process mischen). node:http-GET ohne Redirect-Follow.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";

// Roher GET ohne Redirect-Follow (node:http folgt 3xx nicht automatisch) -> liefert
// {status, location} der ersten Antwort. Body wird verworfen (res.resume gibt 'end' frei).
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
