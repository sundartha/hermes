// OUTBOUND-E1: Plattform-Nummern-Bindung gegen das pg-Backend (pglite, Postgres-in-WASM -
// KEIN Netz, keine externe DB -> F.I.R.S.T. erfuellt, Muster test/store-pg-multitenant.test.js).
// Deckt Ebene C (DB-Trigger) + die zwei Blocker der Pruefung (Flush-/Prune-Regression, PM-11/
// PM-12) + den Neustart-Round-Trip (Lehre pg-store-holds-state-in-memory) + den Teilindex +
// die Flush-Reihenfolge (platform_number_use VOR der Tenant-Schleife).
//
// PII (Regel 9): NUR erkennbar fiktive Nummern aus dem Bestandsstil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";
import { makePgStore } from "../src/store/pg.js";
import { NUMBER_STATUS, PROVIDER, PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";
import * as ops from "../src/store/state-ops.js";
import { makePgTestStore } from "./pg-helpers.js";

const CUSTOMER_DID = "+4915112345678";
const ANI = "+15005550006";

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("P1: NEUSTART-Round-Trip - binden, save(), Spiegel verwerfen, neu hydrieren, lesen", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  ops.bindPlatformNumber(state, {
    e164: ANI,
    purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI,
    provider: PROVIDER.TELNYX,
    tenantId: null,
    note: "test",
  });
  await store.save();

  const reopened = await reopen(db);
  const binding = ops.platformNumberBinding(reopened.load(), ANI);
  assert.ok(binding, "Bindung ueberlebt Neustart");
  assert.equal(binding.purpose, PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI);
  assert.equal(binding.tenantId, null);
  assert.ok(binding.boundAt, "boundAt ist gesetzt");
  assert.equal(binding.releasedAt, null);
});

test("P2: Ebene C wirft am Store vorbei - rohes UPDATE auf gebundene Zeile", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n1",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_n1",
  });
  ops.bindPlatformNumber(state, { e164: CUSTOMER_DID, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, provider: PROVIDER.TELNYX, tenantId: null });
  await store.save();

  await assert.rejects(
    () => db.query(`UPDATE number SET status='released' WHERE id='n1'`),
    (err) => {
      assert.equal(err.code, "P0001");
      return true;
    },
  );
  const numberRow = (await db.query(`SELECT status FROM number WHERE id='n1'`)).rows[0];
  assert.equal(numberRow.status, "active");
});

test("P3 (Positiv-Kontrolle): dasselbe rohe UPDATE auf eine UNGEBUNDENE Zeile geht durch", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n2",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_n2",
  });
  await store.save();

  await db.query(`UPDATE number SET status='released' WHERE id='n2'`);
  const numberRow = (await db.query(`SELECT status FROM number WHERE id='n2'`)).rows[0];
  assert.equal(numberRow.status, "released");
});

test("P4 (Flush-Regression, PM-11): gebundene, BEREITS released-e Zeile zweimal flushen -> kein Wurf", async () => {
  const { store } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n3",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.RELEASED, // der heutige Live-Zustand: schon released, TROTZDEM gebunden
    providerNumberId: "ext_n3",
  });
  ops.bindPlatformNumber(state, { e164: CUSTOMER_DID, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, provider: PROVIDER.TELNYX, tenantId: null });
  await store.save();
  await store.save(); // zweiter Flush - ohne WHEN-Klausel wuerfe der Trigger hier
  // store.save() schluckt einen Flush-Fehler bewusst (lastFlushError, S1-2) - die Kette
  // bleibt resolved, damit createCall/gracefulShutdown unveraendert bleiben. Nur
  // drainFlushes() wirft ihn wieder hoch - das ist der einzig verlaessliche Nachweis,
  // dass der zweite Flush WIRKLICH durchgelaufen ist (assert.ok(true) waere blind dafuer).
  await store.drainFlushes();
});

