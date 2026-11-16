import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgTestStore, nutzungAuffrischenVon } from "../pg-helpers.js";

const TENANT = BOOTSTRAP_TENANT_ID;
const DECKE_CENT = 100;
const CFG = Object.freeze({
  budgetMonthEnabled: false,
  platformSpendCapCents: 100,
  platformSpendWarnPercent: 50,
});
const JULI = "2026-07-15T10:00:00.000Z";

async function speicher() {
  const { store } = await makePgTestStore();
  store.setTenantBudget(TENANT, { budgetCents: DECKE_CENT, hardCapCents: DECKE_CENT });
  return store;
}

const rest = (store) => store.tenantBudgetSnapshot(TENANT, CFG).remainingCents;

test("Reserve im PG-Pfad: was die Datenbank nicht mehr als offen fuehrt, haelt der Prozess nicht zurueck", async () => {
  const store = await speicher();
  assert.equal(store.tryReserveOutboundBudget(TENANT, 60, CFG), true);
  assert.equal(rest(store), 40);
  assert.equal(await nutzungAuffrischenVon(store.load(), TENANT), true);
  assert.equal(rest(store), DECKE_CENT);
  assert.equal(store.reservationOf(TENANT), 0);
});

test("Reserve im PG-Pfad: Reservieren und Freigeben je Cent und je Anruf", async () => {
  const store = await speicher();
  assert.equal(store.tryReserveOutboundBudget(TENANT, 30, CFG), true);
  assert.equal(store.tryReserveOutboundBudget(TENANT, 30, CFG), true);
  assert.equal(rest(store), 40);
  assert.equal(store.reservationOf(TENANT), 60);
  assert.equal(store.releaseOutboundReserveCents(TENANT, 20), true);
  assert.equal(rest(store), 60);
  assert.equal(store.releaseOutboundReserveCents(TENANT, Number.NaN), false);
  assert.equal(store.releaseOutboundReserveCents(TENANT, -5), false);
  assert.equal(rest(store), 60);
  const anruf = { tenantId: TENANT, reserveCents: 30, reserveReleased: false };
  assert.equal(store.releaseOutboundReserve(anruf), true);
  assert.equal(anruf.reserveReleased, true);
  assert.equal(rest(store), 90);
  assert.equal(store.releaseOutboundReserve(anruf), false);
  assert.equal(rest(store), 90);
  assert.equal(store.releaseOutboundReserve({ tenantId: TENANT, reserveCents: 0 }), false);
  assert.equal(store.releaseOutboundReserve(null), false);
  assert.equal(store.releaseOutboundReserveCents(TENANT, 500), true);
  assert.equal(rest(store), DECKE_CENT);
  assert.equal(store.reservationOf(TENANT), 0);
});

test("Reserve im PG-Pfad: ungueltige oder zu hohe Summe wird abgelehnt und hinterlaesst nichts", async () => {
  const store = await speicher();
  assert.equal(store.tryReserveOutboundBudget(TENANT, Number.NaN, CFG), false);
  assert.equal(store.tryReserveOutboundBudget(TENANT, DECKE_CENT + 1, CFG), false);
  assert.equal(store.tryReserveOutboundBudget(TENANT, DECKE_CENT, CFG), true);
  assert.equal(rest(store), 0);
  assert.equal(store.reservationOf(TENANT), DECKE_CENT);
});

test("Reserve im PG-Pfad: die Plattform-Warnung zaehlt die offene Reserve mit", async () => {
  const store = await speicher();
  assert.equal(store.claimPlatformSpendWarning(CFG, JULI), null);
  assert.equal(store.tryReserveOutboundBudget(TENANT, 60, CFG), true);
  assert.deepEqual(store.claimPlatformSpendWarning(CFG, JULI), { totalCents: 60, monthKey: "2026-07" });
});
