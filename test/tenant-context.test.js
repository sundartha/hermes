import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { tenantContext, makeDefaultState } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OTHER_OWNER = "Mara";
const PASSED_OWNER = "Test Owner";

let jsonBackend;
let makePgTestStore;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  await import("../src/config.js");
  jsonBackend = await import("../src/store/json.js");
  ({ makePgTestStore } = await import("./pg-helpers.js"));
});

test("tenantContext nutzt den durchgereichten ownerName als Owner-Fallback", () => {
  const s = makeDefaultState();
  const ctx = tenantContext(s, PASSED_OWNER, BOOTSTRAP_TENANT_ID);
  assert.equal(ctx.tenantId, BOOTSTRAP_TENANT_ID);
  assert.equal(ctx.ownerName, PASSED_OWNER);
  assert.equal(ctx.firstName, PASSED_OWNER.split(" ")[0]);
  assert.equal(ctx.settings, s.settings[BOOTSTRAP_TENANT_ID], "settings ist die Owner-Bucket-Referenz");
  assert.equal(ctx.calendar, s.calendar[BOOTSTRAP_TENANT_ID], "calendar ist die Owner-Bucket-Referenz");
});

test("Fallback greift auch ohne s.tenants (seedState-Shape)", () => {
  const s = seedState({ calls: [seedCall({ id: "call1" })] });
  const ctx = tenantContext(s, PASSED_OWNER, BOOTSTRAP_TENANT_ID);
  assert.equal(ctx.ownerName, PASSED_OWNER);
});

test("ein eigener tenant.ownerName gewinnt vor dem durchgereichten Fallback", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: BOOTSTRAP_TENANT_ID, ownerName: OTHER_OWNER }];
  const ctx = tenantContext(s, PASSED_OWNER, BOOTSTRAP_TENANT_ID);
  assert.equal(ctx.ownerName, OTHER_OWNER);
});

test("Fassade json.js exportiert tenantContext, leerer Owner-Fallback (P2b)", () => {
  assert.equal(
    typeof jsonBackend.tenantContext,
    "function",
    "json.tenantContext fehlt (Re-Export-Landmine)",
  );
  assert.equal(jsonBackend.tenantContext(BOOTSTRAP_TENANT_ID).ownerName, "");
});

test("Fassade pg.js (pglite) exportiert tenantContext, leerer Owner-Fallback (P2b)", async () => {
  const { store } = await makePgTestStore();
  assert.equal(
    typeof store.tenantContext,
    "function",
    "pg.tenantContext fehlt (Re-Export-Landmine)",
  );
  assert.equal(store.tenantContext(BOOTSTRAP_TENANT_ID).ownerName, "");
});

test("Fassade json.js exportiert seedBootstrapNumber -> Bestandsnummer routbar", () => {
  assert.equal(
    typeof jsonBackend.seedBootstrapNumber,
    "function",
    "json.seedBootstrapNumber fehlt (Re-Export-Landmine)",
  );
  const E164 = "+13125550199";
  jsonBackend.seedBootstrapNumber(E164, BOOTSTRAP_TENANT_ID, "telnyx");
  assert.equal(
    jsonBackend.findTenantByNumber(E164),
    BOOTSTRAP_TENANT_ID,
    "geseedete Owner-Nummer routet",
  );
});

test("Fassade json.js exportiert usageOf und liefert nie undefined", () => {
  assert.equal(typeof jsonBackend.usageOf, "function", "json.usageOf fehlt (Re-Export-Landmine)");
  assert.ok(jsonBackend.usageOf(BOOTSTRAP_TENANT_ID), "Owner-Bucket vorhanden");
  assert.ok(
    jsonBackend.usageOf("unbekannt-tenant"),
    "Tenant ohne Bucket -> Lazy-Default, nicht undefined",
  );
});

test("Fassade pg.js (pglite) exportiert usageOf und liefert nie undefined", async () => {
  const { store } = await makePgTestStore();
  assert.equal(typeof store.usageOf, "function", "pg.usageOf fehlt (Re-Export-Landmine)");
  assert.ok(store.usageOf(BOOTSTRAP_TENANT_ID), "Owner-Bucket vorhanden");
  assert.ok(
    store.usageOf("unbekannt-tenant"),
    "Tenant ohne Bucket -> Lazy-Default, nicht undefined",
  );
});
