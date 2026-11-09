import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const EL_KENNUNG = "cc_el_kennung-speicher";
const SPALTE_ABFRAGE = "SELECT el_call_control_id FROM call WHERE id = $1";

const neuerAnruf = (store) =>
  store.createCall({ direction: "outbound", from: "+4915100000101", to: "+4915100000102", tenantId: BOOTSTRAP_TENANT_ID });

const neuLaden = async (store) => {
  await store.drainFlushes();
  await store.init();
};

const spaltenwert = async (db, callId) => (await db.query(SPALTE_ABFRAGE, [callId])).rows[0].el_call_control_id;

test("EL-Bein-Kennung: ein Anruf mit EL-Bein-Kennung kommt nach Speichern und Neuladen mit derselben Kennung zurueck", async () => {
  const { store } = await makePgTestStore();
  const angelegt = neuerAnruf(store);
  store.getCall(angelegt.id).elCallControlId = EL_KENNUNG;
  await store.save();

  await neuLaden(store);

  assert.equal(store.getCall(angelegt.id).elCallControlId, EL_KENNUNG);
});

test("EL-Bein-Kennung: ein Anruf ohne EL-Bein hat nach dem Neuladen null und eine leere Spalte", async () => {
  const { store, db } = await makePgTestStore();
  const angelegt = neuerAnruf(store);
  await store.save();

  await neuLaden(store);

  assert.equal(store.getCall(angelegt.id).elCallControlId, null);
  assert.equal(await spaltenwert(db, angelegt.id), null);
});

test("EL-Bein-Kennung: ein Speichern mit aelterem Stand ohne Kennung loescht die gespeicherte Kennung nicht", async () => {
  const { store, db } = await makePgTestStore();
  const angelegt = neuerAnruf(store);
  const call = store.getCall(angelegt.id);
  call.elCallControlId = EL_KENNUNG;
  await store.save();
  await store.drainFlushes();
  assert.equal(await spaltenwert(db, angelegt.id), EL_KENNUNG);

  delete call.elCallControlId;
  call.summary = "aelterer Stand speichert erneut";
  await store.save();
  await store.drainFlushes();

  assert.equal(await spaltenwert(db, angelegt.id), EL_KENNUNG);
});
