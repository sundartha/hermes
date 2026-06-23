// Render-Deploy-Fix: config-derive Owner-Nummer-Seed (state-ops, pure Unit, kein IO).
// Ohne diesen Seed braeche der Boot-Guard auf Render (fluechtiges FS, leerer Store)
// fail-closed mit exit 1 ab -> alle Deploys update_failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, seedOwnerNumberFromConfig } from "../src/store/state-ops.js";
import { OWNER_TENANT_ID, NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { findActiveNumber } from "../src/store/views.js";

test("seedet eine aktive Owner-Nummer mit Provider auf leerem Store", () => {
  const s = makeDefaultState();
  seedOwnerNumberFromConfig(s, "+491737252163", OWNER_TENANT_ID, PROVIDER.TELNYX);
  const n = findActiveNumber(s, OWNER_TENANT_ID);
  assert.ok(n, "aktive Owner-Nummer vorhanden");
  assert.equal(n.provider, PROVIDER.TELNYX);
  assert.equal(n.status, NUMBER_STATUS.ACTIVE);
});

test("ist idempotent (zweiter Lauf, gleiche e164)", () => {
  const s = makeDefaultState();
  seedOwnerNumberFromConfig(s, "+491737252163", OWNER_TENANT_ID, PROVIDER.TELNYX);
  seedOwnerNumberFromConfig(s, "+491737252163", OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.filter((x) => x.tenantId === OWNER_TENANT_ID).length, 1);
});

test("ungueltiger Provider -> kein Seed (fail-closed)", () => {
  const s = makeDefaultState();
  seedOwnerNumberFromConfig(s, "+491737252163", OWNER_TENANT_ID, "garbage");
  assert.ok(!findActiveNumber(s, OWNER_TENANT_ID));
});

test("leere e164 -> kein Seed", () => {
  const s = makeDefaultState();
  seedOwnerNumberFromConfig(s, "", OWNER_TENANT_ID, PROVIDER.TELNYX);
  assert.ok(!findActiveNumber(s, OWNER_TENANT_ID));
});
