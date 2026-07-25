// P4 GAP-04: tenantMayRequestNumber (state-ops.js) - die benannte Erlaubnis, fuer einen
// Tenant eine Nummer anzufragen, OHNE den Lebenszyklus-Status vorwegzunehmen. Rein, offline.
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  tenantMayRequestNumber,
  requestNumber,
  setTenantSubscription,
  setSuspendedAtIfAbsent,
} from "../src/store/state-ops.js";
import { TENANT_STATUS, REQUEST_NUMBER_REASON } from "../src/store/defaults.js";

const CAPS = { maxNumbers: 10, maxNumbersPerTenant: 10 };

function setStatus(s, tenantId, status) {
  const tenant = s.tenants.find((t) => t.id === tenantId);
  tenant.status = status;
}

test("aktiver Tenant (Bestandspfad) -> ok, unveraendert", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_active", {});
  assert.equal(tenantMayRequestNumber(s, "t_active"), true);
});

test("suspended + Marker gesetzt -> ok (GAP-04-Wartezustand)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_pending", {});
  setStatus(s, "t_pending", TENANT_STATUS.SUSPENDED);
  setTenantSubscription(s, "t_pending", { activationPending: true });
  assert.equal(tenantMayRequestNumber(s, "t_pending"), true);
});

test("suspended + Marker + suspendedAt gesetzt -> gesperrt (Sperre gewinnt ueber den Marker)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_locked", {});
  setStatus(s, "t_locked", TENANT_STATUS.SUSPENDED);
  setTenantSubscription(s, "t_locked", { activationPending: true });
  setSuspendedAtIfAbsent(s, "t_locked", new Date().toISOString());
  assert.equal(tenantMayRequestNumber(s, "t_locked"), false);
});

test("closed + Marker -> gesperrt (closed schliesst den Marker hart aus)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_closed", {});
  setStatus(s, "t_closed", TENANT_STATUS.CLOSED);
  setTenantSubscription(s, "t_closed", { activationPending: true });
  assert.equal(tenantMayRequestNumber(s, "t_closed"), false);
});

test("suspended OHNE Marker -> gesperrt (Bestandsverhalten unveraendert)", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_plain_suspended", {});
  setStatus(s, "t_plain_suspended", TENANT_STATUS.SUSPENDED);
  assert.equal(tenantMayRequestNumber(s, "t_plain_suspended"), false);
});

test("unbekannter Tenant -> false", () => {
  const s = makeDefaultState();
  assert.equal(tenantMayRequestNumber(s, "t_ghost"), false);
});

test("requestNumber nutzt tenantMayRequestNumber: suspended+Marker -> ok, ohne Marker -> tenant_inactive", () => {
  const s = makeDefaultState();
  registerTenant(s, "t_req_pending", {});
  setStatus(s, "t_req_pending", TENANT_STATUS.SUSPENDED);
  setTenantSubscription(s, "t_req_pending", { activationPending: true });
  const ok = requestNumber(s, { tenantId: "t_req_pending", ...CAPS });
  assert.equal(ok.ok, true);

  const s2 = makeDefaultState();
  registerTenant(s2, "t_req_plain", {});
  setStatus(s2, "t_req_plain", TENANT_STATUS.SUSPENDED);
  const denied = requestNumber(s2, { tenantId: "t_req_plain", ...CAPS });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, REQUEST_NUMBER_REASON.TENANT_INACTIVE);
});
