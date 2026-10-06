import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { resolveTenant, bindSubToTenant } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TENANT_B = "B";
const SUB_B = "sub-b";
const UNKNOWN_SUB = "sub-unbekannt";
const MERGED_SUB = "sub-merged";

let jsonBackend;
let makePgTestStore;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  jsonBackend = await import("../src/store/json.js");
  ({ makePgTestStore } = await import("./pg-helpers.js"));
});

const seedWithTenantB = () =>
  seedState({
    calls: [seedCall({ id: "c1" })],
    tenants: [{ id: TENANT_B, status: "active", idpSubject: SUB_B }],
  });

test("resolveTenant: null/leerer idpSubject -> null, NIEMALS Owner", () => {
  const s = seedWithTenantB();
  for (const bad of [null, "", undefined]) {
    assert.equal(resolveTenant(s, bad), null);
    assert.notEqual(resolveTenant(s, bad), BOOTSTRAP_TENANT_ID);
  }
});

test("resolveTenant: unbekannter sub -> null, NIEMALS Owner", () => {
  const s = seedWithTenantB();
  assert.equal(resolveTenant(s, UNKNOWN_SUB), null);
  assert.notEqual(resolveTenant(s, UNKNOWN_SUB), BOOTSTRAP_TENANT_ID);
});

test("resolveTenant: ohne s.tenants -> null (defensiver Guard)", () => {
  assert.equal(resolveTenant(seedState({}), SUB_B), null);
});

test("resolveTenant: bekannter idpSubject -> dessen tenantId", () => {
  assert.equal(resolveTenant(seedWithTenantB(), SUB_B), TENANT_B);
});

test("resolveTenant: 1:1 -> genau ein Treffer (Einzelwert, keine Liste)", () => {
  const id = resolveTenant(seedWithTenantB(), SUB_B);
  assert.equal(typeof id, "string");
});

test("resolveTenant: subIndex hat Vorrang (Merge-Overlay ueberlagert idpSubject-Fallback)", () => {
  const s = seedWithTenantB();
  bindSubToTenant(s, MERGED_SUB, TENANT_B);
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
