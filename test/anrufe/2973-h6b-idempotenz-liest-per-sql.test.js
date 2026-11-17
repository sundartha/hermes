import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { makeVoiceRoutes } from "../../src/routes/voice.js";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { waitUntil as warteBis } from "../helpers.js";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE = "t_h6b_kunde";
const ZIEL = "+4915112349955";
const ABSENDER = "+4930555000320";
const KEEPALIVE = "<Response>keepalive</Response>";

const runnerFuer = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

const setzeKontext = (db, tenantId) => db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);

async function neueInstanz(db) {
  const store = makePgStore(runnerFuer(db));
  await store.init();
  return store;
}

async function zweiInstanzen(felder) {
  const db = await pgliteAlsRolleOhneSuperuser();
  await neueInstanz(db);
  await setzeKontext(db, KUNDE);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const a = await neueInstanz(db);
  const b = await neueInstanz(db);
  const call = a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: KUNDE, provider: "telnyx" });
  Object.assign(call, felder);
  await a.persistCall(call.id);
  return { db, a, b, call };
}

const uebergabeAnruf = () => ({
  costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
  answeredAt: "2026-11-17T10:00:00.000Z",
  elevenlabsConversationId: "conv_h6b",
});

const kaputtMachen = (db) => db.exec("ALTER TABLE anruf_schluessel RENAME TO anruf_schluessel_versteckt");
const reparieren = (db) => db.exec("ALTER TABLE anruf_schluessel_versteckt RENAME TO anruf_schluessel");

const neuesProtokoll = () => ({ wiederaufnahmen: [], audits: [] });

function appMit(store, protokoll, ankuenfte = []) {
  const app = express();
  app.use((_req, _res, next) => {
    ankuenfte.push(Date.now());
    next();
  });
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
      audit: (art) => protokoll.audits.push(art),
      voiceRender: { render: () => KEEPALIVE, turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: async () => null },
      lifecycle: {
        reattachActiveCall: async (callId) => {
          protokoll.wiederaufnahmen.push(callId);
          return { call: null, logUnknown: false };
        },
      },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
      inboundBridges: { armBindingDeadline: () => {} },
      vorspannAblauf: { behandle: async () => {} },
    }),
  );
  return app;
}

async function mitServer(app, fn) {
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    await fn((pfad, felder = {}) =>
      abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(felder).toString(),
      }),
    );
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

test("H6b-1: die Uebergabe auf Instanz B erkennt einen laufenden Uebergabe-Anruf von Instanz A und beantwortet nur mit Keep-alive", async () => {
  const { b, call } = await zweiInstanzen(uebergabeAnruf());
  const laeufe = neuesProtokoll();
  await mitServer(appMit(b, laeufe), async (post) => {
    const antwort = await post(`/voice/outbound?callId=${call.id}`, { CallSid: "CA_h6b_1" });
    assert.equal(antwort.status, 200);
    assert.equal(await antwort.text(), KEEPALIVE);
  });
  assert.deepEqual(laeufe, neuesProtokoll());
});

test("H6b-2: die Uebergabe auf Instanz B verarbeitet einen Anruf von Instanz A ohne Uebergabe-Profil wie bisher", async () => {
  const { b, call } = await zweiInstanzen({});
  const laeufe = neuesProtokoll();
  await mitServer(appMit(b, laeufe), async (post) => {
    const antwort = await post(`/voice/outbound?callId=${call.id}`, { CallSid: "CA_h6b_2" });
    assert.equal(antwort.status, 200);
  });
  assert.deepEqual(laeufe.wiederaufnahmen, [call.id]);
});

test("H6b-3: /voice/incoming auf Instanz B erkennt die Zustellung eines Anrufs von Instanz A an der Anbieter-Kennung und beantwortet nur mit Keep-alive", async () => {
  const { b } = await zweiInstanzen({ twilioSid: "CA_h6b_3" });
  const laeufe = neuesProtokoll();
  await mitServer(appMit(b, laeufe), async (post) => {
    const antwort = await post("/voice/incoming", { CallSid: "CA_h6b_3" });
    assert.equal(antwort.status, 200);
    assert.equal(await antwort.text(), KEEPALIVE);
  });
  assert.deepEqual(laeufe, neuesProtokoll());
});

