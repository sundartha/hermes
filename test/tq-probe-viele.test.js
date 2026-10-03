import assert from "node:assert/strict";
import { test } from "node:test";

import { calleeIsOwner, ownerSelfCallGranted } from "../src/callee-is-owner.js";

test("TQ-Probe viele 01: +49301000001 ist nur für Mandant 01 die eigene Nummer", () => {
  const nummer = "+49301000001";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-01", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000001", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-01"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-01"] }), false);
});

test("TQ-Probe viele 02: +49301000002 ist nur für Mandant 02 die eigene Nummer", () => {
  const nummer = "+49301000002";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-02", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000002", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-02"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-02"] }), false);
});

test("TQ-Probe viele 03: +49301000003 ist nur für Mandant 03 die eigene Nummer", () => {
  const nummer = "+49301000003";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-03", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000003", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-03"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-03"] }), false);
});

test("TQ-Probe viele 04: +49301000004 ist nur für Mandant 04 die eigene Nummer", () => {
  const nummer = "+49301000004";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-04", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000004", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-04"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-04"] }), false);
});

test("TQ-Probe viele 05: +49301000005 ist nur für Mandant 05 die eigene Nummer", () => {
  const nummer = "+49301000005";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-05", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000005", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-05"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-05"] }), false);
});

test("TQ-Probe viele 06: +49301000006 ist nur für Mandant 06 die eigene Nummer", () => {
  const nummer = "+49301000006";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-06", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000006", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-06"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-06"] }), false);
});

test("TQ-Probe viele 07: +49301000007 ist nur für Mandant 07 die eigene Nummer", () => {
  const nummer = "+49301000007";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-07", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000007", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-07"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-07"] }), false);
});

test("TQ-Probe viele 08: +49301000008 ist nur für Mandant 08 die eigene Nummer", () => {
  const nummer = "+49301000008";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-08", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000008", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-08"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-08"] }), false);
});

test("TQ-Probe viele 09: +49301000009 ist nur für Mandant 09 die eigene Nummer", () => {
  const nummer = "+49301000009";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-09", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000009", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-09"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-09"] }), false);
});

test("TQ-Probe viele 10: +49301000010 ist nur für Mandant 10 die eigene Nummer", () => {
  const nummer = "+49301000010";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-10", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000010", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-10"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-10"] }), false);
});

test("TQ-Probe viele 11: +49301000011 ist nur für Mandant 11 die eigene Nummer", () => {
  const nummer = "+49301000011";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-11", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000011", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-11"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-11"] }), false);
});

test("TQ-Probe viele 12: +49301000012 ist nur für Mandant 12 die eigene Nummer", () => {
  const nummer = "+49301000012";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-12", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000012", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-12"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-12"] }), false);
});

test("TQ-Probe viele 13: +49301000013 ist nur für Mandant 13 die eigene Nummer", () => {
  const nummer = "+49301000013";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-13", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000013", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-13"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-13"] }), false);
});

test("TQ-Probe viele 14: +49301000014 ist nur für Mandant 14 die eigene Nummer", () => {
  const nummer = "+49301000014";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-14", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000014", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-14"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-14"] }), false);
});

test("TQ-Probe viele 15: +49301000015 ist nur für Mandant 15 die eigene Nummer", () => {
  const nummer = "+49301000015";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-15", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000015", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-15"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-15"] }), false);
});

test("TQ-Probe viele 16: +49301000016 ist nur für Mandant 16 die eigene Nummer", () => {
  const nummer = "+49301000016";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-16", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000016", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-16"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-16"] }), false);
});

test("TQ-Probe viele 17: +49301000017 ist nur für Mandant 17 die eigene Nummer", () => {
  const nummer = "+49301000017";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-17", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000017", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-17"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-17"] }), false);
});

test("TQ-Probe viele 18: +49301000018 ist nur für Mandant 18 die eigene Nummer", () => {
  const nummer = "+49301000018";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-18", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000018", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-18"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-18"] }), false);
});

test("TQ-Probe viele 19: +49301000019 ist nur für Mandant 19 die eigene Nummer", () => {
  const nummer = "+49301000019";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-19", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000019", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-19"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-19"] }), false);
});

test("TQ-Probe viele 20: +49301000020 ist nur für Mandant 20 die eigene Nummer", () => {
  const nummer = "+49301000020";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-20", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000020", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-20"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-20"] }), false);
});

