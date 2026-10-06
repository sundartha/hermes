import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const EXPECTED = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

const direktive = (csp, name) =>
  csp
    .split(";")
    .map((teil) => teil.trim())
    .find((teil) => teil === name || teil.startsWith(`${name} `)) ?? null;
const HSTS_MIN_MAX_AGE_SECONDS = 15552000;

test("Security-Header", async (t) => {
  const srv = await startServer();
  try {
    await t.test("auf einer Nicht-API-Route gesetzt, CSP mit striktem script-src + HSTS", async () => {
      const res = await fetch(`${srv.localUrl}/healthz`);
      assert.equal(res.status, 200);
      for (const [name, value] of Object.entries(EXPECTED))
        assert.equal(res.headers.get(name), value);
      const csp = res.headers.get("content-security-policy");
      assert.match(csp, /default-src 'self'/);
      assert.equal(direktive(csp, "script-src"), "script-src 'self'");
      assert.equal(
        direktive(csp, "style-src"),
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      );
      assert.equal(
        direktive(csp, "font-src"),
        "font-src 'self' https://fonts.gstatic.com",
      );

      const hsts = res.headers.get("strict-transport-security");
      assert.ok(hsts, "Strict-Transport-Security fehlt");
      assert.ok(Number(/max-age=(\d+)/.exec(hsts)?.[1]) >= HSTS_MIN_MAX_AGE_SECONDS);
      assert.match(hsts, /includeSubDomains/i);
    });

    await t.test("auf /api/state gesetzt, zusaetzlich Cache-Control: no-store", async () => {
      const res = await fetch(`${srv.localUrl}/api/state`);
      assert.equal(res.status, 200);
      for (const [name, value] of Object.entries(EXPECTED))
        assert.equal(res.headers.get(name), value);
      assert.equal(res.headers.get("cache-control"), "no-store");
    });

    await t.test("eine Nicht-API-Route wird ohne no-store ausgeliefert", async () => {
      const res = await fetch(`${srv.localUrl}/healthz`);
      assert.notEqual(res.headers.get("cache-control"), "no-store");
    });
  } finally {
    await srv.stop();
  }
});
