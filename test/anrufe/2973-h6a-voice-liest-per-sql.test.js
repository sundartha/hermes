import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeVoiceRoutes } from "../../src/routes/voice.ts";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { waitUntil as warteBis } from "../helpers.js";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_h6a_kunde";
const ZIEL = "+4915112349944";
const ABSENDER = "+4930555000310";

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
  await setzeKontext(db, KUNDE);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  await a.persistCall(call.id);
  return { db, a, b, call };
}

async function zeile(db, id) {
  await setzeKontext(db, KUNDE);
  return (await db.query("SELECT status, answered_at FROM call WHERE id = $1", [id])).rows[0];
}

const kaputtMachen = (db) => db.exec("ALTER TABLE anruf_schluessel RENAME TO anruf_schluessel_versteckt");

function routen(store, protokoll) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: withConfigNamespaces({
        skipTwilioSignatureCheck: true,
        machineDetection: { enabled: false, timeoutS: 25 },
        publicUrl: "https://hermes.test",
        elevenLabsInbound: { sipUser: "u", sipPassword: "p".repeat(32), begruessungslautEnabled: false },
      }),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: async () => null },
      lifecycle: {
        reattachActiveCall: async (callId) => {
          protokoll.wiederaufnahmen.push(callId);
          return protokoll.anbindung;
        },
      },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
      inboundBridges: { armBindingDeadline: (id) => protokoll.fristen.push(id) },
      vorspannAblauf: { behandle: async ({ call }) => protokoll.vorspann.push(call.id) },
    }),
  );
  return app;
}

const neuesProtokoll = () => ({
  wiederaufnahmen: [],
  fristen: [],
  vorspann: [],
  anbindung: { call: null, logUnknown: false },
});

