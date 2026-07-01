// numberStatusFor (AM5): reiner View-Helfer fuer den Dashboard-Chip-Status. Kein
// Netz, kein Server, kein pglite (eigene Datei) - nur State-Ops + die reine View.
// Prueft die Praesentations-Abbildung (requested/provisioning/capturing/active/none)
// UND die Fail-closed-Tenant-Isolation (fremde Nummer -> "none", kein Leck).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  beginProvisioning,
  beginCapturing,
  activateNumber,
} from "../src/store/state-ops.js";
import { numberStatusFor, activeNumberFor } from "../src/store/views.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const TENANT = "t_user1";

// Seedet einen aktiven Tenant mit genau einer 'requested' Nummer.
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
  // Ein anderer Tenant ohne eigene Nummer sieht NICHT die fremde aktive Nummer.
  assert.equal(numberStatusFor(s, "t_stranger"), "none");
  assert.equal(activeNumberFor(s, "t_stranger"), "");
});

test("numberStatusFor: globaler Cap-Skip -> 'blocked' (Fix B)", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const caps = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  requestNumber(s, { tenantId: "a", ...caps });
  requestNumber(s, { tenantId: "b", ...caps }); // blockiert -> Skip-Marker gesetzt
  assert.equal(numberStatusFor(s, "b"), "blocked");
});

test("numberStatusFor: eine spaeter aktive Nummer ueberlagert den Skip-Marker (Invariante 3)", () => {
  const s = makeDefaultState();
  registerTenant(s, "a");
  registerTenant(s, "b");
  const tight = { maxNumbers: 1, maxNumbersPerTenant: 1 };
  requestNumber(s, { tenantId: "a", ...tight });
  requestNumber(s, { tenantId: "b", ...tight }); // blockiert -> Skip-Marker gesetzt
  assert.equal(numberStatusFor(s, "b"), "blocked");
  // Cap oeffnet sich (Release der fremden Nummer), b bekommt seine eigene Nummer -> die
  // reale Nummer schlaegt IMMER den Skip-Marker (Prioritaet ACTIVE > ... > BLOCKED).
  const { number } = requestNumber(s, { tenantId: "b", maxNumbers: 5, maxNumbersPerTenant: 1 });
  beginProvisioning(s, number.id);
  activateNumber(s, number.id, { e164: "+4915799990003", providerNumberId: "num_b" });
  assert.equal(numberStatusFor(s, "b"), "active");
});
