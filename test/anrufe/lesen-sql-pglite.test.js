import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_lesen_kunde";
const FREMD = "t_lesen_fremd";
const ZIEL = "+4915112349944";

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

async function legeAn(store) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000300", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await store.persistCall(call.id);
  return call;
}

test("LESEN-1: Instanz B findet einen Anruf von Instanz A ueber leseCall aus der Datenbank", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  assert.equal(b.getCall(call.id), null);
  const gelesen = await b.leseCall(call.id);
  assert.equal(gelesen.id, call.id);
  assert.equal(gelesen.tenantId, KUNDE);
  assert.equal(gelesen.to, ZIEL);
  assert.equal(b.getCall(call.id), gelesen);
});

test("LESEN-2: Instanz A bekommt fuer einen eigenen Anruf dasselbe Objekt wie getCall", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const call = await legeAn(a);
  assert.equal(await a.leseCall(call.id), a.getCall(call.id));
});

test("LESEN-3: ein unbekannter Anruf liefert null, auch auf einer Verbindung mit fremdem Mandanten-Kontext", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await setzeKontext(db, FREMD);
  assert.equal(await b.leseCall("call_unbekannt"), null);
  assert.equal((await b.leseCall(call.id)).tenantId, KUNDE);
});

test("LESEN-4: ein Lesefehler der Datenbank wirft und gilt nicht als nicht gefunden", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunden(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await db.exec("ALTER TABLE anruf_schluessel RENAME TO anruf_schluessel_versteckt");
  await assert.rejects(b.leseCall(call.id));
  assert.equal(b.getCall(call.id), null);
});
