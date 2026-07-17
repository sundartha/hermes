// P7 (Cluster 4, G5): isSelfServiceLive(cfg) in src/config.js ersetzt die vormals
// vierfach wortgleiche zusammengesetzte Bedingung (config.selfServiceEnabled &&
// config.multiTenant) in config.js/wiring/auth-gate.js/wiring/web-login.js. Reine
// Praedikatfunktion, alle 4 Bool-Kombis - nur "scharf" (true), wenn BEIDE Flags an sind
// (Schnittmenge, kein OR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSelfServiceLive } from "../src/config.js";

test("isSelfServiceLive: beide Flags an -> true", () => {
  assert.equal(isSelfServiceLive({ selfServiceEnabled: true, multiTenant: true }), true);
});

test("isSelfServiceLive: nur selfServiceEnabled an -> false", () => {
  assert.equal(isSelfServiceLive({ selfServiceEnabled: true, multiTenant: false }), false);
});

test("isSelfServiceLive: nur multiTenant an -> false", () => {
  assert.equal(isSelfServiceLive({ selfServiceEnabled: false, multiTenant: true }), false);
});

test("isSelfServiceLive: beide Flags aus -> false", () => {
  assert.equal(isSelfServiceLive({ selfServiceEnabled: false, multiTenant: false }), false);
});

test("isSelfServiceLive: liefert immer einen echten Boolean (kein truthy-Objekt-Leak)", () => {
  assert.strictEqual(isSelfServiceLive({ selfServiceEnabled: true, multiTenant: true }), true);
  assert.strictEqual(isSelfServiceLive({ selfServiceEnabled: false, multiTenant: false }), false);
});