test("TQ-Probe viele 21: +49301000021 ist nur für Mandant 21 die eigene Nummer", () => {
  const nummer = "+49301000021";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-21", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000021", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-21"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-21"] }), false);
});

test("TQ-Probe viele 22: +49301000022 ist nur für Mandant 22 die eigene Nummer", () => {
  const nummer = "+49301000022";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-22", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000022", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-22"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-22"] }), false);
});

test("TQ-Probe viele 23: +49301000023 ist nur für Mandant 23 die eigene Nummer", () => {
  const nummer = "+49301000023";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-23", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000023", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-23"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-23"] }), false);
});

test("TQ-Probe viele 24: +49301000024 ist nur für Mandant 24 die eigene Nummer", () => {
  const nummer = "+49301000024";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-24", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000024", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-24"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-24"] }), false);
});

test("TQ-Probe viele 25: +49301000025 ist nur für Mandant 25 die eigene Nummer", () => {
  const nummer = "+49301000025";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-25", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000025", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-25"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-25"] }), false);
});

test("TQ-Probe viele 26: +49301000026 ist nur für Mandant 26 die eigene Nummer", () => {
  const nummer = "+49301000026";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-26", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000026", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-26"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-26"] }), false);
});

test("TQ-Probe viele 27: +49301000027 ist nur für Mandant 27 die eigene Nummer", () => {
  const nummer = "+49301000027";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-27", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000027", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-27"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-27"] }), false);
});

test("TQ-Probe viele 28: +49301000028 ist nur für Mandant 28 die eigene Nummer", () => {
  const nummer = "+49301000028";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-28", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000028", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-28"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-28"] }), false);
});

test("TQ-Probe viele 29: +49301000029 ist nur für Mandant 29 die eigene Nummer", () => {
  const nummer = "+49301000029";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-29", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000029", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-29"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-29"] }), false);
});

test("TQ-Probe viele 30: +49301000030 ist nur für Mandant 30 die eigene Nummer", () => {
  const nummer = "+49301000030";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-30", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000030", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-30"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-30"] }), false);
});

test("TQ-Probe viele 31: +49301000031 ist nur für Mandant 31 die eigene Nummer", () => {
  const nummer = "+49301000031";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-31", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000031", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-31"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-31"] }), false);
});

test("TQ-Probe viele 32: +49301000032 ist nur für Mandant 32 die eigene Nummer", () => {
  const nummer = "+49301000032";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-32", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000032", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-32"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-32"] }), false);
});

test("TQ-Probe viele 33: +49301000033 ist nur für Mandant 33 die eigene Nummer", () => {
  const nummer = "+49301000033";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-33", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000033", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-33"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-33"] }), false);
});

test("TQ-Probe viele 34: +49301000034 ist nur für Mandant 34 die eigene Nummer", () => {
  const nummer = "+49301000034";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-34", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000034", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-34"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-34"] }), false);
});

test("TQ-Probe viele 35: +49301000035 ist nur für Mandant 35 die eigene Nummer", () => {
  const nummer = "+49301000035";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-35", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000035", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-35"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-35"] }), false);
});

test("TQ-Probe viele 36: +49301000036 ist nur für Mandant 36 die eigene Nummer", () => {
  const nummer = "+49301000036";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-36", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000036", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-36"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-36"] }), false);
});

test("TQ-Probe viele 37: +49301000037 ist nur für Mandant 37 die eigene Nummer", () => {
  const nummer = "+49301000037";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-37", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000037", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-37"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-37"] }), false);
});

test("TQ-Probe viele 38: +49301000038 ist nur für Mandant 38 die eigene Nummer", () => {
  const nummer = "+49301000038";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-38", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000038", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-38"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-38"] }), false);
});

test("TQ-Probe viele 39: +49301000039 ist nur für Mandant 39 die eigene Nummer", () => {
  const nummer = "+49301000039";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-39", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000039", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-39"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-39"] }), false);
});

test("TQ-Probe viele 40: +49301000040 ist nur für Mandant 40 die eigene Nummer", () => {
  const nummer = "+49301000040";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-40", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000040", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-40"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-40"] }), false);
});

test("TQ-Probe viele 41: +49301000041 ist nur für Mandant 41 die eigene Nummer", () => {
  const nummer = "+49301000041";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-41", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000041", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-41"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-41"] }), false);
});

test("TQ-Probe viele 42: +49301000042 ist nur für Mandant 42 die eigene Nummer", () => {
  const nummer = "+49301000042";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-42", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000042", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-42"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-42"] }), false);
});

