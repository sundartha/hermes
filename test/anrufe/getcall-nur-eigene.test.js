import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";

const BEENDEN_SQL = "UPDATE call SET status = 'completed' WHERE id = $1";
const ANBIETER_ID = "CA_h7c2b3_anbieter";

const neuerAnruf = () => ({ direction: "outbound", from: "+4930555000300", to: "+4915112345678", tenantId: BOOTSTRAP_TENANT_ID });

async function legeAnrufAn(store, ueber = {}) {
  const call = store.createCall(neuerAnruf());
  Object.assign(call, ueber);
  await store.persistCall(call.id);
  return call;
}

async function zweiteInstanz(runner) {
  const store = makePgStore(runner);
  await store.init();
  return store;
}

function mitAusfall(runner) {
  const schalter = { aus: false };
  return {
    schalter,
    runner: {
      withClient: (fn) => (schalter.aus ? Promise.reject(new Error("Datenbank haengt")) : runner.withClient(fn)),
    },
  };
}

const ids = (liste) => liste.map((call) => call.id).sort();

test("H7c2b3-1: getCall liefert fuer eine beim Laden gelesene Fremdkopie keinen Treffer, auch nicht den veralteten Stand", async () => {
  const { store: a, db, runner } = await makePgTestStore();
  const anruf = await legeAnrufAn(a);
  const b = await zweiteInstanz(runner);
  await db.query(BEENDEN_SQL, [anruf.id]);
  assert.equal(b.getCall(anruf.id), null);
  assert.equal(b.anrufHierBewacht(anruf.id), false);
  assert.equal((await b.leseCall(anruf.id)).status, "completed");
});

test("H7c2b3-2: activeCallsFor zaehlt ohne gelesenen Stand nur eigene Anrufe, nicht die Fremdkopie", async () => {
  const { store: a, runner } = await makePgTestStore();
  const fremd = await legeAnrufAn(a);
  const b = await zweiteInstanz(runner);
  const eigen = await legeAnrufAn(b);
  assert.deepEqual(ids(b.activeCallsFor(BOOTSTRAP_TENANT_ID)), [eigen.id]);
  assert.deepEqual(ids(await b.activeCallsForSql(BOOTSTRAP_TENANT_ID)), ids([fremd, eigen]));
});

test("H7c2b3-3: haengt die Datenbank nach einer Lesung, zaehlt activeCallsFor den fremden aktiven Anruf mit dem gelesenen Stand", async () => {
  const { store: a, runner } = await makePgTestStore();
  const ausfall = mitAusfall(runner);
  const b = makePgStore(ausfall.runner);
  await b.init();
  const eigen = await legeAnrufAn(b);
  const fremd = await legeAnrufAn(a, { goal: "fremd" });
  assert.deepEqual(ids(b.activeCallsFor(BOOTSTRAP_TENANT_ID)), [eigen.id]);
  await b.activeCallsForSql(BOOTSTRAP_TENANT_ID);
  assert.deepEqual(ids(b.activeCallsFor(BOOTSTRAP_TENANT_ID)), [eigen.id]);
  ausfall.schalter.aus = true;
  await assert.rejects(b.activeCallsForSql(BOOTSTRAP_TENANT_ID));
  assert.deepEqual(ids(b.activeCallsFor(BOOTSTRAP_TENANT_ID)), ids([fremd, eigen]));
  assert.equal(b.activeCallsFor(BOOTSTRAP_TENANT_ID).find((call) => call.id === fremd.id).goal, "fremd");
});

test("H7c2b3-9: nach einer erfolgreichen Lesung zaehlt activeCallsFor einen von der anderen Instanz beendeten Anruf nicht mehr", async () => {
  const { store: a, db, runner } = await makePgTestStore();
  const b = await zweiteInstanz(runner);
  const fremd = await legeAnrufAn(a);
  assert.deepEqual(ids(await b.activeCallsForSql(BOOTSTRAP_TENANT_ID)), [fremd.id]);
  await db.query(BEENDEN_SQL, [fremd.id]);
  assert.deepEqual(ids(await b.activeCallsForSql(BOOTSTRAP_TENANT_ID)), []);
  assert.deepEqual(b.activeCallsFor(BOOTSTRAP_TENANT_ID), []);
});

