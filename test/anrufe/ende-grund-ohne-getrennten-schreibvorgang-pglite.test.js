import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_ende_grund_ohne_flush";
const ZIEL = "+4915112349933";
const ENDE = "2030-01-02T03:04:05.000Z";

const FLUSH_SCHREIBT_ENDE = "status=CASE WHEN call.status = 'active' THEN EXCLUDED.status ELSE call.status END";
const FLUSH_SCHREIBT_ENDZEIT = "ended_at=CASE WHEN call.status = 'active' THEN EXCLUDED.ended_at ELSE call.ended_at END";
const FLUSH_SCHREIBT_GRUND = "failure_reason=EXCLUDED.failure_reason";

const OHNE_GRUND_IM_FLUSH = (text) =>
  text
    .replace(FLUSH_SCHREIBT_ENDE, "status=call.status")
    .replace(FLUSH_SCHREIBT_ENDZEIT, "ended_at=call.ended_at")
    .replace(FLUSH_SCHREIBT_GRUND, "failure_reason=call.failure_reason");

const runnerFuer = (db) => ({
  withClient: (fn) =>
    fn({ query: (text, params) => db.query(OHNE_GRUND_IM_FLUSH(text), params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function mitKunden(db) {
  await neueInstanz(db);
  await setzeKontext(db, KUNDE);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  return neueInstanz(db);
}

async function legeAn(store) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000300", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await store.persistCall(call.id);
  return call;
}

async function zeile(db, callId) {
  await setzeKontext(db, KUNDE);
  const { rows } = await db.query(`SELECT status, failure_reason FROM call WHERE id = $1`, [callId]);
  return rows[0];
}

test("Ende-Grund: steht der Grund auch ohne getrennten Schreibvorgang beim beendeten Status", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const store = await mitKunden(db);
  const call = await legeAn(store);
  store.recordFailureReason(call.id, "budget-exhausted");
  await store.setCallEndedAt(call.id, "completed", ENDE);
  assert.deepEqual(await zeile(db, call.id), { status: "completed", failure_reason: "budget-exhausted" });
});

test("Ende-Grund: endCallRecord schreibt den Grund ebenso ohne getrennten Schreibvorgang, und ohne Grund bleibt die Spalte leer", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const store = await mitKunden(db);
  const mit = await legeAn(store);
  store.recordFailureReason(mit.id, "max-duration");
  await store.endCallRecord(mit.id, "failed");
  assert.deepEqual(await zeile(db, mit.id), { status: "failed", failure_reason: "max-duration" });
  const ohne = await legeAn(store);
  await store.endCallRecord(ohne.id);
  assert.deepEqual(await zeile(db, ohne.id), { status: "completed", failure_reason: null });
});