test("TQ-Probe viele 43: +49301000043 ist nur für Mandant 43 die eigene Nummer", () => {
  const nummer = "+49301000043";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-43", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000043", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-43"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-43"] }), false);
});

test("TQ-Probe viele 44: +49301000044 ist nur für Mandant 44 die eigene Nummer", () => {
  const nummer = "+49301000044";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-44", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000044", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-44"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-44"] }), false);
});

test("TQ-Probe viele 45: +49301000045 ist nur für Mandant 45 die eigene Nummer", () => {
  const nummer = "+49301000045";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-45", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000045", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-45"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-45"] }), false);
});

test("TQ-Probe viele 46: +49301000046 ist nur für Mandant 46 die eigene Nummer", () => {
  const nummer = "+49301000046";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-46", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000046", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-46"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-46"] }), false);
});

test("TQ-Probe viele 47: +49301000047 ist nur für Mandant 47 die eigene Nummer", () => {
  const nummer = "+49301000047";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-47", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000047", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-47"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-47"] }), false);
});

test("TQ-Probe viele 48: +49301000048 ist nur für Mandant 48 die eigene Nummer", () => {
  const nummer = "+49301000048";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-48", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000048", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-48"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-48"] }), false);
});

test("TQ-Probe viele 49: +49301000049 ist nur für Mandant 49 die eigene Nummer", () => {
  const nummer = "+49301000049";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-49", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000049", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-49"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-49"] }), false);
});

test("TQ-Probe viele 50: +49301000050 ist nur für Mandant 50 die eigene Nummer", () => {
  const nummer = "+49301000050";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-50", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000050", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-50"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-50"] }), false);
});

test("TQ-Probe viele 51: +49301000051 ist nur für Mandant 51 die eigene Nummer", () => {
  const nummer = "+49301000051";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-51", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000051", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-51"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-51"] }), false);
});

test("TQ-Probe viele 52: +49301000052 ist nur für Mandant 52 die eigene Nummer", () => {
  const nummer = "+49301000052";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-52", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000052", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-52"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-52"] }), false);
});

test("TQ-Probe viele 53: +49301000053 ist nur für Mandant 53 die eigene Nummer", () => {
  const nummer = "+49301000053";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-53", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000053", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-53"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-53"] }), false);
});

test("TQ-Probe viele 54: +49301000054 ist nur für Mandant 54 die eigene Nummer", () => {
  const nummer = "+49301000054";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-54", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000054", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-54"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-54"] }), false);
});

test("TQ-Probe viele 55: +49301000055 ist nur für Mandant 55 die eigene Nummer", () => {
  const nummer = "+49301000055";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-55", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000055", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-55"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-55"] }), false);
});

test("TQ-Probe viele 56: +49301000056 ist nur für Mandant 56 die eigene Nummer", () => {
  const nummer = "+49301000056";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-56", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000056", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-56"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-56"] }), false);
});

test("TQ-Probe viele 57: +49301000057 ist nur für Mandant 57 die eigene Nummer", () => {
  const nummer = "+49301000057";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-57", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000057", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-57"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-57"] }), false);
});

test("TQ-Probe viele 58: +49301000058 ist nur für Mandant 58 die eigene Nummer", () => {
  const nummer = "+49301000058";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-58", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000058", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-58"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-58"] }), false);
});

test("TQ-Probe viele 59: +49301000059 ist nur für Mandant 59 die eigene Nummer", () => {
  const nummer = "+49301000059";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-59", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000059", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-59"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-59"] }), false);
});

test("TQ-Probe viele 60: +49301000060 ist nur für Mandant 60 die eigene Nummer", () => {
  const nummer = "+49301000060";
  const freigabe = { to: nummer, ownNumber: nummer, tenantId: "mandant-60", enabled: true };
  assert.equal(calleeIsOwner({ to: nummer, ownNumber: nummer }), true);
  assert.equal(calleeIsOwner({ to: "+49302000060", ownNumber: nummer }), false);
  assert.equal(calleeIsOwner({ to: "", ownNumber: nummer }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: ["mandant-60"] }), true);
  assert.equal(ownerSelfCallGranted({ ...freigabe, allowedTenantIds: [] }), false);
  assert.equal(ownerSelfCallGranted({ ...freigabe, enabled: false, allowedTenantIds: ["mandant-60"] }), false);
});