async function mitServer(app, fn) {
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    await fn(async (pfad, felder = {}) => {
      const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(felder).toString(),
      });
      await antwort.text();
      return antwort;
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function ohneLog(fn) {
  const original = console.error;
  const zeilen = [];
  console.error = (...teile) => zeilen.push(teile.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return zeilen;
}

test("H6a-5: /voice/status auf Instanz B findet den Anruf von Instanz A in der Datenbank und markiert ihn als angenommen", async () => {
  const { db, b, call } = await zweiInstanzen();
  const protokoll = neuesProtokoll();
  await mitServer(routen(b, protokoll), async (post) => {
    const antwort = await post(`/voice/status?callId=${call.id}`, { CallStatus: "in-progress" });
    assert.equal(antwort.status, 200);
  });
  assert.notEqual((await zeile(db, call.id)).answered_at, null);
});

test("H6a-6: /voice/status mit Lesefehler antwortet 200, protokolliert, versucht die Wiederanbindung dreimal und beendet den Anruf nicht", async () => {
  const { db, b, call } = await zweiInstanzen();
  await kaputtMachen(db);
  const protokoll = neuesProtokoll();
  protokoll.anbindung = { call: null, logUnknown: false, fehlgeschlagen: true };
  const zeilen = await ohneLog(() =>
    mitServer(routen(b, protokoll), async (post) => {
      const antwort = await post(`/voice/status?callId=${call.id}`, { CallStatus: "completed" });
      assert.equal(antwort.status, 200);
      await warteBis(() => protokoll.wiederaufnahmen.length === 3, { timeoutMs: 5000 });
    }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes(`[voice/status] Anruf lesen fehlgeschlagen (callId=${call.id})`)));
  assert.deepEqual(protokoll.wiederaufnahmen, [call.id, call.id, call.id]);
  const gespeichert = await zeile(db, call.id);
  assert.equal(gespeichert.status, "active");
  assert.equal(gespeichert.answered_at, null);
});

test("H6a-7: das Vorspann-Ereignis auf Instanz B erreicht den Ablauf mit dem Anruf von Instanz A", async () => {
  const { b, call } = await zweiInstanzen();
  const protokoll = neuesProtokoll();
  await mitServer(routen(b, protokoll), async (post) => {
    const antwort = await post(`/voice/vorspann?callId=${call.id}`, { event: "x" });
    assert.equal(antwort.status, 200);
  });
  assert.deepEqual(protokoll.vorspann, [call.id]);
});

test("H6a-8: das Vorspann-Ereignis mit Lesefehler antwortet 200, protokolliert und startet keinen Ablauf", async () => {
  const { db, b, call } = await zweiInstanzen();
  await kaputtMachen(db);
  const protokoll = neuesProtokoll();
  const zeilen = await ohneLog(() =>
    mitServer(routen(b, protokoll), async (post) => {
      const antwort = await post(`/voice/vorspann?callId=${call.id}`, { event: "x" });
      assert.equal(antwort.status, 200);
    }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes(`[vorspann] Anruf lesen fehlgeschlagen (callId=${call.id})`)));
  assert.deepEqual(protokoll.vorspann, []);
});

test("H6a-9: das EL-Bein-Ereignis mit Lesefehler antwortet 200, protokolliert und setzt keine Frist", async () => {
  const { db, b, call } = await zweiInstanzen();
  await kaputtMachen(db);
  const protokoll = neuesProtokoll();
  const zeilen = await ohneLog(() =>
    mitServer(routen(b, protokoll), async (post) => {
      const antwort = await post(`/voice/el-bein?callId=${call.id}`, { event: "x" });
      assert.equal(antwort.status, 200);
    }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes(`[el-bein] Anruf lesen fehlgeschlagen (callId=${call.id})`)));
  assert.deepEqual(protokoll.fristen, []);
});

test("H6a-10: ein Ereignis ohne Anruf-Kennung und mit Lesefehler wird mit callId=- protokolliert und beantwortet", async () => {
  const { db, b } = await zweiInstanzen();
  await kaputtMachen(db);
  const protokoll = neuesProtokoll();
  const zeilen = await ohneLog(() =>
    mitServer(routen(b, protokoll), async (post) => {
      const antwort = await post("/voice/vorspann", { event: "x" });
      assert.equal(antwort.status, 200);
    }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes("[vorspann] Anruf lesen fehlgeschlagen (callId=-)")));
  assert.deepEqual(protokoll.vorspann, []);
});

async function elAnrufVonA() {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await setzeKontext(db, KUNDE);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "inbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  call.costProfile = "telnyx_inbound_el_convai";
  await a.persistCall(call.id);
  return { a, b, call };
}

test("H6a-11: das EL-Bein-Ereignis auf Instanz B setzt für einen Anruf von Instanz A keine Bindungsfrist", async () => {
  const { b, call } = await elAnrufVonA();
  const protokoll = neuesProtokoll();
  await mitServer(routen(b, protokoll), async (post) => {
    const antwort = await post(`/voice/el-bein?callId=${call.id}`, { CallStatus: "in-progress" });
    assert.equal(antwort.status, 200);
  });
  assert.deepEqual(protokoll.fristen, []);
});

test("H6a-12: das EL-Bein-Ereignis auf der bewachenden Instanz A setzt die Bindungsfrist", async () => {
  const { a, call } = await elAnrufVonA();
  const protokoll = neuesProtokoll();
  await mitServer(routen(a, protokoll), async (post) => {
    const antwort = await post(`/voice/el-bein?callId=${call.id}`, { CallStatus: "in-progress" });
    assert.equal(antwort.status, 200);
  });
  await warteBis(() => protokoll.fristen.length > 0);
  assert.deepEqual(protokoll.fristen, [call.id]);
});

test("H6a-11b: das EL-Bein-Ereignis auf Instanz B hängt den Anruf von Instanz A nicht in den Spiegel von B", async () => {
  const { b, call } = await elAnrufVonA();
  const protokoll = neuesProtokoll();
  await mitServer(routen(b, protokoll), async (post) => {
    const antwort = await post(`/voice/el-bein?callId=${call.id}`, { CallStatus: "in-progress" });
    assert.equal(antwort.status, 200);
  });
  assert.equal(b.getCall(call.id), null);
});

test("H6a-12b: ein EL-Bein-Ereignis ohne Annahme setzt auf der bewachenden Instanz keine Bindungsfrist", async () => {
  const { a, call } = await elAnrufVonA();
  const protokoll = neuesProtokoll();
  await mitServer(routen(a, protokoll), async (post) => {
    const antwort = await post(`/voice/el-bein?callId=${call.id}`, { CallStatus: "ringing" });
    assert.equal(antwort.status, 200);
  });
  assert.deepEqual(protokoll.fristen, []);
});

test("H6a-13: /voice/status ohne Anruf-Kennung und mit Lesefehler antwortet 200 und protokolliert callId=-", async () => {
  const { db, b } = await zweiInstanzen();
  await kaputtMachen(db);
  const protokoll = neuesProtokoll();
  const zeilen = await ohneLog(() =>
    mitServer(routen(b, protokoll), async (post) => {
      const antwort = await post("/voice/status", { CallStatus: "completed", CallSid: "CA_h6a_13_unbekannt" });
      assert.equal(antwort.status, 200);
    }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes("[voice/status] Anruf lesen fehlgeschlagen (callId=-)")));
});

test("H6a-14: das EL-Bein-Ereignis ohne Anruf-Kennung und mit Lesefehler antwortet 200 und protokolliert callId=-", async () => {
  const { db, b } = await zweiInstanzen();
  await kaputtMachen(db);
  const protokoll = neuesProtokoll();
  const zeilen = await ohneLog(() =>
    mitServer(routen(b, protokoll), async (post) => {
      const antwort = await post("/voice/el-bein", { event: "x" });
      assert.equal(antwort.status, 200);
    }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes("[el-bein] Anruf lesen fehlgeschlagen (callId=-)")));
  assert.deepEqual(protokoll.fristen, []);
});
