// Fix B (0-EUR-Checkout generisch): persistiertes numberSetupFeeExempt-Flag am Tenant.
// state-ops-Unit (selektiver Patch + Grenzfall) + json-Fassaden-Round-Trip. KEIN
// pglite/Spawn (Lehre P6a: state-ops-Unit NICHT mit Spawn mischen) - Muster
// b1a-period-anchor.test.js. DATA_DIR wird VOR dem ersten json-/config-Import auf
// Temp gesetzt (Repo-Regel: data/store.json nie anfassen) -> json.js dynamisch.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";
import {
  makeDefaultState,
  registerTenant,
  setTenantSubscription,
  tenantSubscription,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const A = "tenant_a";
const SUB = "sub_voucher_b";

let jsonBackend;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  jsonBackend = await import("../src/store/json.js");
});

test("selektiver Patch: numberSetupFeeExempt setzen; Folge-Patch (subscriptionId) laesst es unberuehrt", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setTenantSubscription(s, A, { numberSetupFeeExempt: true });
  assert.equal(tenantSubscription(s, A).numberSetupFeeExempt, true, "Flag gesetzt");
  setTenantSubscription(s, A, { subscriptionId: SUB });
  const sub = tenantSubscription(s, A);
  assert.equal(sub.subscriptionId, SUB, "subscriptionId gesetzt");
  assert.equal(sub.numberSetupFeeExempt, true, "Flag vom Folge-Patch unberuehrt");
});

test("tenantSubscription: Tenant ohne geprueften Flag -> numberSetupFeeExempt === false (nie undefined)", () => {
  const s = makeDefaultState();
  assert.equal(tenantSubscription(s, BOOTSTRAP_TENANT_ID).numberSetupFeeExempt, false);
});

test("selektiver Patch: numberSetupFeeExempt=false explizit setzbar (Grenzfall, kein truthy-Skip)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  setTenantSubscription(s, A, { numberSetupFeeExempt: true });
  setTenantSubscription(s, A, { numberSetupFeeExempt: false });
  assert.equal(tenantSubscription(s, A).numberSetupFeeExempt, false);
});

test("json-Round-Trip: setTenantSubscription via Fassade persistiert -> tenantSubscription liest numberSetupFeeExempt", () => {
  // Owner existiert in makeDefaultState (load() seedet ihn) -> kein registerTenant noetig.
  jsonBackend.setTenantSubscription(BOOTSTRAP_TENANT_ID, {
    subscriptionId: SUB,
    planSlug: "starter",
    numberSetupFeeExempt: true,
  });
  assert.equal(jsonBackend.tenantSubscription(BOOTSTRAP_TENANT_ID).numberSetupFeeExempt, true);
});
