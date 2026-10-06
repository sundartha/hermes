import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const TENANT = "user_x";
const LEGACY = "user_legacy";
const END_SEC = Math.floor(Date.UTC(2026, 6, 15) / 1000);
const START_SEC = Math.floor(Date.UTC(2026, 5, 15) / 1000);
const EXPLICIT_START = Math.floor(Date.UTC(2026, 6, 1) / 1000);

test("B1a pg Test 1: currentPeriodStart ueberlebt hydrate->flush->hydrate (Round-Trip)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Max" });
  ops.setTenantSubscription(s, TENANT, {
    subscriptionId: "sub_rt",
    planSlug: "starter",
    currentPeriodEnd: END_SEC,
    currentPeriodStart: EXPLICIT_START,
  });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(
    store2.tenantSubscription(TENANT).currentPeriodStart,
    EXPLICIT_START,
    "currentPeriodStart persistiert (flushTenants + rowToTenant)",
  );
});

test("B1a pg Test 2: Migrations-Backfill leitet currentPeriodStart aus dem Ende ab (idempotent)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, LEGACY, { firstName: "Alt" });
  ops.setTenantSubscription(s, LEGACY, { subscriptionId: "sub_old", currentPeriodEnd: END_SEC });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(
    store2.tenantSubscription(LEGACY).currentPeriodStart,
    START_SEC,
    "Backfill: Start = Ende minus ein Monat (UTC)",
  );

  const store3 = makePgStore(runner);
  await store3.init();
  assert.equal(
    store3.tenantSubscription(LEGACY).currentPeriodStart,
    START_SEC,
    "zweites init() laesst den Anker unveraendert",
  );
});
