// Regression: pg-Init seedet die aktive Owner-Nummer config-derived (analog json.js
// finishLoad). Ohne diesen Seed braeche der Boot-Guard (server.js) auf Render mit
// STORE_BACKEND=pg + frischer/leerer DB fail-closed ab (exit 1 -> Deploy update_failed).
// render-owner-autoseed.test.js deckt nur die reine state-ops-Funktion ab, NICHT den
// pg-Init-Pfad (Seed + Persistenz). pglite = kein Netz, keine externe DB (F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, OWNER_TENANT_ID } from "../src/store/pg.js";
import { config } from "../src/config.js";
import { PROVIDER } from "../src/store/defaults.js";
import { findActiveNumber } from "../src/store/views.js";

function runnerFor(db) {
  return {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
}

test("pg-Init seedet aktive Owner-Nummer aus config UND persistiert (Re-Hydrierung)", async () => {
  const db = new PGlite();
  const prevNum = config.ownerNumber;
  const prevProv = config.ownerNumberProvider;
  config.ownerNumber = "+491737252163";
  config.ownerNumberProvider = PROVIDER.TELNYX;
  try {
    const store1 = makePgStore(runnerFor(db));
    await store1.init();
    assert.ok(findActiveNumber(store1.load(), OWNER_TENANT_ID), "aktive Owner-Nummer nach init");
    // Zweiter Aufbau auf derselben DB -> re-hydriert aus der DB, beweist den init-Flush.
    const store2 = makePgStore(runnerFor(db));
    await store2.init();
    assert.ok(
      findActiveNumber(store2.load(), OWNER_TENANT_ID),
      "aktive Owner-Nummer nach Re-Hydrierung (persistiert)",
    );
  } finally {
    config.ownerNumber = prevNum;
    config.ownerNumberProvider = prevProv;
  }
});

test("pg-Init ohne config.ownerNumber -> keine Owner-Nummer (No-Op, boot-sicher)", async () => {
  const db = new PGlite();
  const prevNum = config.ownerNumber;
  config.ownerNumber = "";
  try {
    const store = makePgStore(runnerFor(db));
    await store.init();
    assert.ok(!findActiveNumber(store.load(), OWNER_TENANT_ID));
  } finally {
    config.ownerNumber = prevNum;
  }
});
