import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_bewacht_kunde";
const ZIEL = "+4915112349944";
const ALT = "2020-01-02T03:04:05.000Z";
const NACH_TOKEN = { schluessel: "streamToken" };

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function mitKunde(db) {
  await neueInstanz(db);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  return neueInstanz(db);
}

async function legeAn(store, tenantId = KUNDE) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000310", to: ZIEL, goal: "Test", tenantId });
  await store.persistCall(call.id);
  return call;
}

test("BEWACHT-1: ein angelegter Anruf gilt auf dieser Instanz als bewacht, eine unbekannte Kennung nicht", async () => {
  const a = await mitKunde(await pgliteAlsRolleOhneSuperuser());
  const call = await legeAn(a);
  assert.equal(a.anrufHierBewacht(call.id), true);
  assert.equal(a.anrufHierBewacht("call_gibt_es_nicht"), false);
});

test("BEWACHT-2: ein Anruf, dessen Zeile nicht gespeichert werden konnte, ist nicht bewacht", async () => {
  const a = await mitKunde(await pgliteAlsRolleOhneSuperuser());
  const call = a.createCall({ direction: "outbound", from: "+4930555000310", to: ZIEL, goal: "Test", tenantId: "t_bewacht_unbekannt" });
  assert.equal(a.anrufHierBewacht(call.id), true);
  await assert.rejects(a.persistCall(call.id));
  assert.equal(a.anrufHierBewacht(call.id), false);
});

test("BEWACHT-3: endCallRecord loest die Bewachung", async () => {
  const a = await mitKunde(await pgliteAlsRolleOhneSuperuser());
  const call = await legeAn(a);
  await a.endCallRecord(call.id, "completed");
  assert.equal(a.anrufHierBewacht(call.id), false);
});

test("BEWACHT-4: setCallEndedAt loest die Bewachung", async () => {
  const a = await mitKunde(await pgliteAlsRolleOhneSuperuser());
  const call = await legeAn(a);
  await a.setCallEndedAt(call.id, "failed", ALT);
  assert.equal(a.anrufHierBewacht(call.id), false);
});

test("BEWACHT-5: die Uebernahme eines laufenden Anrufs einer anderen Instanz bindet ihn, ueber Kennung wie ueber Stream-Token", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunde(db);
  const [b, c] = [await neueInstanz(db), await neueInstanz(db)];
  const call = await legeAn(a);
  assert.equal(b.anrufHierBewacht(call.id), false);
  await b.attachActiveCall(call.id);
  assert.equal(b.anrufHierBewacht(call.id), true);
  await c.attachActiveCall(call.streamToken, NACH_TOKEN);
  assert.equal(c.anrufHierBewacht(call.id), true);
});

test("BEWACHT-6: ein Anruf, der schon im Spiegel steht, wird bei der Uebernahme trotzdem gebunden; ein nur gelesener bleibt ungebunden", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunde(db);
  const [b, c, d] = [await neueInstanz(db), await neueInstanz(db), await neueInstanz(db)];
  const call = await legeAn(a);
  await b.leseCall(call.id);
  assert.equal(b.anrufHierBewacht(call.id), false);
  await b.attachActiveCall(call.id);
  assert.equal(b.anrufHierBewacht(call.id), true);
  await c.leseCallUngebunden(call.id);
  assert.equal(c.anrufHierBewacht(call.id), false);
  assert.equal(await d.attachActiveCall("call_gibt_es_nicht"), null);
  assert.equal(d.anrufHierBewacht("call_gibt_es_nicht"), false);
});

test("BEWACHT-7: ein beendeter Anruf einer anderen Instanz wird bei der Uebernahme nicht gebunden", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const a = await mitKunde(db);
  const b = await neueInstanz(db);
  const call = await legeAn(a);
  await a.endCallRecord(call.id, "completed");
  assert.equal(await b.attachActiveCall(call.id), null);
  assert.equal(b.anrufHierBewacht(call.id), false);
});

test("BEWACHT-8: eraseTenantData loest die Bewachung der geloeschten Anrufe, auch eines laufenden", async () => {
  const a = await mitKunde(await pgliteAlsRolleOhneSuperuser());
  const call = await legeAn(a);
  await a.eraseTenantData(KUNDE);
  assert.equal(a.anrufHierBewacht(call.id), false);
});

test("BEWACHT-9: pruneOldData loest die Bewachung eines abgelaufenen Anrufs, den nur der Spiegel noch als gebunden kennt", async () => {
  const a = await mitKunde(await pgliteAlsRolleOhneSuperuser());
  const call = await legeAn(a);
  const eigener = await legeAn(a);
  Object.assign(a.getCall(call.id), { status: "completed", endedAt: ALT });
  await a.save();
  await a.drainFlushes();
  const entfernt = await a.pruneOldData(30, 7, 7);
  assert.equal(entfernt.calls, 1);
  assert.equal(a.anrufHierBewacht(call.id), false);
  assert.equal(a.anrufHierBewacht(eigener.id), true);
});

test("BEWACHT-10: nach einem Neuaufbau des Zustands ist kein Anruf mehr gebunden, bis er uebernommen wird", async () => {
  const a = await mitKunde(await pgliteAlsRolleOhneSuperuser());
  const call = await legeAn(a);
  await a.init();
  assert.equal(a.anrufHierBewacht(call.id), false);
  await a.attachActiveCall(call.id);
  assert.equal(a.anrufHierBewacht(call.id), true);
});
