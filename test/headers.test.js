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
    await t.test("auf einer Nicht-API-Route gesetzt, CSP erlaubt Inline + Google Fonts", async () => {
      // P14: public/tenant.html ist geloescht - der Anker ist jetzt /healthz (oeffentlich,
      // 200, NICHT unter /api/). Die Security-Header + CSP gelten unveraendert
      // (securityHeaders laeuft global vor jedem Mount).
      const res = await fetch(`${srv.localUrl}/healthz`);
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

    await t.test("eine Nicht-API-Route wird ohne no-store ausgeliefert", async () => {
      const res = await fetch(`${srv.localUrl}/healthz`);
      assert.notEqual(res.headers.get("cache-control"), "no-store");
    });
  } finally {
    await srv.stop();
  }
});
