import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const TENANT = "user_voucher_b";
const UNTOUCHED = "user_voucher_b_untouched";

test("Fix B pg: numberSetupFeeExempt ueberlebt hydrate->flush->hydrate (Round-Trip)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Max" });
  ops.setTenantSubscription(s, TENANT, {
    subscriptionId: "sub_exempt",
    planSlug: "starter",
    numberSetupFeeExempt: true,
  });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(
    store2.tenantSubscription(TENANT).numberSetupFeeExempt,
    true,
    "numberSetupFeeExempt persistiert (flushTenants + rowToTenant)",
  );
});

test("Fix B pg: Tenant ohne gesetztes Flag -> NULL in der DB, tenantSubscription() faellt fail-closed auf false", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, UNTOUCHED, { firstName: "Alt" });
  ops.setTenantSubscription(s, UNTOUCHED, { subscriptionId: "sub_untouched" });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(
    store2.tenantSubscription(UNTOUCHED).numberSetupFeeExempt,
    false,
    "kein Backfill/Migration fuer dieses additive Feld -> fail-closed Default",
  );
});
