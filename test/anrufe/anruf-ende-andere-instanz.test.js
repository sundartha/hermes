import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeReadRoutes } from "../../src/routes/api-read.ts";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_ende_andere_instanz";
const ZIEL = "+4915112349955";
const JETZT = "2026-11-22T18:50:00.000Z";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function abfrage(store, callId) {
  const tenant = {
    requestTenant: () => KUNDE,
    requireTenant: () => KUNDE,
    tenantOwnsCall: (call, tenantId) => call.tenantId === tenantId,
  };
  const app = express();
  app.use(makeReadRoutes({ store, config: {}, audit: () => {}, tenant }));
  const http = await new Promise((listening) => {
    const server = app.listen(0, () => listening(server));
  });
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${http.address().port}/api/calls/${callId}`);
    return await antwort.json();
  } finally {
    await new Promise((closed) => http.close(closed));
  }
}

test("Nachlauf beginnt auf der anderen Instanz: die anlegende Instanz zeigt sofort completed", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: "+4930555000311", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await a.persistCall(call.id);
  assert.equal((await abfrage(a, call.id)).status, "active");
  await b.leseCall(call.id);
  await b.markInboundElNachlaufStarted(call.id, JETZT);
  assert.equal((await abfrage(b, call.id)).status, "completed");
  assert.equal((await abfrage(a, call.id)).status, "completed");
});
