import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  beginProvisioning,
  beginCapturing,
  activateNumber,
  failNumber,
} from "../src/store/state-ops.js";
import { numberStatusFor, activeNumberFor } from "../src/store/views.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const TENANT = "t_user1";

function seedRequested(tenantId = TENANT) {
  const s = makeDefaultState();
  registerTenant(s, tenantId);
  const { number } = requestNumber(s, { tenantId, ...CAPS });
  return { s, numberId: number.id };
}

test("numberStatusFor: requested -> 'requested'", () => {
  const { s } = seedRequested();
  assert.equal(numberStatusFor(s, TENANT), "requested");
});

test("numberStatusFor: provisioning -> 'provisioning'", () => {
  const { s, numberId } = seedRequested();
  beginProvisioning(s, numberId);
  assert.equal(numberStatusFor(s, TENANT), "provisioning");
});

test("numberStatusFor: capturing -> 'provisioning' (Praesentation buendelt beide)", () => {
  const { s, numberId } = seedRequested();
  beginProvisioning(s, numberId);
  beginCapturing(s, numberId);
  assert.equal(numberStatusFor(s, TENANT), "provisioning");
});

test("numberStatusFor: active -> 'active' + activeNumberFor liefert die e164", () => {
  const { s, numberId } = seedRequested();
  beginProvisioning(s, numberId);
  activateNumber(s, numberId, { e164: "+4915799990001", providerNumberId: "num_ext_1" });
  assert.equal(numberStatusFor(s, TENANT), "active");
  assert.equal(activeNumberFor(s, TENANT), "+4915799990001");
});

test("numberStatusFor: kein Eintrag fuer den Tenant -> 'none'", () => {
  const s = makeDefaultState();
  registerTenant(s, TENANT);
  assert.equal(numberStatusFor(s, TENANT), "none");
});

test("numberStatusFor: fremde aktive Nummer -> 'none' (fail-closed, kein Leck)", () => {
  const { s, numberId } = seedRequested("t_owner");
  beginProvisioning(s, numberId);
  activateNumber(s, numberId, { e164: "+4915700000009", providerNumberId: "num_owner" });
  assert.equal(numberStatusFor(s, "t_stranger"), "none");
  assert.equal(activeNumberFor(s, "t_stranger"), "");
});

test("numberStatusFor: globaler Cap-Skip -> 'blocked' (Fix B)", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const caps = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  requestNumber(s, { tenantId: "a", ...caps });
  requestNumber(s, { tenantId: "b", ...caps });
  assert.equal(numberStatusFor(s, "b"), "blocked");
});

test("numberStatusFor: eine spaeter aktive Nummer ueberlagert den Skip-Marker (Invariante 3)", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const tight = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  requestNumber(s, { tenantId: "a", ...tight });
  requestNumber(s, { tenantId: "b", ...tight });
  assert.equal(numberStatusFor(s, "b"), "blocked");
  const { number } = requestNumber(s, { tenantId: "b", maxNumbers: 5, maxNumbersPerTenant: 1 });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164: "+4915799990003", providerNumberId: "num_b" });
  assert.equal(numberStatusFor(s, "b"), "active");
});

test("numberStatusFor: failed -> 'failed' (Fix C, statt stillem Rueckfall auf 'none')", () => {
  const { s, numberId } = seedRequested();
  beginProvisioning(s, numberId);
  failNumber(s, numberId);
  assert.equal(numberStatusFor(s, TENANT), "failed");
});

test("numberStatusFor: Retry nach 'failed' legt eine frische Nummer an, die 'failed' ueberdeckt", () => {
  const { s, numberId } = seedRequested();
  beginProvisioning(s, numberId);
  failNumber(s, numberId);
  requestNumber(s, { tenantId: TENANT, ...CAPS });
  assert.equal(numberStatusFor(s, TENANT), "requested");
});

test("numberStatusFor: 'failed' hat Vorrang vor gleichzeitigem globalem Cap-Skip (reale Nummer schlaegt den Skip-Marker)", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const { number } = requestNumber(s, { tenantId: "b", maxNumbers: 5, maxNumbersPerTenant: 1 });
  beginProvisioning(s, number.id);
  failNumber(s, number.id);
  requestNumber(s, { tenantId: "a", maxNumbers: 1, maxNumbersPerTenant: 1 });
  const retry = requestNumber(s, { tenantId: "b", maxNumbers: 1, maxNumbersPerTenant: 1 });
  assert.equal(retry.ok, false);
  assert.equal(retry.reason, "global_cap");
  assert.equal(numberStatusFor(s, "b"), "failed");
});
