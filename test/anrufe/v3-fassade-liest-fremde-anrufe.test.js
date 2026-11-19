import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_v3_fassade";
const ABSENDER = "+4930555000388";
const ZIEL = "+4915112349988";
const KONVERSATION = "conv_v3_fassade";

const runnerFuer = (db) => ({
  withClient: (arbeit) => arbeit({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const a = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  await a.persistCall(call.id);
  await a.drainFlushes();
  await db.query(`UPDATE call SET elevenlabs_conversation_id = $1 WHERE id = $2`, [KONVERSATION, call.id]);
  return { b: await neueInstanz(db), callId: call.id };
}

test("V3-F1: eine zweite Instanz sieht die belegte Nummer eines Anrufs, den nur die Datenbank kennt", async () => {
  const { b } = await aufbau();
  assert.equal(await b.numberHasActiveCall(ABSENDER), true);
  assert.equal(await b.numberHasActiveCall("+4930555000399"), false);
});

test("V3-F2: eine zweite Instanz findet Konversation und Anrufe des Mandanten in der Datenbank", async () => {
  const { b, callId } = await aufbau();
  assert.equal(await b.anderesAnrufMitKonversation("call_anderer", KONVERSATION), true);
  assert.equal(await b.anderesAnrufMitKonversation(callId, KONVERSATION), false);
  assert.deepEqual((await b.anrufeDesMandanten(KUNDE)).map((call) => call.id), [callId]);
});

test("V3-F3: eine zweite Instanz zaehlt und listet aktive Anrufe sowie Anrufe seit einem Zeitpunkt aus der Datenbank", async () => {
  const { b, callId } = await aufbau();
  assert.deepEqual((await b.activeCallsForSql(KUNDE)).map((call) => call.id), [callId]);
  assert.ok((await b.aktiveAnrufeAlle()).some((call) => call.id === callId));
  assert.equal(await b.zaehleAnrufeSeit(KUNDE, "2000-01-01T00:00:00.000Z"), 1);
});
