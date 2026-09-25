// Phase 2.5: Security-Header auf Dashboard und API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const EXPECTED = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

// SEC-P5: script-src ist strikt. Geprueft wird die DIREKTIVE, nicht die ganze CSP -
// style-src traegt weiterhin 'unsafe-inline' (nicht Teil des Auftrags), ein pauschales
// doesNotMatch(/unsafe-inline/) waere darum falsch rot.
const direktive = (csp, name) =>
  csp
    .split(";")
    .map((teil) => teil.trim())
    .find((teil) => teil === name || teil.startsWith(`${name} `)) ?? null;
// Untergrenze aus dem Auftrag (180 Tage). Eigene Konstante, damit die Zahl im Test
// nicht nackt steht und ein spaeteres Anheben des Produktionswerts nicht rot macht.
const HSTS_MIN_MAX_AGE_SECONDS = 15552000;

test("Security-Header", async (t) => {
  const srv = await startServer();
  try {
    await t.test("auf einer Nicht-API-Route gesetzt, CSP mit striktem script-src + HSTS", async () => {
      // P14: public/tenant.html ist geloescht - der Anker ist jetzt /healthz (oeffentlich,
      // 200, NICHT unter /api/). Die Security-Header + CSP gelten unveraendert
      // (securityHeaders laeuft global vor jedem Mount).
      const res = await fetch(`${srv.localUrl}/healthz`);
      assert.equal(res.status, 200);
      for (const [name, value] of Object.entries(EXPECTED))
        assert.equal(res.headers.get(name), value);
      const csp = res.headers.get("content-security-policy");
      assert.match(csp, /default-src 'self'/);
      // Gleichheit statt match: sie beweist in EINER Zusage, dass weder 'unsafe-inline'
      // noch 'unsafe-eval' in script-src steht.
      assert.equal(direktive(csp, "script-src"), "script-src 'self'");
      assert.equal(
        direktive(csp, "style-src"),
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      );
      // 'self' ist Pflicht: das Dashboard liefert seine Schriften aus /assets/fonts/ aus
      // (apps/web/src/styles/fonts.css) - ohne 'self' blockiert der Browser alle.
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
