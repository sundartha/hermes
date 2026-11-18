import assert from "node:assert/strict";
import { test } from "node:test";

import { withStoreLock, zustandsFunktionen } from "../../src/store.js";
import { makeCostTruing, SWEEP_TRIGGER } from "../../src/billing/cost-truing.ts";
import { fakeConfig, fakeSpies, fakeVoiceControl } from "../cost-truing-harness.js";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_h7c2b4b1_kunde";
const ANRUF_ABSENDER = "+4930555000312";
const ANRUF_ZIEL = "+4915112349934";
const LESEFEHLER = "Lesen kaputt (h7c2b4b1-sweep)";
const ALT_MIN = 600;
const MS_JE_MIN = 60_000;

const kontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

function runnerFuer(db, zustand) {
  return {
    withClient: (arbeit) =>
      arbeit({
        query: (text, params) => {
          if (zustand.schluesselLeer && String(text).includes("anruf_schluessel")) return Promise.resolve({ rows: [] });
          if (zustand.lesenKaputt && String(text).includes("FROM call WHERE tenant_id")) return Promise.reject(new Error(LESEFEHLER));
          return db.query(text, params);
        },
        exec: (sql) => db.exec(sql),
      }),
  };
}

async function neueInstanz(db, zustand = {}) {
  const store = makePgStore(runnerFuer(db, zustand));
  store.withStoreLock = withStoreLock;
  Object.assign(store, zustandsFunktionen(store));
  await store.init();
  return store;
}

async function aufbau() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await kontext(db, KUNDE);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const zustandB = {};
  const a = await neueInstanz(db);
  const b = await neueInstanz(db, zustandB);
  return { db, a, b, zustandB };
}

async function beendeterAnruf(store) {
  const call = store.createCall({ direction: "outbound", from: ANRUF_ABSENDER, to: ANRUF_ZIEL, goal: "Test", tenantId: KUNDE });
  await store.persistCall(call.id);
  const angelegt = store.getCall(call.id);
  angelegt.status = "completed";
  angelegt.answeredAt = new Date(Date.now() - (ALT_MIN + 1) * MS_JE_MIN).toISOString();
  angelegt.endedAt = new Date(Date.now() - ALT_MIN * MS_JE_MIN).toISOString();
  store.save();
  await store.drainFlushes();
  return call.id;
}

function sweepVon(store) {
  const { mailer, messaging } = fakeSpies();
  const { runCostTruingSweep } = makeCostTruing({
    store,
    config: fakeConfig(),
    voiceControl: fakeVoiceControl({}),
    audit: () => {},
    mailer,
    messaging,
  });
  return runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
}

test("H7c2b4b1-1: der Sweep einer Instanz nimmt einen beendeten Anruf auf, den nur die Datenbank kennt, als Kandidat", async () => {
  const { a, b } = await aufbau();
  await beendeterAnruf(a);
  const ergebnis = await sweepVon(b);
  assert.equal(ergebnis.candidates, 1);
  assert.equal(ergebnis.skipped, false);
});

test("H7c2b4b1-2: der Sweep wirft bei Lesefehler und meldet nie null Kandidaten", async () => {
  const { a, b, zustandB } = await aufbau();
  await beendeterAnruf(a);
  zustandB.lesenKaputt = true;
  await assert.rejects(sweepVon(b), { message: LESEFEHLER });
  zustandB.lesenKaputt = false;
  assert.equal((await sweepVon(b)).candidates, 1);
});

test("H7c2b4b1-5: ein Anruf, der beim Binden nicht mehr in der Datenbank steht, ist kein Kandidat und der Sweep laeuft weiter", async () => {
  const { a, b, zustandB } = await aufbau();
  await beendeterAnruf(a);
  zustandB.schluesselLeer = true;
  const ergebnis = await sweepVon(b);
  assert.equal(ergebnis.candidates, 0);
  assert.equal(ergebnis.skipped, false);
});
