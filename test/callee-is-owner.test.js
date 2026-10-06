import { test } from "node:test";
import assert from "node:assert/strict";
import { calleeIsOwner, ownerSelfCallGranted } from "../src/callee-is-owner.js";
import { createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { seedState } from "./helpers.js";

const OWN = "+491737252163";
const FOREIGN = "+491729999001";
const TENANT = BOOTSTRAP_TENANT_ID;
const OTHER = "t_fremd";

test("OC-P1-01: to === ownNumber, identische E.164 -> true", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: OWN }), true);
});

test("OC-P1-02: ownNumber null -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: null }), false);
});

test("OC-P1-03: ownNumber undefined -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: undefined }), false);
});

test("OC-P1-04: ownNumber leerer String -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: "" }), false);
});

test("OC-P1-05: to fehlt (null/undefined/leer), ownNumber gesetzt -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: null, ownNumber: OWN }), false);
  assert.strictEqual(calleeIsOwner({ to: undefined, ownNumber: OWN }), false);
  assert.strictEqual(calleeIsOwner({ to: "", ownNumber: OWN }), false);
});

test("OC-P1-06: beide fehlen (null) -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: null, ownNumber: null }), false);
});

test("OC-P1-07: gleiche Ziffern ohne '+' -> false (kein Praefix-Match)", () => {
  assert.strictEqual(calleeIsOwner({ to: "491737252163", ownNumber: OWN }), false);
});

test("OC-P1-08: nationale Schreibweise gegen E.164 -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: "01737252163", ownNumber: OWN }), false);
});

test("OC-P1-09: gleiche letzten acht Ziffern, anderer Laendercode -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: "+441737252163", ownNumber: OWN }), false);
});

test("OC-P1-10: ein Zeichen Unterschied -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: "+491737252164", ownNumber: OWN }), false);
});

test("OC-P1-11: Leerzeichen am Rand -> false (kein Trim im Praedikat)", () => {
  assert.strictEqual(calleeIsOwner({ to: ` ${OWN}`, ownNumber: OWN }), false);
  assert.strictEqual(calleeIsOwner({ to: `${OWN} `, ownNumber: OWN }), false);
});

test("OC-P1-12: to ist kein String (Zahl/Objekt) -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: 491737252163, ownNumber: OWN }), false);
  assert.strictEqual(calleeIsOwner({ to: {}, ownNumber: OWN }), false);
});

test("OC-P1-13: ownNumber ist kein String (Zahl) -> false", () => {
  assert.strictEqual(calleeIsOwner({ to: OWN, ownNumber: 491737252163 }), false);
});

test("OC-P1-20: enabled true, Tenant in Liste, Ziel eigene Nummer -> true (strikt Boolean)", () => {
  const result = ownerSelfCallGranted({
    to: OWN,
    ownNumber: OWN,
    tenantId: TENANT,
    enabled: true,
    allowedTenantIds: [TENANT],
  });
  assert.strictEqual(result, true);
});

test("OC-P1-21: enabled false, sonst wie B1 -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: false, allowedTenantIds: [TENANT] }),
    false,
  );
});

test("OC-P1-22: enabled fehlt (undefined) -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: undefined, allowedTenantIds: [TENANT] }),
    false,
  );
});

test('OC-P1-23: enabled als String "true" -> false (kein Truthiness-Vergleich)', () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: "true", allowedTenantIds: [TENANT] }),
    false,
  );
});

test("OC-P1-24: enabled als truthy Zahl 1 -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: 1, allowedTenantIds: [TENANT] }),
    false,
  );
});

test("OC-P1-25: Allowlist LEER -> false (leer heisst NIEMAND, nie JEDER)", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: true, allowedTenantIds: [] }),
    false,
  );
});

test("OC-P1-26: Allowlist ohne diesen Tenant (aber mit einem anderen) -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: true, allowedTenantIds: [OTHER] }),
    false,
  );
});

test("OC-P1-27: allowedTenantIds fehlt (undefined) -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: true, allowedTenantIds: undefined }),
    false,
  );
});

test("OC-P1-28: allowedTenantIds ist kein Array (String) -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: true, allowedTenantIds: TENANT }),
    false,
  );
});

test("OC-P1-29: allowedTenantIds null -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: TENANT, enabled: true, allowedTenantIds: null }),
    false,
  );
});

test("OC-P1-30: tenantId null -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: null, enabled: true, allowedTenantIds: [TENANT] }),
    false,
  );
});

test("OC-P1-31: tenantId leerer String -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: "", enabled: true, allowedTenantIds: [TENANT] }),
    false,
  );
});

test("OC-P1-32: tenantId undefined -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: OWN, tenantId: undefined, enabled: true, allowedTenantIds: [TENANT] }),
    false,
  );
});

test("OC-P1-33: Tenant in Liste, Ziel FREMD -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: FOREIGN, ownNumber: OWN, tenantId: TENANT, enabled: true, allowedTenantIds: [TENANT] }),
    false,
  );
});

test("OC-P1-34: Ziel leer/null -> false", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: "", ownNumber: OWN, tenantId: TENANT, enabled: true, allowedTenantIds: [TENANT] }),
    false,
  );
  assert.strictEqual(
    ownerSelfCallGranted({ to: null, ownNumber: OWN, tenantId: TENANT, enabled: true, allowedTenantIds: [TENANT] }),
    false,
  );
});

test("OC-P1-35: ownNumber im Store nicht gesetzt (null) -> false, kein Wurf", () => {
  assert.strictEqual(
    ownerSelfCallGranted({ to: OWN, ownNumber: null, tenantId: TENANT, enabled: true, allowedTenantIds: [TENANT] }),
    false,
  );
});

function calleeIsOwnerAmDatensatz({ enabled, allowedTenantIds, to }) {
  const state = seedState({ tenants: [{ id: TENANT, status: "active", privateNumber: OWN }] });
  const call = createCall(state, {
    direction: "outbound",
    from: "+4930111222333",
    to,
    tenantId: TENANT,
    calleeIsOwner: ownerSelfCallGranted({
      to,
      ownNumber: OWN,
      tenantId: TENANT,
      enabled,
      allowedTenantIds,
    }),
  });
  return call.calleeIsOwner;
}

test("OC-P1-40: Schalter AUS + Ziel ist die eigene Nummer -> false am Datensatz", () => {
  const wert = calleeIsOwnerAmDatensatz({ enabled: false, allowedTenantIds: [TENANT], to: OWN });
  assert.strictEqual(wert, false);
  assert.equal(typeof wert, "boolean", "nie undefined/null - false heisst Offenlegung");
});

test("OC-P1-41: Schalter AN + Ziel ist NICHT die eigene Nummer -> false am Datensatz", () => {
  const wert = calleeIsOwnerAmDatensatz({ enabled: true, allowedTenantIds: [TENANT], to: FOREIGN });
  assert.strictEqual(wert, false);
  assert.equal(typeof wert, "boolean");
});

test("OC-P1-42: Schalter AN + Allowlist leer + Ziel eigene Nummer -> false am Datensatz", () => {
  const wert = calleeIsOwnerAmDatensatz({ enabled: true, allowedTenantIds: [], to: OWN });
  assert.strictEqual(wert, false);
  assert.equal(typeof wert, "boolean");
});

test("OC-P1-43: Schalter AN + Tenant gepinnt + Ziel eigene Nummer -> true am Datensatz", () => {
  const wert = calleeIsOwnerAmDatensatz({ enabled: true, allowedTenantIds: [TENANT], to: OWN });
  assert.strictEqual(wert, true);
  assert.equal(typeof wert, "boolean");
});
