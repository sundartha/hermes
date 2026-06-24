// Pay1: Stripe-Customer/Karte pro Tenant (state-ops-Unit + json-Fassaden-Roundtrip).
// Prueft die INVARIANTEN rein ueber ops.setTenantStripe/tenantStripe (kein Netz, kein
// Server, kein pglite; Lehre P6a: state-ops-Unit NICHT mit Spawn/pglite mischen) PLUS
// einen Fassaden-Roundtrip ueber json.js (set -> save -> tenantStripe liest persistiert).
//
// DATA_DIR wird im before VOR dem ersten config-/json-Import auf ein Temp-Verzeichnis
// gesetzt (Repo-Regel: data/store.json nie anfassen) - json.js wird deshalb dynamisch
// geladen; state-ops/defaults/helpers sind config-frei und statisch importierbar.
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
    { customerId: "cus_1", paymentMethodId: null },
    "PM unberuehrt",
  );
  setTenantStripe(s, A, { paymentMethodId: "pm_1" });
  assert.deepEqual(
    tenantStripe(s, A),
    { customerId: "cus_1", paymentMethodId: "pm_1" },
    "beide gesetzt",
  );
});

test("setTenantStripe: fehlender Tenant wirft (fail-closed, kein stilles No-Op)", () => {
  const s = makeDefaultState();
  assert.throws(() => setTenantStripe(s, "ghost", { customerId: "cus_x" }), /nicht gefunden/);
});

test("tenantStripe: Tenant ohne Referenzen -> beide null (Grenzfall, nie undefined)", () => {
  const s = makeDefaultState();
  assert.deepEqual(tenantStripe(s, BOOTSTRAP_TENANT_ID), { customerId: null, paymentMethodId: null });
});

test("json-Roundtrip: setTenantStripe via Fassade persistiert -> tenantStripe liest beide Felder", () => {
  // Owner existiert in makeDefaultState (load() seedet ihn) -> kein registerTenant noetig.
  jsonBackend.setTenantStripe(BOOTSTRAP_TENANT_ID, { customerId: "cus_rt", paymentMethodId: "pm_rt" });
  assert.deepEqual(jsonBackend.tenantStripe(BOOTSTRAP_TENANT_ID), {
    customerId: "cus_rt",
    paymentMethodId: "pm_rt",
  });
});

test("json-Fassade exportiert setTenantStripe + tenantStripe (Re-Export-Landmine)", () => {
  assert.equal(typeof jsonBackend.setTenantStripe, "function", "json.setTenantStripe fehlt");
  assert.equal(typeof jsonBackend.tenantStripe, "function", "json.tenantStripe fehlt");
});
