import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";
import { mitInstanzHinterRelais } from "./zwei-instanzen-postgres.js";

const HTTP_FEHLER = 500;
const FREMDER_ANRUF = "call_h7c2b5b_fremd";
const SIGNUP_TENANT_ID = "signup_h7c2b5b";
const SIGNUP_ANRUF = "call_h7c2b5b_signup";
const SPIEGEL_SQL = "SELECT id FROM call WHERE id = $1";

const neuerAnruf = () => ({ direction: "outbound", from: "+4930555000300", to: "+4915112345678", tenantId: BOOTSTRAP_TENANT_ID });
const idsImSpiegel = (store) => store.load().calls.map((call) => call.id);

test("H7c2b5b-1: nach init enthaelt der Spiegel keinen Anruf einer anderen Instanz, eigene und angehaengte schon", async () => {
  const { store: a, runner } = await makePgTestStore();
  const fremd = a.createCall(neuerAnruf());
  await a.persistCall(fremd.id);
  const b = makePgStore(runner);
  await b.init();
  assert.deepEqual(idsImSpiegel(b), []);
  const eigen = b.createCall(neuerAnruf());
  assert.deepEqual(idsImSpiegel(b), [eigen.id]);
  assert.equal((await b.leseCall(fremd.id)).id, fremd.id);
  assert.deepEqual(idsImSpiegel(b).sort(), [eigen.id, fremd.id].sort());
});

test("H7c2b5b-2: ensureTenant legt keinen Anruf des Mandanten in den Spiegel, die Zeile ueberlebt den Flush", async () => {
  const { store, db } = await makePgTestStore();
  await db.query(`INSERT INTO tenant (id) VALUES ($1)`, [SIGNUP_TENANT_ID]);
  await db.query(
    `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, ended_at)
     VALUES ($1, $2, 'tok', 'inbound', 'completed', now()::text, now()::text)`,
    [SIGNUP_ANRUF, SIGNUP_TENANT_ID],
  );
  assert.equal(await store.ensureTenant(SIGNUP_TENANT_ID), true);
  assert.deepEqual(idsImSpiegel(store), []);
  store.save();
  await store.drainFlushes();
  assert.equal((await db.query(SPIEGEL_SQL, [SIGNUP_ANRUF])).rows.length, 1);
});

test("H7c2b5b-3: hängt die Datenbank, antwortet GET /api/calls/:id für einen Anruf von Instanz A mit 500, nie mit 404 oder Anrufkörper", async (t) => {
  await mitInstanzHinterRelais(t, { anrufe: [FREMDER_ANRUF] }, async ({ a: b, relais }) => {
    relais.anhalten();
    try {
      const antwort = await abrufMitFrist(`${b.localUrl}/api/calls/${FREMDER_ANRUF}`);
      assert.equal(antwort.status, HTTP_FEHLER);
      assert.equal((await antwort.json()).id, undefined);
    } finally {
      relais.fortsetzen();
    }
  });
});
