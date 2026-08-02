// P7 (Cluster 4, G5): isSelfServiceLive(cfg) in src/config.js ersetzt die vormals
// vierfach wortgleiche zusammengesetzte Bedingung (config.selfServiceEnabled &&
// config.multiTenant) in config.js/wiring/web-login.js (der dritte damalige
// Konsument, das mit AUTH-P7 geloeschte Basic-Auth-Gate-Modul, ist nicht mehr Teil
// des Codes). Reine Praedikatfunktion, alle 4 Bool-Kombis - nur "scharf" (true), wenn
// BEIDE Flags an sind (Schnittmenge, kein OR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSelfServiceLive } from "../src/config.js";

test("isSelfServiceLive: beide Flags an -> true", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: true } }), true);
});

test("isSelfServiceLive: nur selfServiceEnabled an -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: false } }), false);
});

test("isSelfServiceLive: nur multiTenant an -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: true } }), false);
});

test("isSelfServiceLive: beide Flags aus -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: false } }), false);
});

test("isSelfServiceLive: liefert immer einen echten Boolean (kein truthy-Objekt-Leak)", () => {
  assert.strictEqual(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: true } }), true);
  assert.strictEqual(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: false } }), false);
});
