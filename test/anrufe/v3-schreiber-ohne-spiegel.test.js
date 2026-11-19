import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_v3_kunde";
const ABSENDER = "+4930555000377";
const ZIEL = "+4915112349977";
const LESEFEHLER = "Lesen kaputt (v3-test)";
const ABGLEICH = { source: "telnyx_detail_records", actualCostMicroCents: 4321, closedAt: "2030-01-02T03:04:05.000Z" };

const kontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

function runnerFuer(db, zustand) {
  return {
    withClient: (arbeit) =>
      arbeit({
        query: (text, params) => {
          if (zustand.lesenKaputt && String(text).includes("anruf_schluessel")) return Promise.reject(new Error(LESEFEHLER));
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function neueInstanz(db, zustand = {}) {
  const store = makePgStore(runnerFuer(db, zustand));
  await store.init();
  return store;
}

async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await kontext(db, KUNDE);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const zustandB = {};
  const b = await neueInstanz(db, zustandB);
  const a = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  await a.persistCall(call.id);
  await a.endCallRecord(call.id, "completed");
  await a.drainFlushes();
  return { db, b, zustandB, callId: call.id };
}

async function zeile(db, callId) {
  await kontext(db, KUNDE);
  const { rows } = await db.query(
    `SELECT billed_at, actual_cost_micro_cents, cost_trued_source, cost_trued_at FROM call WHERE id = $1`,
    [callId],
  );
  return rows[0];
}

async function transkript(db, callId) {
  await kontext(db, KUNDE);
  const { rows } = await db.query(`SELECT role, text FROM transcript_segment WHERE call_id = $1 ORDER BY id`, [callId]);
  return rows;
}

test("V3-1: Kostenabgleich und markBilled schreiben die Zeile eines Anrufs, den nur die Datenbank kennt", async () => {
  const { db, b, callId } = await aufbau();
  await b.recordCallCostTruingResult(callId, ABGLEICH);
  await b.markBilled(callId);
  await b.drainFlushes();
  const gelesen = await zeile(db, callId);
  assert.equal(Number(gelesen.actual_cost_micro_cents), 4321);
  assert.equal(gelesen.cost_trued_source, "telnyx_detail_records");
  assert.equal(gelesen.cost_trued_at, "2030-01-02T03:04:05.000Z");
  assert.ok(gelesen.billed_at);
});

test("V3-2: addTranscript schreibt die Transkriptzeile eines Anrufs, den nur die Datenbank kennt", async () => {
  const { db, b, callId } = await aufbau();
  await b.addTranscript(callId, "callee", "Hallo von B");
  await b.drainFlushes();
  assert.deepEqual(await transkript(db, callId), [{ role: "callee", text: "Hallo von B" }]);
});

test("V3-3: ein Lesefehler laesst den Schreiber ablehnen, die Zeile bleibt unveraendert", async () => {
  const { db, b, zustandB, callId } = await aufbau();
  zustandB.lesenKaputt = true;
  await assert.rejects(b.markBilled(callId), { message: LESEFEHLER });
  await assert.rejects(b.addTranscript(callId, "callee", "verloren"), { message: LESEFEHLER });
  zustandB.lesenKaputt = false;
  assert.equal((await zeile(db, callId)).billed_at, null);
  assert.deepEqual(await transkript(db, callId), []);
});

test("V3-4: ein Anruf, den es nicht gibt, wird nicht geschrieben", async () => {
  const { db, b } = await aufbau();
  assert.equal(await b.addTranscript("call_gibt_es_nicht", "callee", "x"), undefined);
  const { call } = { call: await b.markBilled("call_gibt_es_nicht") };
  assert.ok(!call?.billedAt);
  await b.drainFlushes();
  await kontext(db, KUNDE);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM transcript_segment`);
  assert.equal(rows[0].n, 0);
});

test("V3-5: purgeTranscript loescht die Zeilen eines Anrufs, den nur die Datenbank kennt", async () => {
  const { db, b, callId } = await aufbau();
  await b.addTranscript(callId, "callee", "weg damit");
  await b.drainFlushes();
  assert.equal((await transkript(db, callId)).length, 1);
  await b.purgeTranscript(callId);
  assert.deepEqual(await transkript(db, callId), []);
});
