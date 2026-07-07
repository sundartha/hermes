// Unit-Test fuer den extrahierten Fixed-Window-Zaehler (PLAN-TELNYX-AI-ASSISTANT.md, P5,
// G5-Extraktion aus middleware.js createRateLimiter). Pinnt den Kern isoliert (kein Express/
// HTTP): Limit-Grenze (N erlaubt, N+1 abgelehnt), Window-Reset nach Ablauf, Schluessel-
// Isolation (zwei Keys teilen sich das Fenster NICHT). F.I.R.S.T.: keine echte Uhr/Zeitgeber
// im Test - windowMs klein genug, dass ein kurzer setTimeout genuegt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFixedWindowCounter } from "../src/middleware.js";

test("Limit-Grenze: N Treffer erlaubt, N+1-ter abgelehnt (retryAfterS > 0)", () => {
  const hit = makeFixedWindowCounter({ windowMs: 60_000, limit: 2, sweepMs: 300_000 });
  assert.equal(hit("k").allowed, true, "1. Treffer erlaubt");
  assert.equal(hit("k").allowed, true, "2. Treffer erlaubt (== Limit)");
  const third = hit("k");
  assert.equal(third.allowed, false, "3. Treffer (N+1) abgelehnt");
  assert.ok(third.retryAfterS > 0, "retryAfterS ist positiv");
});

test("Schluessel-Isolation: zwei Keys teilen sich das Fenster nicht", () => {
  const hit = makeFixedWindowCounter({ windowMs: 60_000, limit: 1, sweepMs: 300_000 });
  assert.equal(hit("a").allowed, true);
  assert.equal(hit("a").allowed, false, "a am Limit");
  assert.equal(hit("b").allowed, true, "b hat einen eigenen Zaehler");
});

test("Window-Reset: nach Ablauf des Fensters startet der Zaehler neu", async () => {
  const hit = makeFixedWindowCounter({ windowMs: 20, limit: 1, sweepMs: 300_000 });
  assert.equal(hit("k").allowed, true);
  assert.equal(hit("k").allowed, false, "innerhalb des Fensters geblockt");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(hit("k").allowed, true, "nach Fenster-Ablauf wieder erlaubt");
});
