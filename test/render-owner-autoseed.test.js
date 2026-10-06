import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, seedBootstrapNumberFromConfig } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { findActiveNumber } from "../src/store/views.js";

test("seedet eine aktive Owner-Nummer mit Provider auf leerem Store", () => {
  const s = makeDefaultState();
  seedBootstrapNumberFromConfig(s, "+491737252163", BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  const n = findActiveNumber(s, BOOTSTRAP_TENANT_ID);
  assert.ok(n, "aktive Owner-Nummer vorhanden");
  assert.equal(n.provider, PROVIDER.TELNYX);
  assert.equal(n.status, NUMBER_STATUS.ACTIVE);
});

test("ist idempotent (zweiter Lauf, gleiche e164)", () => {
  const s = makeDefaultState();
  seedBootstrapNumberFromConfig(s, "+491737252163", BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  seedBootstrapNumberFromConfig(s, "+491737252163", BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  assert.equal(s.numbers.filter((x) => x.tenantId === BOOTSTRAP_TENANT_ID).length, 1);
});

test("ungueltiger Provider -> kein Seed (fail-closed)", () => {
  const s = makeDefaultState();
  seedBootstrapNumberFromConfig(s, "+491737252163", BOOTSTRAP_TENANT_ID, "garbage");
  assert.ok(!findActiveNumber(s, BOOTSTRAP_TENANT_ID));
});

test("leere e164 -> kein Seed", () => {
  const s = makeDefaultState();
  seedBootstrapNumberFromConfig(s, "", BOOTSTRAP_TENANT_ID, PROVIDER.TELNYX);
  assert.ok(!findActiveNumber(s, BOOTSTRAP_TENANT_ID));
});
