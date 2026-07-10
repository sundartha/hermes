// I4: resolveTenant-Seam (idpSubject -> tenantId, fail-closed). Rein-Unit am
// state-ops-Seam (reine Funktion, kein DATA_DIR/Singleton) PLUS Fassaden-Parity
// ueber BEIDE Backends (json.js synchron, pg.js via pglite) - faengt die
// Re-Export-Landmine, ohne pglite mit Server-Spawn zu mischen.
//
// Kern-Gate ist die FAIL-CLOSED-ASYMMETRIE zu resolveProfile: leere/null/unbekannte
// Identitaet -> null, NIE BOOTSTRAP_TENANT_ID. resolveProfile faellt bei !email bewusst
// auf Owner zurueck (Rechte konservativ); resolveTenant DARF das nicht erben, sonst
// waere der Tenant-Scope (I5/I6/I7) still umgehbar.
//
// DATA_DIR wird im before VOR dem ersten config-/store-Import auf ein Temp-
// Verzeichnis gesetzt, damit json.js das echte data/store.json nie anfasst.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { resolveTenant, bindSubToTenant } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// Konstanten statt Magic-Strings (G25).
const TENANT_B = "B";
const SUB_B = "sub-b";
const UNKNOWN_SUB = "sub-unbekannt";
const MERGED_SUB = "sub-merged"; // tenant-prolif-b: per Email-Merge an TENANT_B gebundener Zweit-sub

let jsonBackend;
let makePgTestStore;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  jsonBackend = await import("../src/store/json.js");
  ({ makePgTestStore } = await import("./pg-helpers.js"));
});

// Seedet einen aktiven Tenant B mit idpSubject DIREKT in s.tenants.
const seedWithTenantB = () =>
  seedState({
    calls: [seedCall({ id: "c1" })],
    tenants: [{ id: TENANT_B, status: "active", idpSubject: SUB_B }],
  });

// --- KERN-GATE: Fail-closed-Asymmetrie (beide Asserts explizit) ---
test("resolveTenant: null/leerer idpSubject -> null, NIEMALS Owner", () => {
  const s = seedWithTenantB();
  for (const bad of [null, "", undefined]) {
    assert.equal(resolveTenant(s, bad), null);
    assert.notEqual(resolveTenant(s, bad), BOOTSTRAP_TENANT_ID); // beweist die Asymmetrie zu resolveProfileFrom(!email)->OWNER
  }
});

test("resolveTenant: unbekannter sub -> null, NIEMALS Owner", () => {
  const s = seedWithTenantB();
  assert.equal(resolveTenant(s, UNKNOWN_SUB), null);
  assert.notEqual(resolveTenant(s, UNKNOWN_SUB), BOOTSTRAP_TENANT_ID);
});

test("resolveTenant: ohne s.tenants -> null (defensiver Guard)", () => {
  assert.equal(resolveTenant(seedState({}), SUB_B), null); // seedState seedet keine tenants
});

// --- Positiv + 1:1 (#2) ---
test("resolveTenant: bekannter idpSubject -> dessen tenantId", () => {
  assert.equal(resolveTenant(seedWithTenantB(), SUB_B), TENANT_B);
});

test("resolveTenant: 1:1 -> genau ein Treffer (Einzelwert, keine Liste)", () => {
  const id = resolveTenant(seedWithTenantB(), SUB_B);
  assert.equal(typeof id, "string"); // Einzelwert, kein Array (#2)
});

// --- tenant-prolif-b: subIndex-Vorrang + defensiver bindSubToTenant ---
test("resolveTenant: subIndex hat Vorrang (Merge-Overlay ueberlagert idpSubject-Fallback)", () => {
  const s = seedWithTenantB();
  bindSubToTenant(s, MERGED_SUB, TENANT_B); // Zweit-sub via Index auf TENANT_B gebunden
  assert.equal(resolveTenant(s, MERGED_SUB), TENANT_B, "nur ueber den Index aufloesbar");
  assert.equal(resolveTenant(s, SUB_B), TENANT_B, "Fallback (idpSubject) bleibt unveraendert");
});

test("bindSubToTenant: leerer sub/tenantId -> No-Op (fail-closed, kein Muell-Key)", () => {
  const s = seedState({});
  bindSubToTenant(s, "", "t");
  bindSubToTenant(s, "s", "");
  assert.equal(resolveTenant(s, ""), null);
  assert.equal(resolveTenant(s, "s"), null);
});

// --- Re-Export-Parity (R6): zahlfrei, jeder erwartete Name typeof function ---
test("Fassade json.js exportiert resolveTenant", () => {
  assert.equal(
    typeof jsonBackend.resolveTenant,
    "function",
    "json.resolveTenant fehlt (Re-Export-Landmine)",
  );
});

test("Fassade pg.js (pglite) exportiert resolveTenant", async () => {
  const { store } = await makePgTestStore();
  assert.equal(
    typeof store.resolveTenant,
    "function",
    "pg.resolveTenant fehlt (Re-Export-Landmine)",
  );
});
