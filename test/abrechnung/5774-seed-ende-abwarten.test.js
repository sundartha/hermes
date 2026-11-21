import assert from "node:assert/strict";
import { test } from "node:test";

import { legeMandantAn, makePgStore, makePgTestStore } from "../pg-helpers.js";
import { applyReviewerSeedAndPersist } from "../../scripts/lib/reviewer-demo-seed.mjs";

const REVIEWER_TENANT = "tenant_reviewer_5774";
const ENDED_AT = "2026-01-01T00:00:00.000Z";
const SCHREIBFEHLER = "Schreiben des Endes gesperrt";

async function frischerStore() {
  const { store: start, runner } = await makePgTestStore();
  await legeMandantAn(start, REVIEWER_TENANT);
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("pg: abgelehntes setCallEndedAt lehnt den Seed mit genau diesem Fehler ab", async () => {
  const store = await frischerStore();
  store.setCallEndedAt = () => Promise.reject(new Error(SCHREIBFEHLER));
  await assert.rejects(
    applyReviewerSeedAndPersist(store, REVIEWER_TENANT, ENDED_AT),
    (fehler) => fehler.message === SCHREIBFEHLER,
  );
});

test("pg: ohne Fehler meldet der Seed alle Anrufe und Punkte", async () => {
  const store = await frischerStore();
  assert.deepEqual(await applyReviewerSeedAndPersist(store, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: 3,
    itemsCreated: 4,
  });
});
