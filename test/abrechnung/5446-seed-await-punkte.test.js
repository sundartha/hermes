import assert from "node:assert/strict";
import { test } from "node:test";

import { legeMandantAn, makePgStore, makePgTestStore } from "../pg-helpers.js";
import {
  REVIEWER_SEED_CALLS,
  applyReviewerSeedAndPersist,
} from "../../scripts/lib/reviewer-demo-seed.mjs";

const REVIEWER_TENANT = "tenant_reviewer_5446";
const ENDED_AT = "2026-01-01T00:00:00.000Z";
const SCHREIBFEHLER = "Schreiben des Punkts gesperrt";
const EIN_PUNKT = REVIEWER_SEED_CALLS[0].actionItems[0];
const ZWEITER_PUNKT = REVIEWER_SEED_CALLS[1].actionItems[0];

async function geseedeterStore() {
  const { store: start, db, runner } = await makePgTestStore();
  await legeMandantAn(start, REVIEWER_TENANT);
  const store = makePgStore(runner);
  await store.init();
  await applyReviewerSeedAndPersist(store, REVIEWER_TENANT, ENDED_AT);
  return { db, runner };
}

async function ohnePunkteNeuGeoeffnet(texte) {
  const { db, runner } = await geseedeterStore();
  await db.query(`DELETE FROM action_item WHERE tenant_id = $1 AND text = ANY($2)`, [
    REVIEWER_TENANT,
    texte,
  ]);
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("pg: ein als Duplikat gemeldeter Punkt zaehlt nicht als angelegt", async () => {
  const store = await ohnePunkteNeuGeoeffnet([EIN_PUNKT, ZWEITER_PUNKT]);
  const echt = store.addActionItem.bind(store);
  store.addActionItem = async (callId, text, type) =>
    text === EIN_PUNKT ? { duplicate: true } : echt(callId, text, type);
  assert.deepEqual(await applyReviewerSeedAndPersist(store, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: 0,
    itemsCreated: 1,
  });
});

test("pg: Schreibfehler bei addActionItem lehnt den Seed ab", async () => {
  const store = await ohnePunkteNeuGeoeffnet([EIN_PUNKT]);
  store.addActionItem = () => Promise.reject(new Error(SCHREIBFEHLER));
  await assert.rejects(
    applyReviewerSeedAndPersist(store, REVIEWER_TENANT, ENDED_AT),
    new RegExp(SCHREIBFEHLER),
  );
});
