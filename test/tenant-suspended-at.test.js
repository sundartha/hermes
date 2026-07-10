// tenant-prolif-c: suspended_at Grace-Anker (reine state-ops-Logik, offline, zeit-injiziert).
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  setSuspendedAtIfAbsent,
  clearSuspendedAt,
  tenantSuspendedAt,
} from "../src/store/state-ops.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-02-02T00:00:00.000Z";

test("setSuspendedAtIfAbsent: erster Aufruf stempelt, zweiter (anderer Wert) laesst unveraendert", () => {
  const s = makeDefaultState();
  registerTenant(s, "t1", { firstName: "A" });
  const r1 = setSuspendedAtIfAbsent(s, "t1", T1);
  assert.equal(r1.changed, true);
  assert.equal(tenantSuspendedAt(s, "t1"), T1);
  const r2 = setSuspendedAtIfAbsent(s, "t1", T2); // Dunning-Retry
  assert.equal(r2.changed, false, "set-if-absent: kein Ueberschreiben");
  assert.equal(tenantSuspendedAt(s, "t1"), T1, "Stempel bewegt sich NICHT");
});

test("clearSuspendedAt: nach Clear ist der Anker leer; zweiter Clear ist No-Op", () => {
  const s = makeDefaultState();
  registerTenant(s, "t1", { firstName: "A" });
  setSuspendedAtIfAbsent(s, "t1", T1);
  const c1 = clearSuspendedAt(s, "t1");
  assert.equal(c1.changed, true);
  assert.equal(tenantSuspendedAt(s, "t1"), null);
  assert.equal(clearSuspendedAt(s, "t1").changed, false, "idempotent");
});

test("fehlender Tenant: set/clear No-Op (kein throw), Getter -> null", () => {
  const s = makeDefaultState();
  assert.equal(setSuspendedAtIfAbsent(s, "nope", T1).changed, false);
  assert.equal(clearSuspendedAt(s, "nope").changed, false);
  assert.equal(tenantSuspendedAt(s, "nope"), null);
});
