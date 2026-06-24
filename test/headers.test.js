// Phase 2.5: Security-Header auf Dashboard und API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const EXPECTED = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

test("Security-Header", async (t) => {
  const srv = await startServer();
  try {
    await t.test("auf /tenant.html (Dashboard) gesetzt, CSP erlaubt Inline + Google Fonts", async () => {
      // P4: index.html aufgegeben -> tenant.html ist das einzige Dashboard. Die Security-
      // Header + CSP gelten unveraendert (securityHeaders laeuft global vor express.static).
      const res = await fetch(`${srv.localUrl}/tenant.html`);
      assert.equal(res.status, 200);
      for (const [name, value] of Object.entries(EXPECTED))
        assert.equal(res.headers.get(name), value);
      const csp = res.headers.get("content-security-policy");
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self' 'unsafe-inline'/);
      assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
      assert.match(csp, /font-src https:\/\/fonts\.gstatic\.com/);
    });

    await t.test("auf /api/state gesetzt, zusaetzlich Cache-Control: no-store", async () => {
      const res = await fetch(`${srv.localUrl}/api/state`);
      assert.equal(res.status, 200);
      for (const [name, value] of Object.entries(EXPECTED))
        assert.equal(res.headers.get(name), value);
      assert.equal(res.headers.get("cache-control"), "no-store");
    });

    await t.test("Dashboard-HTML wird ohne no-store ausgeliefert", async () => {
      const res = await fetch(`${srv.localUrl}/tenant.html`);
      assert.notEqual(res.headers.get("cache-control"), "no-store");
    });
  } finally {
    await srv.stop();
  }
});
