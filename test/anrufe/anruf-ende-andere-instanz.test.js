import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { findDuplicateOutboundCall } from "../../src/telephony/call-dedup.ts";
import { makeReadRoutes } from "../../src/routes/api-read.ts";
import {
  EL_OUTBOUND_BOOT_ENV,
  mcpPost,
  readToolResult,
  seedCall,
  seedState,
  startIdp,
  startServer,
  toolCall,
} from "../helpers.js";
import { planProfileFor } from "../../src/plans.ts";
import { postgresVorhanden } from "./hermes-mit-postgres.js";
import { beendeAufAnderer, mitZweiSchreibern, ZIEL_DER_ANRUFE } from "./zwei-schreiber-hilfen.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_ende_andere_instanz";
const ZIEL = "+4915112349955";
const ZIEL_NEU = "+4915112349966";
const MCP_KUNDE = "t_ende_mcp";
const MCP_SUB = "sub-ende-mcp";
const MCP_ABSENDER = "+4915110000093";
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

test("Dublettenantwort von POST /api/calls nennt den echten Status des laufenden Anrufs", async () => {
  const srv = await startServer({
    env: { ALLOWED_COUNTRY_CODES: "+49", ...vorspannMandantenUmgebung(["owner"]), PRECALL_BRIEFING_ENABLED: "false" },
    seed: seedState({
      calls: [seedCall({ id: "call_laeuft", to: ZIEL, tenantId: "owner", status: "active", answeredAt: JETZT })],
    }),
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
    assert.equal(body.status, "in_progress");
  } finally {
    await srv.stop();
  }
});

test("Dublettenantwort des MCP-Werkzeugs place_call nennt den echten Status, ein neuer Anruf bleibt dialing", async () => {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      ...EL_OUTBOUND_BOOT_ENV,
      ...vorspannMandantenUmgebung([MCP_KUNDE]),
    },
    seed: seedState({
      calls: [seedCall({ id: "call_mcp_laeuft", to: ZIEL, tenantId: MCP_KUNDE, status: "active", answeredAt: JETZT })],
      tenants: [{ id: MCP_KUNDE, idpSubject: MCP_SUB, status: "active", ownerName: "Kunde", kycLevel: "card" }],
      profiles: { [MCP_KUNDE]: planProfileFor("business") },
      numbers: [
        {
          id: "num_ende_mcp",
          e164: MCP_ABSENDER,
          tenantId: MCP_KUNDE,
          provider: "telnyx",
          status: "active",
          providerNumberId: null,
          providerAgentPhoneNumberId: "phnum_h2t1_1",
        },
      ],
    }),
  });
  try {
    const rufe = async (to) =>
      readToolResult(
        await mcpPost(`${srv.localUrl}/mcp`, await idp.sign({ sub: MCP_SUB }), toolCall("place_call", { to, objective: "Test" })),
      );
    const doppelt = await rufe(ZIEL);
    assert.equal(doppelt.structuredContent.deduplicated, true);
    assert.equal(doppelt.structuredContent.call_id, "call_mcp_laeuft");
    assert.equal(doppelt.structuredContent.status, "in_progress");
    const neu = await rufe(ZIEL_NEU);
    assert.equal(neu.structuredContent.deduplicated, false);
    assert.equal(neu.structuredContent.status, "dialing");
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("Lesefehler bei der Pruefung beendeter Anrufe in activeCallsForSql wird geloggt und geworfen", async (t) => {
  const fehlerLog = [];
  t.mock.method(console, "error", (...teile) => fehlerLog.push(teile));
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  const kaputt = {
    withClient: (fn) =>
      fn({
        query: (text, params) =>
          text.includes("id = ANY") ? Promise.reject(new Error("vorhanden-kaputt")) : db.query(text, params),
        exec: (sql) => db.exec(sql),
      }),
  };
  const store = makePgStore(kaputt);
  await store.init();
  store.createCall({ direction: "outbound", from: "+4930555000311", to: ZIEL, goal: "Test", tenantId: KUNDE });
  await assert.rejects(store.activeCallsForSql(KUNDE), { message: "vorhanden-kaputt" });
  assert.deepEqual(fehlerLog, [["[pg] aktive anrufe lesen fehlgeschlagen:", "vorhanden-kaputt"]]);
});

test("Aktiver Anruf, den die Datenbank noch nicht kennt, bleibt in activeCallsForSql", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const a = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: "+4930555000311", to: ZIEL, goal: "Test", tenantId: KUNDE });
  assert.deepEqual((await a.activeCallsForSql(KUNDE)).map((eintrag) => eintrag.id), [call.id]);
});

test("place_call innerhalb von 180 Sekunden nach dem Ende auf der anderen Instanz legt einen neuen Anruf an", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiSchreibern(t, async ({ a, b, platziere, anbieter }) => {
    const erster = await platziere(a, ZIEL_DER_ANRUFE);
    await beendeAufAnderer(b, erster);
    const antwort = await abrufMitFrist(`${a.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ZIEL_DER_ANRUFE, objective: "Zweiter Auftrag" }),
    });
    const body = await antwort.json();
    assert.equal(body.deduplicated, false);
    assert.notEqual(body.callId, erster);
    assert.equal(body.status, "dialing");
    assert.equal(anbieter.starts().length, 2);
  });
});
