// Phase outbound-p1: seedBootstrapKyc heilt den Owner-Tenant beim Boot auf id_verified -
// LIVE ist pg, darum MUSS der Seed in pg.init() greifen (sonst spaerrt der fail-closed
// kycReached-Flip den realen Prod-Owner aus). Gegen pglite (Postgres-in-WASM, offline,
// F.I.R.S.T.). REIN pglite, NIE mit Server-Spawn in derselben Datei (P6a-Stall-Lehre).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import * as ops from "../src/store/state-ops.js";
import { KYC_LEVEL } from "../src/store/defaults.js";

// pglite ist ein-verbindig: withClient reicht die Instanz als Client durch.
const runnerFor = (db) => ({
  withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
});

// kyc_level des Bootstrap-Tenants direkt aus der DB (Persistenz-Beweis; tenant-Tabelle
// hat keine RLS -> kein GUC noetig).
async function dbKycLevel(db) {
  const rows = (await db.query(`SELECT kyc_level FROM tenant WHERE id = $1`, [BOOTSTRAP_TENANT_ID]))
    .rows;
  return rows[0]?.kyc_level ?? null;
}

test("pg: init() heilt den Owner auf id_verified, persistiert + idempotent re-hydriert", async () => {
  const db = new PGlite();
  const store = makePgStore(runnerFor(db));
  await store.init();
  assert.equal(store.kycReached(BOOTSTRAP_TENANT_ID, KYC_LEVEL.CARD), true, "Owner passiert KYC");
  assert.equal(await dbKycLevel(db), KYC_LEVEL.ID_VERIFIED, "kyc_level in der DB persistiert");

  // Re-Hydrierung aus der DB (zweiter Store) -> die Heilung ueberlebt; ein zweiter Lauf
  // ist No-Op (set-if-absent sieht den gesetzten Wert -> kein erneuter Flush).
  const reopened = makePgStore(runnerFor(db));
  await reopened.init();
  assert.equal(await dbKycLevel(db), KYC_LEVEL.ID_VERIFIED, "persistiert re-hydriert");
  assert.equal(
    ops.seedBootstrapKyc(reopened.load(), BOOTSTRAP_TENANT_ID),
    false,
    "zweiter Lauf = No-Op (idempotent)",
  );
});

test("pg: explizit gesetztes kyc_level (card) wird vom Boot-Seed NICHT ueberschrieben", async () => {
  const db = new PGlite();
  const store = makePgStore(runnerFor(db));
  await store.init();
  // Owner bewusst auf card herabsetzen + flushen (await save -> die sequenzielle flushChain
  // garantiert, dass card in der DB liegt, bevor der zweite Store hydriert).
  store.setKycLevel(BOOTSTRAP_TENANT_ID, KYC_LEVEL.CARD);
  await store.save();
  assert.equal(await dbKycLevel(db), KYC_LEVEL.CARD, "card geflusht");

  const reopened = makePgStore(runnerFor(db));
  await reopened.init();
  assert.equal(await dbKycLevel(db), KYC_LEVEL.CARD, "Boot-Seed laesst gesetzten Wert unberuehrt");
});
