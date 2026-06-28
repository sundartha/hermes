// G1: applyOwnerIdentity (Komposition) + seedBootstrapIdentity (Variante a, idempotent).
// Reine state-ops-Units (kein IO, kein config/DATA_DIR) - statisch importierbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerTenant,
  seedBootstrapIdentity,
  setTenantIdentityIfAbsent,
  tenantContext,
  makeDefaultState,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

test("registerTenant komponiert ownerName aus firstName + mehrteiligem lastName", () => {
  const s = makeDefaultState();
  const t = registerTenant(s, "t_a", {
    firstName: "Antonio",
    lastName: "Fotiadis dos Santos Francisco",
  });
  assert.equal(t.firstName, "Antonio");
  assert.equal(t.ownerName, "Antonio Fotiadis dos Santos Francisco");
});

test("seedBootstrapIdentity setzt firstName + ownerName auf einem leeren Owner-Tenant", () => {
  const s = makeDefaultState(); // Owner-Tenant existiert, traegt KEINEN Namen
  seedBootstrapIdentity(s, "Max", "Mustermann", BOOTSTRAP_TENANT_ID);
  const owner = s.tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID);
  assert.equal(owner.firstName, "Max");
  assert.equal(owner.ownerName, "Max Mustermann");
});

test("seedBootstrapIdentity ist idempotent: gesetzter ownerName gewinnt (No-Op)", () => {
  const s = makeDefaultState();
  s.tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID).ownerName = "Schon Da";
  seedBootstrapIdentity(s, "Max", "Mustermann", BOOTSTRAP_TENANT_ID);
  assert.equal(s.tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID).ownerName, "Schon Da");
});

test("seedBootstrapIdentity ohne Owner-Tenant ist ein No-Op (seedState-Shape)", () => {
  const s = { tenants: [] };
  seedBootstrapIdentity(s, "Max", "Mustermann", BOOTSTRAP_TENANT_ID);
  assert.equal(s.tenants.length, 0);
});

test("tenantContext leitet firstName aus dem geseedeten ownerName ab (eine Quelle)", () => {
  const s = makeDefaultState();
  seedBootstrapIdentity(s, "Max", "Mustermann", BOOTSTRAP_TENANT_ID);
  const ctx = tenantContext(s, "Fallback Name", BOOTSTRAP_TENANT_ID);
  assert.equal(ctx.ownerName, "Max Mustermann");
  assert.equal(ctx.firstName, "Max");
});

// ---- P2b: setTenantIdentityIfAbsent (gemeinsame set-if-absent-Quelle, Web-Login + Boot) ----

test("T-P2b-G-01: setTenantIdentityIfAbsent setzt ownerName auf einem existierenden, namlosen Tenant -> true", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_web", {}); // active, OHNE ownerName (Web-Login-Form)
  const changed = setTenantIdentityIfAbsent(s, "t_web", { firstName: "Web", lastName: "User" });
  assert.equal(changed, true, "echte Mutation -> true (Wrapper flusht)");
  assert.equal(s.tenants.find((t) => t.id === "t_web").ownerName, "Web User");
});

test("T-P2b-G-02: set-if-absent -> vorhandener ownerName gewinnt, No-Op -> false", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_web", { firstName: "Schon", lastName: "Da" });
  const changed = setTenantIdentityIfAbsent(s, "t_web", { firstName: "Neu", lastName: "Wert" });
  assert.equal(changed, false, "gesetzter ownerName -> kein Override, kein Flush");
  assert.equal(s.tenants.find((t) => t.id === "t_web").ownerName, "Schon Da");
});

test("T-P2b-G-03: Existenz-Guard - fehlender Tenant legt KEINEN an -> false (kein Aktivieren)", () => {
  const s = { tenants: [] };
  const changed = setTenantIdentityIfAbsent(s, "t_ghost", { firstName: "Geist", lastName: "X" });
  assert.equal(changed, false);
  assert.equal(s.tenants.length, 0, "NIE einen Tenant aus dem Nichts erfinden (Invariante 5)");
});

test("T-P2b-G-04: leere Namen -> No-Op -> false (Dev-Login-/namloses-Profil-Aequivalent)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_web", {});
  const changed = setTenantIdentityIfAbsent(s, "t_web", { firstName: "", lastName: "" });
  assert.equal(changed, false, "kein komponierter ownerName -> false");
  assert.equal("ownerName" in s.tenants.find((t) => t.id === "t_web"), false);
});
