// I0: tenantContext-Seam als reines IO-freies Domaenen-Objekt (byte-identisch,
// kein Konsument). Prueft die Owner-Fallback-Invariante am state-ops-Seam (reine
// Funktion, kein DATA_DIR/Singleton) PLUS einen Fassaden-Parity-Beleg ueber BEIDE
// Backends (json.js synchron, pg.js via pglite) - faengt die Re-Export-Landmine
// an allen vier Stellen, ohne pglite mit Server-Spawn zu mischen (rein-Unit).
//
// DATA_DIR wird im before VOR dem ersten config-/store-Import auf ein Temp-
// Verzeichnis gesetzt, damit json.js das echte data/store.json nie anfasst
// (Repo-Regel). Alles, was config.js zieht (config, json.js, pg-helpers), wird
// deshalb dynamisch geladen - statisch importiert sind nur config-freie Module
// (state-ops, defaults, helpers).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { tenantContext, makeDefaultState } from "../src/store/state-ops.js";
import { OWNER_TENANT_ID } from "../src/store/defaults.js";

const OTHER_OWNER = "Mara";

let config;
let jsonBackend;
let makePgTestStore;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  config = (await import("../src/config.js")).config;
  jsonBackend = await import("../src/store/json.js");
  ({ makePgTestStore } = await import("./pg-helpers.js"));
});

test("tenantContext liefert byte-identisch die heutigen Singletons (Owner)", () => {
  const s = makeDefaultState();
  const ctx = tenantContext(s, config.ownerName, OWNER_TENANT_ID);
  assert.equal(ctx.tenantId, OWNER_TENANT_ID);
  // Relativ zu config.ownerName statt gegen ein Literal -> haelt unabhaengig von .env.
  assert.equal(ctx.ownerName, config.ownerName);
  assert.equal(ctx.settings, s.settings, "settings ist die Singleton-Referenz");
  assert.equal(ctx.calendar, s.calendar, "calendar ist die Singleton-Referenz");
});

test("Owner-Fallback greift auch ohne s.tenants (seedState-Shape)", () => {
  // seedState() seedet KEINE tenants -> der Fallback muss defensiv gegen das
  // fehlende Feld sein, sonst wirft die find()-Suche.
  const s = seedState({ calls: [seedCall({ id: "call1" })] });
  const ctx = tenantContext(s, config.ownerName, OWNER_TENANT_ID);
  assert.equal(ctx.ownerName, config.ownerName);
});

test("ein eigener tenant.ownerName gewinnt vor dem durchgereichten Fallback", () => {
  const s = makeDefaultState();
  s.tenants = [{ id: OWNER_TENANT_ID, ownerName: OTHER_OWNER }];
  const ctx = tenantContext(s, config.ownerName, OWNER_TENANT_ID);
  assert.equal(ctx.ownerName, OTHER_OWNER);
});

test("Fassade json.js exportiert tenantContext und reicht config.ownerName durch", () => {
  assert.equal(typeof jsonBackend.tenantContext, "function", "json.tenantContext fehlt (Re-Export-Landmine)");
  assert.equal(jsonBackend.tenantContext(OWNER_TENANT_ID).ownerName, config.ownerName);
});

test("Fassade pg.js (pglite) exportiert tenantContext und reicht config.ownerName durch", async () => {
  const { store } = await makePgTestStore();
  assert.equal(typeof store.tenantContext, "function", "pg.tenantContext fehlt (Re-Export-Landmine)");
  assert.equal(store.tenantContext(OWNER_TENANT_ID).ownerName, config.ownerName);
});
