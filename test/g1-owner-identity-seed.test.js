// G1: applyOwnerIdentity (Komposition) + seedOwnerIdentity (Variante a, idempotent).
// Reine state-ops-Units (kein IO, kein config/DATA_DIR) - statisch importierbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerTenant,
  seedOwnerIdentity,
  tenantContext,
  makeDefaultState,
} from "../src/store/state-ops.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";

test("registerTenant komponiert ownerName aus firstName + mehrteiligem lastName", () => {
  const s = makeDefaultState();
  const t = registerTenant(s, "t_a", {
    firstName: "Antonio",
    lastName: "Fotiadis dos Santos Francisco",
  });
  assert.equal(t.firstName, "Antonio");
  assert.equal(t.ownerName, "Antonio Fotiadis dos Santos Francisco");
});

test("seedOwnerIdentity setzt firstName + ownerName auf einem leeren Owner-Tenant", () => {
  const s = makeDefaultState(); // Owner-Tenant existiert, traegt KEINEN Namen
  seedOwnerIdentity(s, "Max", "Mustermann", OWNER_TENANT_ID);
  const owner = s.tenants.find((t) => t.id === OWNER_TENANT_ID);
  assert.equal(owner.firstName, "Max");
  assert.equal(owner.ownerName, "Max Mustermann");
});

test("seedOwnerIdentity ist idempotent: gesetzter ownerName gewinnt (No-Op)", () => {
  const s = makeDefaultState();
  s.tenants.find((t) => t.id === OWNER_TENANT_ID).ownerName = "Schon Da";
  seedOwnerIdentity(s, "Max", "Mustermann", OWNER_TENANT_ID);
  assert.equal(s.tenants.find((t) => t.id === OWNER_TENANT_ID).ownerName, "Schon Da");
});

test("seedOwnerIdentity ohne Owner-Tenant ist ein No-Op (seedState-Shape)", () => {
  const s = { tenants: [] };
  seedOwnerIdentity(s, "Max", "Mustermann", OWNER_TENANT_ID);
  assert.equal(s.tenants.length, 0);
});

test("tenantContext leitet firstName aus dem geseedeten ownerName ab (eine Quelle)", () => {
  const s = makeDefaultState();
  seedOwnerIdentity(s, "Max", "Mustermann", OWNER_TENANT_ID);
  const ctx = tenantContext(s, "Fallback Name", OWNER_TENANT_ID);
  assert.equal(ctx.ownerName, "Max Mustermann");
  assert.equal(ctx.firstName, "Max");
});
