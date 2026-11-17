import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { config } from "../../src/config.js";
import { makeCallRoutes } from "../../src/routes/api-calls.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

config.tenancy.consultEnabled = true;
config.tenancy.assistantContextEnabled = true;

const KUNDE = "t_h6c2_kunde";
const FREMD = "t_h6c2_fremd";
const ZIEL = "+4915112349955";
const ABSENDER = "+4930555000320";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function zweiInstanzen() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  for (const id of [KUNDE, FREMD]) {
    await setzeKontext(db, id);
    await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [id]);
  }
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  a.emitConsult(call.id, ["Passt Donnerstag?"]);
  await a.persistCall(call.id);
  const { consults } = a.getCall(call.id);
  const eventId = consults[0].id;
  return { db, a, b, call, eventId };
}

async function zeile(db, id) {
  await setzeKontext(db, KUNDE);
  return (await db.query("SELECT status, consults FROM call WHERE id = $1", [id])).rows[0];
}

const kaputtMachen = (db) => db.exec("ALTER TABLE anruf_schluessel RENAME TO anruf_schluessel_versteckt");

function routen(store, mandant) {
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store: Object.assign(Object.create(store), { resolveProfile: () => ({ allowConsult: true }) }),
      config,
      audit: () => {},
      terminateAndBillCall: async ({ persistEnd }) => {
        await persistEnd();
      },
      hangUpAction: () => async () => {},
      billThunk: () => async () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: {
        requestTenant: () => mandant,
        requireTenant: () => mandant,
        tenantOwnsCall: (call, tenantId) => call.tenantId === tenantId,
      },
      internalIdentity: () => "intern",
      OWNER_ID: "owner",
    }),
  );
  return app;
}

async function mitServer(app, fn) {
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    await fn(async (pfad, koerper = {}) => {
      const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(koerper),
      });
      return { status: antwort.status, text: await antwort.text() };
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function ohneLog(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = original;
  }
}

test("H6c2-1: POST /api/calls/:id/cancel auf Instanz B beendet den Anruf von Instanz A in der Datenbank", async () => {
  const { db, b, call } = await zweiInstanzen();
  await mitServer(routen(b, KUNDE), async (post) => {
    const antwort = await post(`/api/calls/${call.id}/cancel`);
    assert.equal(antwort.status, 200);
    assert.deepEqual(JSON.parse(antwort.text), { status: "cancelled" });
  });
  assert.equal((await zeile(db, call.id)).status, "cancelled");
});

test("H6c2-2: cancel mit Lesefehler der Datenbank antwortet 500 statt 404 und beendet den Anruf nicht", async () => {
  const { db, b, call } = await zweiInstanzen();
  await kaputtMachen(db);
  await ohneLog(() =>
    mitServer(routen(b, KUNDE), async (post) => {
      const antwort = await post(`/api/calls/${call.id}/cancel`);
      assert.equal(antwort.status, 500);
    }),
  );
  assert.equal((await zeile(db, call.id)).status, "active");
});

test("H6c2-3: cancel eines unbekannten Anrufs und eines fremden Mandanten antwortet weiter 404 not found", async () => {
  const { b, call } = await zweiInstanzen();
  await mitServer(routen(b, KUNDE), async (post) => {
    const unbekannt = await post("/api/calls/call_gibt_es_nicht/cancel");
    assert.equal(unbekannt.status, 404);
    assert.deepEqual(JSON.parse(unbekannt.text), { error: "not found" });
  });
  await mitServer(routen(b, FREMD), async (post) => {
    const fremd = await post(`/api/calls/${call.id}/cancel`);
    assert.equal(fremd.status, 404);
    assert.deepEqual(JSON.parse(fremd.text), { error: "not found" });
  });
});

test("H6c2-4: consult/answer auf Instanz B beantwortet die Rueckfrage des Anrufs von Instanz A", async () => {
  const { b, call, eventId } = await zweiInstanzen();
  await mitServer(routen(b, KUNDE), async (post) => {
    const antwort = await post(`/api/calls/${call.id}/consult/answer`, { event_id: eventId, answers: ["Donnerstag passt"] });
    assert.equal(antwort.status, 200);
    assert.deepEqual(JSON.parse(antwort.text), { accepted: true, merged_facts: 1 });
  });
});

test("H6c2-5: consult/answer mit Lesefehler der Datenbank antwortet 500 statt 404", async () => {
  const { db, b, call, eventId } = await zweiInstanzen();
  await kaputtMachen(db);
  await ohneLog(() =>
    mitServer(routen(b, KUNDE), async (post) => {
      const antwort = await post(`/api/calls/${call.id}/consult/answer`, { event_id: eventId, answers: ["x"] });
      assert.equal(antwort.status, 500);
    }),
  );
});

test("H6c2-6: consult/answer eines unbekannten Anrufs und eines fremden Mandanten antwortet weiter 404 not found", async () => {
  const { b, call, eventId } = await zweiInstanzen();
  await mitServer(routen(b, KUNDE), async (post) => {
    const unbekannt = await post("/api/calls/call_gibt_es_nicht/consult/answer", { event_id: eventId, answers: ["x"] });
    assert.equal(unbekannt.status, 404);
    assert.deepEqual(JSON.parse(unbekannt.text), { error: "not found" });
  });
  await mitServer(routen(b, FREMD), async (post) => {
    const fremd = await post(`/api/calls/${call.id}/consult/answer`, { event_id: eventId, answers: ["x"] });
    assert.equal(fremd.status, 404);
  });
});
