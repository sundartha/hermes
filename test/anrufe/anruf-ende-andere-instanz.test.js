import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { findDuplicateOutboundCall } from "../../src/telephony/call-dedup.ts";
import { makeReadRoutes } from "../../src/routes/api-read.ts";
import { startServer, seedState, seedCall } from "../helpers.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
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

test("Anruf auf der anderen Instanz beendet: die anlegende Instanz meldet ihn nicht mehr als laufend und dedupliziert nicht", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: "+4930555000311", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await a.persistCall(call.id);
  const vorher = await a.activeCallsForSql(KUNDE);
  assert.deepEqual(vorher.map((eintrag) => eintrag.id), [call.id]);
  await b.leseCall(call.id);
  await b.endCallRecord(call.id, "completed");
  const nachher = await a.activeCallsForSql(KUNDE);
  assert.deepEqual(nachher, []);
  assert.equal(findDuplicateOutboundCall(nachher, { to: ZIEL, nowMs: Date.parse(call.startedAt) }), null);
});

test("Dublettenantwort von place_call nennt den echten Status des laufenden Anrufs", async () => {
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "+49", ...vorspannMandantenUmgebung(["owner"]), PRECALL_BRIEFING_ENABLED: "false" },
    seed: seedState({ calls: [seedCall({ id: "call_laeuft", to: ZIEL, tenantId: "owner", status: "active" })] }),
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ZIEL, goal: "Test" }),
    });
    const body = await antwort.json();
    assert.equal(body.deduplicated, true);
    assert.equal(body.callId, "call_laeuft");
    assert.equal(body.status, "active");
  } finally {
    await srv.stop();
  }
});
