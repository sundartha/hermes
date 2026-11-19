import assert from "node:assert/strict";
import { test } from "node:test";

import { legeMandantAn, makePgStore, makePgTestStore } from "../pg-helpers.js";
import {
  REVIEWER_SEED_CALLS,
  applyReviewerSeedAndPersist,
} from "../../scripts/lib/reviewer-demo-seed.mjs";

const REVIEWER_TENANT = "tenant_reviewer_2973";
const LESEFEHLER = "Lesen der Anrufe gesperrt";
const ENDED_AT = "2026-01-01T00:00:00.000Z";

function runnerFuer(db, sperre) {
  return {
    withClient: (fn) =>
      fn({
        query: (text, params) => {
          if (sperre.aktiv && /FROM call\b/.test(text))
            return Promise.reject(new Error(LESEFEHLER));
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function zweiInstanzen() {
  const { store: start, db, runner } = await makePgTestStore();
  await legeMandantAn(start, REVIEWER_TENANT);
  const a = makePgStore(runner);
  await a.init();
  const sperre = { aktiv: false };
  const b = makePgStore(runnerFuer(db, sperre));
  await b.init();
  return { a, b, db, sperre };
}

const anzahlAnrufe = async (db) =>
  (await db.query(`SELECT id FROM call WHERE tenant_id = $1`, [REVIEWER_TENANT])).rows.length;

test("Seed auf Instanz B nach dem Seed von Instanz A legt nichts doppelt an", async () => {
  const { a, b, db } = await zweiInstanzen();
  const erst = await applyReviewerSeedAndPersist(a, REVIEWER_TENANT, ENDED_AT);
  assert.equal(erst.callsCreated, REVIEWER_SEED_CALLS.length);
  assert.deepEqual(await applyReviewerSeedAndPersist(b, REVIEWER_TENANT, ENDED_AT), {
    callsCreated: 0,
    itemsCreated: 0,
  });
  assert.equal(await anzahlAnrufe(db), REVIEWER_SEED_CALLS.length);
});

test("Ein Lesefehler beim Lesen der Anrufe lehnt den Seed ab und schreibt keine Zeile", async () => {
  const { b, db, sperre } = await zweiInstanzen();
  sperre.aktiv = true;
  await assert.rejects(
    applyReviewerSeedAndPersist(b, REVIEWER_TENANT, ENDED_AT),
    /Lesen der Anrufe gesperrt/,
  );
  sperre.aktiv = false;
  assert.equal(await anzahlAnrufe(db), 0);
});
