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