test("H6b-4: /voice/incoming mit unbekannter Anbieter-Kennung auf Instanz B wird normal verarbeitet", async () => {
  const { b } = await zweiInstanzen({ twilioSid: "CA_h6b_4" });
  const laeufe = neuesProtokoll();
  await mitServer(appMit(b, laeufe), async (post) => {
    const antwort = await post("/voice/incoming", { CallSid: "CA_h6b_unbekannt" });
    assert.equal(antwort.status, 200);
  });
  assert.deepEqual(laeufe.audits, ["inbound_unrouted"]);
});

test("H6b-5: /voice/outbound mit Lesefehler der Datenbank antwortet 500, verarbeitet nichts und meldet keinen unbekannten Anruf", async () => {
  const { db, b, call } = await zweiInstanzen(uebergabeAnruf());
  await kaputtMachen(db);
  const laeufe = neuesProtokoll();
  const zeilen = await ohneLog(() =>
    mitServer(appMit(b, laeufe), async (post) => {
      const antwort = await post(`/voice/outbound?callId=${call.id}`, { CallSid: "CA_h6b_5" });
      assert.equal(antwort.status, 500);
    }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes(`[voice/outbound] Anruf lesen fehlgeschlagen (callId=${call.id})`)));
  assert.deepEqual(laeufe, neuesProtokoll());
});

test("H6b-6: /voice/incoming mit Lesefehler antwortet 500, verarbeitet nichts, und die Wiederholung nach der Reparatur wird beantwortet", async () => {
  const { db, b } = await zweiInstanzen({ twilioSid: "CA_h6b_6" });
  await kaputtMachen(db);
  const laeufe = neuesProtokoll();
  const zeilen = await ohneLog(() =>
    mitServer(appMit(b, laeufe), async (post) => {
      const erste = await post("/voice/incoming", { CallSid: "CA_h6b_6" });
      assert.equal(erste.status, 500);
      assert.deepEqual(laeufe, neuesProtokoll());
      await reparieren(db);
      const zweite = await post("/voice/incoming", { CallSid: "CA_h6b_6" });
      assert.equal(await zweite.text(), KEEPALIVE);
    }),
  );
  assert.ok(zeilen.some((zeile) => zeile.includes("[incoming] Anruf lesen fehlgeschlagen (callId=-)")));
  assert.deepEqual(laeufe, neuesProtokoll());
});

test("H6b-7: ein Lesefehler gibt die Annahme in der Ablage frei und beantwortet eine zeitgleich wartende Zustellung ebenfalls mit 500", async () => {
  const freigaben = [];
  let ablehnen;
  const lesen = new Promise((_ok, fehler) => {
    ablehnen = fehler;
  });
  const { b } = await zweiInstanzen({});
  const store = {
    ...b,
    getCall: () => null,
    leseCallUngebunden: () => lesen,
    webhookZustellung: {
      annehmen: async () => ({ eigen: true, kennung: "k_h6b_7" }),
      lies: async () => null,
      uebernehmen: async () => ({ eigen: false, kennung: null }),
      freigeben: async (kennung, bindung) => {
        freigaben.push({ kennung, anker: bindung.anker });
      },
      beantworten: async () => undefined,
    },
  };
  const laeufe = neuesProtokoll();
  const ankuenfte = [];
  await ohneLog(() =>
    mitServer(appMit(store, laeufe, ankuenfte), async (post) => {
      const erste = post("/voice/incoming", { CallSid: "CA_h6b_7" });
      await warteBis(() => ankuenfte.length === 1);
      const zweite = post("/voice/incoming", { CallSid: "CA_h6b_7" });
      await warteBis(() => ankuenfte.length === 2);
      await new Promise((resolve) => setImmediate(resolve));
      ablehnen(new Error("lesen kaputt"));
      assert.equal((await erste).status, 500);
      assert.equal((await zweite).status, 500);
    }),
  );
  assert.deepEqual(freigaben, [{ kennung: "k_h6b_7", anker: ["in:CA_h6b_7"] }]);
  assert.deepEqual(laeufe, neuesProtokoll());
});

test("H6b-8: ein Store ohne SQL-Leser (JSON-Betrieb) findet den Anruf weiter im Arbeitsspeicher", async () => {
  const bekannt = { id: "call_h6b_8", twilioSid: "CA_h6b_8" };
  const { b } = await zweiInstanzen({});
  const store = { ...b, getCall: (id) => (id === "CA_h6b_8" ? bekannt : null), leseCallUngebunden: undefined };
  const laeufe = neuesProtokoll();
  await mitServer(appMit(store, laeufe), async (post) => {
    assert.equal(await (await post("/voice/incoming", { CallSid: "CA_h6b_8" })).text(), KEEPALIVE);
  });
  assert.deepEqual(laeufe, neuesProtokoll());
});
