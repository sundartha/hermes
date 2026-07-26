// G1: applyOwnerIdentity (Komposition) + setTenantIdentityIfAbsent (Web-Login/Boot).
// Reine state-ops-Units (kein IO, kein config/DATA_DIR) - statisch importierbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerTenant,
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

test("tenantContext leitet firstName aus dem geseedeten ownerName ab (eine Quelle)", () => {
  const s = makeDefaultState();
  setTenantIdentityIfAbsent(s, BOOTSTRAP_TENANT_ID, { firstName: "Max", lastName: "Mustermann" });
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

// FMT-23 (tasks/i18n-tests/10-zeit-format-daten.md): firstNameOf ist modul-privat und
// wird ueber seinen einzigen Aufrufer tenantContext gemessen. Ein CJK-Name ohne
// Leerzeichen darf nicht "zerschnitten" werden - split(/\s+/)[0] liefert den ganzen
// String. Die Luecke war die ABWESENHEIT der Absicherung, kein bekannter Bug.
const CJK_FULL_NAME = "田中太郎"; // kein Whitespace -> nichts zu splitten
const CJK_SPACED_NAME = "田中 太郎"; // Gegenprobe: mit Trenner greift die Regel normal
test("FMT-23 (Mechanismus, gruen) - tenantContext leitet aus einem CJK-Namen ohne Leerzeichen den vollen String ab", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: CJK_FULL_NAME }];
  assert.equal(tenantContext(s, "", BOOTSTRAP_TENANT_ID).firstName, CJK_FULL_NAME);
  s.tenants[0].ownerName = CJK_SPACED_NAME;
  assert.equal(tenantContext(s, "", BOOTSTRAP_TENANT_ID).firstName, "田中");
});
