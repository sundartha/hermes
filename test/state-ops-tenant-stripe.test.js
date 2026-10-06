import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantStripe,
  tenantStripe,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const A = "tenant_a";

let jsonBackend;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  jsonBackend = await import("../src/store/json.js");
});

test("selektiver Patch: customerId setzen laesst paymentMethodId unberuehrt; spaeterer Patch setzt nur PM", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setTenantStripe(s, A, { customerId: "cus_1" });
  assert.deepEqual(
    tenantStripe(s, A),
    { customerId: "cus_1", paymentMethodId: null, paymentMethodType: null },
    "PM unberuehrt",
  );
  setTenantStripe(s, A, { paymentMethodId: "pm_1" });
  assert.deepEqual(
    tenantStripe(s, A),
    { customerId: "cus_1", paymentMethodId: "pm_1", paymentMethodType: null },
    "beide gesetzt",
  );
});

test("selektiver Patch: paymentMethodType setzt den Typ unabhaengig von den Referenzen", () => {
  const state = makeDefaultState();
  registerTenant(state, A);
  setTenantStripe(state, A, { customerId: "cus_1", paymentMethodId: "pm_1" });
  assert.equal(
    tenantStripe(state, A).paymentMethodType,
    null,
    "ohne Patch bleibt der Typ unbekannt",
  );
  setTenantStripe(state, A, { paymentMethodType: "card" });
  assert.deepEqual(tenantStripe(state, A), {
    customerId: "cus_1",
    paymentMethodId: "pm_1",
    paymentMethodType: "card",
  });
});

test("setTenantStripe: fehlender Tenant wirft (fail-closed, kein stilles No-Op)", () => {
  const s = makeDefaultState();
  assert.throws(() => setTenantStripe(s, "ghost", { customerId: "cus_x" }), /nicht gefunden/);
});

test("tenantStripe: Tenant ohne Referenzen -> alle drei null (Grenzfall, nie undefined)", () => {
  const s = makeDefaultState();
  assert.deepEqual(tenantStripe(s, BOOTSTRAP_TENANT_ID), {
    customerId: null,
    paymentMethodId: null,
    paymentMethodType: null,
  });
});

test("json-Roundtrip: setTenantStripe via Fassade persistiert -> tenantStripe liest beide Felder", () => {
  jsonBackend.setTenantStripe(BOOTSTRAP_TENANT_ID, {
    customerId: "cus_rt",
    paymentMethodId: "pm_rt",
    paymentMethodType: "card",
  });
  assert.deepEqual(jsonBackend.tenantStripe(BOOTSTRAP_TENANT_ID), {
    customerId: "cus_rt",
    paymentMethodId: "pm_rt",
    paymentMethodType: "card",
  });
});

test("json-Fassade exportiert setTenantStripe + tenantStripe (Re-Export-Landmine)", () => {
  assert.equal(typeof jsonBackend.setTenantStripe, "function", "json.setTenantStripe fehlt");
  assert.equal(typeof jsonBackend.tenantStripe, "function", "json.tenantStripe fehlt");
});
