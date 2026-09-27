// Reviewer-Beispieldaten auf dem pg-Store (PGlite, kein Netz, kein Spawn): applyReviewerSeed
// ueber die echte pg-Fassade, Flush, frischer Store auf DERSELBEN DB -> die Zeilen kommen ueber
// den RLS-Pfad (app.current_tenant je Mandant) zurueck. Mandanten-Zeile, Abo und KYC bleiben
// unveraendert, ein zweiter Lauf legt nichts an, der Betreiber-Mandant bleibt ohne Seed-Zeilen,
// und das vordatierte endedAt (vor der Kosten-Beobachtung) ueberlebt den Flush unveraendert.
import test from "node:test";
import assert from "node:assert/strict";
import { makePgStore } from "../src/store/pg.js";
import * as ops from "../src/store/state-ops.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";
import { PROVIDER_COST_RECORD_WINDOW_MS } from "../src/billing/cost-truing.js";
import {
  REVIEWER_SEED_CALLS,
  applyReviewerSeed,
  reviewerSeedEndedAtIso,
} from "../scripts/lib/reviewer-demo-seed.mjs";

const REVIEWER_TENANT = "tenant_reviewer_pg";
const SEED_CALL_COUNT = REVIEWER_SEED_CALLS.length;
const SEED_ITEM_COUNT = REVIEWER_SEED_CALLS.flatMap((entry) => entry.actionItems).length;
const SEED_SUMMARIES = new Set(REVIEWER_SEED_CALLS.map((entry) => entry.summary));
// Herzschlag-Fenster ausgeschaltet: das Beleg-Fenster allein bestimmt den Ende-Zeitpunkt.
const HEARTBEAT_AUS_H = 0;
const ENDED_AT = reviewerSeedEndedAtIso({
  nowMs: Date.now(),
  belegFensterMs: PROVIDER_COST_RECORD_WINDOW_MS,
  heartbeatFensterH: HEARTBEAT_AUS_H,
});

const tenantRow = (store) =>
  structuredClone(store.load().tenants.find((tenant) => tenant.id === REVIEWER_TENANT));

async function seededStore() {
  const { store, runner } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, REVIEWER_TENANT, {
    firstName: "Reviewer",
    idpSubject: "reviewer-sub-pg",
  });
  ops.setKycLevel(state, REVIEWER_TENANT, "card");
  ops.setTenantSubscription(state, REVIEWER_TENANT, {
    subscriptionId: "sub_reviewer_pg",
    planSlug: "starter",
  });
  await store.save();
  return { store, runner };
}

async function reopen(runner) {
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("Reviewer-Seed pg: Zeilen ueberleben Flush + Neu-Hydrierung, Mandant unveraendert, idempotent", async () => {
  const { store, runner } = await seededStore();
  const rowBefore = tenantRow(store);

  assert.deepEqual(applyReviewerSeed(store, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: SEED_CALL_COUNT,
    itemsCreated: SEED_ITEM_COUNT,
  });
  await store.save();

  const fresh = await reopen(runner);
  const { calls, actionItems } = fresh.exportTenantData(REVIEWER_TENANT);
  assert.equal(calls.length, SEED_CALL_COUNT);
  for (const call of calls) {
    assert.equal(call.direction, "inbound");
    assert.equal(call.status, "completed");
    assert.equal(call.answeredAt ?? null, null);
    assert.equal(call.endedAt, ENDED_AT, "vordatiertes endedAt ueberlebt den Flush");
    assert.ok(SEED_SUMMARIES.has(call.summary));
  }
  assert.equal(actionItems.filter((item) => !item.done).length, SEED_ITEM_COUNT);
  assert.deepEqual(tenantRow(fresh), rowBefore, "Mandanten-Zeile inkl. Abo/KYC unveraendert");

  assert.deepEqual(applyReviewerSeed(fresh, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: 0,
    itemsCreated: 0,
  });
  assert.equal(
    fresh.exportTenantData(BOOTSTRAP_TENANT_ID).calls.length,
    0,
    "Betreiber ohne Seed-Zeilen",
  );
});

test("Reviewer-Seed pg: Betreiber-, unbekannter Mandant und fehlender Ende-Zeitpunkt werden verweigert, nichts geschrieben", async () => {
  const { store } = await seededStore();
  const callsBefore = store.load().calls.length;
  assert.throws(() => applyReviewerSeed(store, BOOTSTRAP_TENANT_ID, ENDED_AT), /Betreiber/);
  assert.throws(() => applyReviewerSeed(store, "tenant_unbekannt", ENDED_AT), /unbekannt/);
  assert.throws(() => applyReviewerSeed(store, "", ENDED_AT), /Mandanten-Kennung fehlt/);
  assert.throws(() => applyReviewerSeed(store, REVIEWER_TENANT), /Ende-Zeitpunkt/);
  assert.equal(store.load().calls.length, callsBefore);
});
