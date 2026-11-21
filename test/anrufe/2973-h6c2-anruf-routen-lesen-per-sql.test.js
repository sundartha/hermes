import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { config } from "../../src/config.ts";
import { makeCallRoutes } from "../../src/routes/api-calls.ts";
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
  return (await db.query("SELECT status, ended_at, consults, billed_at FROM call WHERE id = $1", [id])).rows[0];
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

test("H6c2-1b: der naechste Speichervorgang der Instanz A setzt den auf B abgebrochenen Anruf nicht auf active zurueck", async () => {
  const { db, a, b, call } = await zweiInstanzen();
  await mitServer(routen(b, KUNDE), async (post) => {
    await post(`/api/calls/${call.id}/cancel`);
  });
  const beendetAm = (await zeile(db, call.id)).ended_at;
  assert.ok(beendetAm);
  assert.equal(a.getCall(call.id).status, "active");
  await a.save();
  await a.drainFlushes();
  const danach = await zeile(db, call.id);
  assert.equal(danach.status, "cancelled");
  assert.equal(danach.ended_at, beendetAm);
});

test("H6c2-1d: der naechste Speichervorgang der Instanz A leert die auf B gesetzte Abrechnungsmarke nicht, die Abrechnung gelingt kein zweites Mal", async () => {
  const { db, a, b, call } = await zweiInstanzen();
  await mitServer(routen(b, KUNDE), async (post) => {
    await post(`/api/calls/${call.id}/cancel`);
  });
  assert.ok((await b.markBilled(call.id)).billedAt);
  const gesetzt = (await zeile(db, call.id)).billed_at;
  assert.ok(gesetzt);
  a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Anderer", tenantId: KUNDE, provider: "telnyx" });
  await a.save();
  await a.drainFlushes();
  assert.equal((await zeile(db, call.id)).billed_at, gesetzt);
  await a.markBilled(call.id);
  assert.equal((await zeile(db, call.id)).billed_at, gesetzt);
});

const MARKEN_UND_KOSTEN = [
  ["summary_sms_sent_at", "2030-01-02T03:04:05.000Z"],
  ["summary_mail_sent_at", "2030-01-02T03:04:06.000Z"],
  ["not_placed_mail_sent_at", "2030-01-02T03:04:07.000Z"],
  ["estimated_cost_cents", 42],
  ["actual_cost_micro_cents", 4242],
  ["cost_trued_at", "2030-01-02T03:04:08.000Z"],
  ["cost_trued_source", "telnyx"],
];

for (const [spalte, wert] of MARKEN_UND_KOSTEN) {
  test(`H6c2-1e: das Speichern der Instanz A leert ${spalte} der Zeile nicht`, async () => {
    const { db, a, call } = await zweiInstanzen();
    await setzeKontext(db, KUNDE);
    await db.query(`UPDATE call SET ${spalte} = $1 WHERE id = $2`, [wert, call.id]);
    await a.save();
    await a.drainFlushes();
    await setzeKontext(db, KUNDE);
    const { rows } = await db.query(`SELECT ${spalte} AS wert FROM call WHERE id = $1`, [call.id]);
    assert.notEqual(rows[0].wert, null);
  });
}

test("H6c2-1c: beendet die Instanz den Anruf nur im Spiegel, schreibt ihr Speichern Status und Ende in die aktive Zeile", async () => {
  const { db, a, call } = await zweiInstanzen();
  const eigener = a.getCall(call.id);
  eigener.status = "completed";
  eigener.endedAt = "2030-01-02T03:04:05.000Z";
  await a.save();
  await a.drainFlushes();
  const danach = await zeile(db, call.id);
  assert.equal(danach.status, "completed");
  assert.equal(danach.ended_at, "2030-01-02T03:04:05.000Z");
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

