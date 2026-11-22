import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_bruecke_kunde";
const FREMD = "t_bruecke_fremd";
const ZIEL = "+4915112349934";
const ERSTER = "2030-01-02T03:04:05.000Z";
const ZWEITER = "2031-06-07T08:09:10.000Z";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function mitKunden(db) {
  await neueInstanz(db);
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  return neueInstanz(db);
}

async function legeAn(store, tenantId) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000300", to: ZIEL, goal: "Test", tenantId });
  await store.persistCall(call.id);
  return call;
}

async function bridgedAt(db, tenantId, callId) {
  await setzeKontext(db, tenantId);
  const { rows } = await db.query(`SELECT bridged_at FROM call WHERE id = $1`, [callId]);
  return rows[0].bridged_at === null ? null : new Date(rows[0].bridged_at).toISOString();
}

test("BRUECKE-1: recordBridgedAt schreibt bridged_at in die Datenbank und ein zweiter Aufruf aendert den Wert nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a, KUNDE);
  assert.equal(await bridgedAt(db, KUNDE, call.id), null);
  await a.recordBridgedAt(call.id, ERSTER);
  assert.equal(await bridgedAt(db, KUNDE, call.id), ERSTER);
  a.getCall(call.id).bridgedAt = null;
  await a.recordBridgedAt(call.id, ZWEITER);
  assert.equal(await bridgedAt(db, KUNDE, call.id), ERSTER);
});

test("BRUECKE-2: die Marke eines Anrufs beruehrt weder einen anderen Anruf noch einen anderen Mandanten", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const eigener = await legeAn(a, KUNDE);
  const zweiter = await legeAn(a, KUNDE);
  const fremder = await legeAn(a, FREMD);
  await a.recordBridgedAt(eigener.id, ERSTER);
  assert.equal(await bridgedAt(db, KUNDE, zweiter.id), null);
  assert.equal(await bridgedAt(db, FREMD, fremder.id), null);
});

test("BRUECKE-3: ein unbekannter Anruf liefert nichts", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  assert.equal(await a.recordBridgedAt("call_unbekannt", ERSTER), null);
});
