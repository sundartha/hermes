// B1a (pg): persistierter Periodenanker currentPeriodStart durch alle pg-Schichten.
//  1) Round-Trip hydrate->flush->hydrate: ein gesetzter Start ueberlebt save()->reload.
//  2) Migrations-Backfill (Boot-Pfad): ein Bestands-Tenant mit currentPeriodEnd aber
//     NULL-Start bekommt den Anker beim naechsten init() (migrate->backfillPeriodStart
//     laeuft VOR hydrate) aus dem Ende abgeleitet; ein zweites init() ist idempotent.
// pglite = kein Netz, keine externe DB (F.I.R.S.T.). Muster store-pg-tenant-budget.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const TENANT = "user_x";
const LEGACY = "user_legacy";
// Mitte-Monat -> kein Monatsletzten-Ueberlauf-Zweifel beim "Ende minus ein Monat".
const END_SEC = Math.floor(Date.UTC(2026, 6, 15) / 1000); // 2026-07-15
const START_SEC = Math.floor(Date.UTC(2026, 5, 15) / 1000); // 2026-06-15 (Backfill-Erwartung)
const EXPLICIT_START = Math.floor(Date.UTC(2026, 6, 1) / 1000); // 2026-07-01

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

  // Frischer Store auf DERSELBEN DB -> hydriert aus der DB (kein Spiegel-Reuse).
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
  // NUR das Ende setzen (wie ein Bestands-Abo vor B1a) -> Start bleibt NULL.
  ops.setTenantSubscription(s, LEGACY, { subscriptionId: "sub_old", currentPeriodEnd: END_SEC });
  await store.save();

  // init() laeuft migrate -> backfillPeriodStart VOR hydrate: der NULL-Start wird geheilt.
  const store2 = makePgStore(runner);
  await store2.init();
  assert.equal(
    store2.tenantSubscription(LEGACY).currentPeriodStart,
    START_SEC,
    "Backfill: Start = Ende minus ein Monat (UTC)",
  );

  // Zweiter Boot auf derselben DB: WHERE-Filter trifft 0 Zeilen -> kein Drift (Idempotenz).
  const store3 = makePgStore(runner);
  await store3.init();
  assert.equal(
    store3.tenantSubscription(LEGACY).currentPeriodStart,
    START_SEC,
    "zweites init() laesst den Anker unveraendert",
  );
});
