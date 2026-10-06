import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import { applySchema } from "../src/db/migrate.js";
import * as ops from "../src/store/state-ops.js";

const TENANT = "user_312k_cancel";
const UNTOUCHED = "user_312k_cancel_untouched";

test("312k-P1 pg: cancelAtPeriodEnd ueberlebt hydrate->flush->hydrate (Round-Trip)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Max" });
  ops.setTenantSubscription(s, TENANT, {
    subscriptionId: "sub_312k_pg",
    planSlug: "starter",
    currentPeriodEnd: 1_900_000_000,
    cancelAtPeriodEnd: true,
  });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(
    store2.tenantSubscription(TENANT).cancelAtPeriodEnd,
    true,
    "cancelAtPeriodEnd persistiert (flushTenants + rowToTenant)",
  );
  assert.equal(store2.tenantSubscription(TENANT).currentPeriodEnd, 1_900_000_000, "Periodenende bleibt daneben erhalten");
});

test("312k-P1 pg: Ruecknahme (cancelAtPeriodEnd:false) ueberlebt ebenfalls den Round-Trip", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Max" });
  ops.setTenantSubscription(s, TENANT, { subscriptionId: "sub_312k_pg2", cancelAtPeriodEnd: true });
  await store.save();
  ops.setTenantSubscription(store.load(), TENANT, { cancelAtPeriodEnd: false });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(store2.tenantSubscription(TENANT).cancelAtPeriodEnd, false, "die Ruecknahme persistiert (Vermerk ist weg)");
});

test("312k-P1 pg: Tenant ohne gesetztes Flag -> NULL in der DB, tenantSubscription() faellt fail-closed auf false", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, UNTOUCHED, { firstName: "Alt" });
  ops.setTenantSubscription(s, UNTOUCHED, { subscriptionId: "sub_untouched" });
  await store.save();

  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(
    store2.tenantSubscription(UNTOUCHED).cancelAtPeriodEnd,
    false,
    "kein Backfill/Migration fuer dieses additive Feld -> fail-closed Default",
  );
});

test("312k-P1 Migration: doppelter applySchema bleibt fehlerfrei, stripe_cancel_at_period_end existiert danach (Idempotenz)", async () => {
  const db = new PGlite();
  const conn = { query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) };
  await applySchema(conn);
  await applySchema(conn);
  const col = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tenant' AND column_name = 'stripe_cancel_at_period_end'`,
  );
  assert.equal(col.rows.length, 1, "Spalte existiert nach doppeltem Schema-Lauf genau einmal");
});
