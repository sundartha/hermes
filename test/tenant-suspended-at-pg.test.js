import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const TENANT = "user_susp_c";
const UNTOUCHED = "user_susp_c_untouched";
const ISO = "2026-03-03T12:00:00.000Z";

test("pg: suspended_at ueberlebt hydrate->flush->hydrate (Round-Trip)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Max" });
  ops.setSuspendedAtIfAbsent(s, TENANT, ISO);
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(store2.tenantSuspendedAt(TENANT), ISO, "persistiert (flushTenants + rowToTenant)");
});

test("pg: Tenant ohne Anker -> NULL, tenantSuspendedAt() -> null (kein Backfill)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, UNTOUCHED, { firstName: "Alt" });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(store2.tenantSuspendedAt(UNTOUCHED), null, "additiv nullable, fail-closed Default");
});