test("H7c2b3-4: ein selbst angelegter Anruf kommt aus getCall und activeCallsFor unveraendert, und endet er hier, zaehlt ihn auch ein alter Stand nicht mehr", async () => {
  const { store: a, runner } = await makePgTestStore();
  const b = await zweiteInstanz(runner);
  const eigen = await legeAnrufAn(b);
  await a.activeCallsForSql(BOOTSTRAP_TENANT_ID);
  await b.activeCallsForSql(BOOTSTRAP_TENANT_ID);
  assert.equal(b.getCall(eigen.id), eigen);
  assert.deepEqual(ids(b.activeCallsFor(BOOTSTRAP_TENANT_ID)), [eigen.id]);
  eigen.status = "completed";
  assert.deepEqual(b.activeCallsFor(BOOTSTRAP_TENANT_ID), []);
});

test("H7c2b3-5: ein angehaengter Anruf einer anderen Instanz zaehlt als eigener, getCall liefert ihn", async () => {
  const { store: a, runner } = await makePgTestStore();
  const fremd = await legeAnrufAn(a);
  const b = await zweiteInstanz(runner);
  assert.equal(b.getCall(fremd.id), null);
  const angehaengt = await b.leseCall(fremd.id);
  assert.equal(angehaengt.id, fremd.id);
  assert.equal(b.getCall(fremd.id), angehaengt);
  assert.deepEqual(ids(b.activeCallsFor(BOOTSTRAP_TENANT_ID)), [fremd.id]);
});

test("H7c2b3-6: der gemerkte Stand gilt nur fuer den Mandanten, dessen Lesung er war", async () => {
  const { store: a, runner } = await makePgTestStore();
  const ausfall = mitAusfall(runner);
  const b = makePgStore(ausfall.runner);
  await b.init();
  const fremd = await legeAnrufAn(a);
  await b.activeCallsForSql(BOOTSTRAP_TENANT_ID);
  ausfall.schalter.aus = true;
  await assert.rejects(b.activeCallsForSql(BOOTSTRAP_TENANT_ID));
  assert.deepEqual(b.activeCallsFor("tenant_ohne_anrufe"), []);
  assert.deepEqual(ids(b.activeCallsFor(BOOTSTRAP_TENANT_ID)), [fremd.id]);
});

test("H7c2b3-7: ein Neustart verwirft den gemerkten Stand, danach zaehlt activeCallsFor bei einem Lesefehler wieder nur eigene Anrufe", async () => {
  const { store: a, runner } = await makePgTestStore();
  const ausfall = mitAusfall(runner);
  const b = makePgStore(ausfall.runner);
  await b.init();
  const fremd = await legeAnrufAn(a);
  await b.activeCallsForSql(BOOTSTRAP_TENANT_ID);
  await b.init();
  ausfall.schalter.aus = true;
  await assert.rejects(b.activeCallsForSql(BOOTSTRAP_TENANT_ID));
  assert.equal(b.getCall(fremd.id), null);
  assert.deepEqual(b.activeCallsFor(BOOTSTRAP_TENANT_ID), []);
});

test("H7c2b3-8: getCall ueber die Anbieter-ID liefert fuer eine Fremdkopie keinen Treffer, fuer einen eigenen Anruf den Anruf", async () => {
  const { store: a, runner } = await makePgTestStore();
  await legeAnrufAn(a, { twilioSid: ANBIETER_ID });
  const b = await zweiteInstanz(runner);
  assert.equal(b.getCall(ANBIETER_ID), null);
  const eigen = await legeAnrufAn(b, { twilioSid: `${ANBIETER_ID}_eigen` });
  assert.equal(b.getCall(`${ANBIETER_ID}_eigen`), eigen);
});