test("P5 (Prune-Regression, PM-12): Flush mit leerem Nummern-Slice des gebundenen Tenants -> kein Wurf, Bindung ueberlebt", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n4",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_n4",
  });
  ops.bindPlatformNumber(state, { e164: CUSTOMER_DID, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, provider: PROVIDER.TELNYX, tenantId: null });
  await store.save();

  // Spiegel-Divergenz simulieren: die Nummer verschwindet aus dem In-Memory-Slice des
  // Tenants (Teil-Hydrierung/Overlap), OHNE ueber releaseNumber/unbindPlatformNumber
  // gegangen zu sein - flushOwnScoped prunt sie beim naechsten save() per DELETE.
  state.numbers = state.numbers.filter((number) => number.id !== "n4");
  await store.save();

  const remaining = (await db.query(`SELECT id FROM number WHERE id='n4'`)).rows;
  assert.equal(remaining.length, 0, "die Zeile wurde geprunt (DELETE, kein Trigger-Wurf)");
  const binding = ops.platformNumberBinding(store.load(), CUSTOMER_DID);
  assert.ok(binding, "die Bindung ueberlebt den Prune (eigene, globale Tabelle)");
});

test("P6 (Flush-Reihenfolge): Unbind + releaseNumber in EINEM save() - die legitime Kuendigung wirft NICHT", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.registerTenant(state, "t1");
  state.numbers.push({
    id: "n5",
    tenantId: "t1",
    e164: CUSTOMER_DID,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_n5",
  });
  ops.bindPlatformNumber(state, {
    e164: CUSTOMER_DID,
    purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI,
    provider: PROVIDER.TELNYX,
    tenantId: "t1", // eigene Bindung des freigebenden Tenants - darf mit
  });
  await store.save();

  // Geordnete Kette: unbind VOR releaseNumber, IM SELBEN save() (Muster performNumberRelease).
  const fresh = store.load();
  const number = ops.findNumber(fresh, "n5");
  ops.unbindPlatformNumber(fresh, { e164: number.e164, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI });
  ops.releaseNumber(fresh, "n5");
  await store.save();

  const numberRow = (await db.query(`SELECT status, e164 FROM number WHERE id='n5'`)).rows[0];
  assert.equal(numberRow.status, "released");
  assert.equal(numberRow.e164, null);
  const bindingRow = (
    await db.query(`SELECT released_at FROM platform_number_use WHERE e164=$1`, [CUSTOMER_DID])
  ).rows[0];
  assert.ok(bindingRow.released_at, "die Bindung ist geschlossen");
});

test("P7: Teilindex - zweite offene Bindung fuer (e164, purpose) wird abgewiesen; nach Unbind wieder erlaubt", async () => {
  const { store, db } = await makePgTestStore();
  const state = store.load();
  ops.bindPlatformNumber(state, { e164: ANI, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, provider: PROVIDER.TELNYX, tenantId: null });
  await store.save();

  await assert.rejects(() =>
    db.query(
      `INSERT INTO platform_number_use (id, e164, purpose, provider) VALUES ('pnu_dup', $1, $2, 'telnyx')`,
      [ANI, PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI],
    ),
  );

  const fresh = store.load();
  ops.unbindPlatformNumber(fresh, { e164: ANI, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI });
  ops.bindPlatformNumber(fresh, { e164: ANI, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, provider: PROVIDER.TELNYX, tenantId: null });
  await store.save();

  const openRows = (
    await db.query(`SELECT id FROM platform_number_use WHERE e164=$1 AND released_at IS NULL`, [ANI])
  ).rows;
  assert.equal(openRows.length, 1, "genau eine offene Bindung nach Unbind+Rebind");
});

test("P8: Schema-Idempotenz mit Trigger - applySchema zweimal auf frischer PGlite wirft nicht", async () => {
  const db = new PGlite();
  const conn = { query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) };
  await applySchema(conn);
  await applySchema(conn);
  assert.ok(true, "zweiter applySchema-Aufruf mit der neuen Trigger-DDL wirft nicht");
});
