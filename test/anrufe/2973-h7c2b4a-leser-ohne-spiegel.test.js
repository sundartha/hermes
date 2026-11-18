import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store/bereiche.js";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_h7c2b4a_kunde";
const FREMD = "t_h7c2b4a_fremd";
const ABSENDER = "+4930555000300";
const ZIEL = "+4915112349922";
const OFFEN_MS = 60_000;
const VOR_MS = 5_000;
const LESEFEHLER = "Lesen kaputt (h7c2b4a-test)";

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
  for (const id of [KUNDE, FREMD]) {
    await kontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  const zustandB = {};
  const a = await neueInstanz(db);
  const b = await neueInstanz(db, zustandB);
  return { db, a, b, zustandB };
}

async function anrufMitOffenerFrage(store, tenantId) {
  const call = store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId });
  await store.persistCall(call.id);
  const angelegt = store.getCall(call.id);
  angelegt.answeredAt = new Date(Date.now() - VOR_MS).toISOString();
  store.emitConsult(call.id, ["Passt Donnerstag?"]);
  store.save();
  await store.drainFlushes();
  return call.id;
}

async function frageStatus(db, tenantId, callId) {
  await kontext(db, tenantId);
  const { rows } = await db.query(`SELECT consults FROM call WHERE id = $1`, [callId]);
  const [frage] = rows[0].consults;
  return frage.status;
}

const abschluss = (store, callId) =>
  speicherBereiche(store).rueckfrageAbschluss.verwaisteSchliessen(callId, { nowMs: Date.now(), openMs: OFFEN_MS });

test("H7c2b4a-1: verwaisteSchliessen schliesst die offene Rueckfrage eines Anrufs, den nur die Datenbank kennt", async () => {
  const { db, a, b } = await aufbau();
  const eigener = await anrufMitOffenerFrage(a, KUNDE);
  const fremder = await anrufMitOffenerFrage(a, FREMD);
  await abschluss(b, eigener);
  await b.drainFlushes();
  assert.equal(await frageStatus(db, KUNDE, eigener), "expired");
  assert.equal(await frageStatus(db, FREMD, fremder), "open");
});

test("H7c2b4a-2: verwaisteSchliessen wirft bei Lesefehler und schliesst nichts, nie als nicht gefunden", async () => {
  const { db, a, b, zustandB } = await aufbau();
  const callId = await anrufMitOffenerFrage(a, KUNDE);
  zustandB.lesenKaputt = true;
  await assert.rejects(abschluss(b, callId), { message: LESEFEHLER });
  zustandB.lesenKaputt = false;
  assert.equal(await frageStatus(db, KUNDE, callId), "open");
});
