import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import express from "express";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
process.env.IN_CALL_CONSULT_ENABLED = "true";

const { config } = await import("../../src/config.ts");
const { KOSTENPROFIL } = await import("../../src/billing/kostenarten.ts");
const { EL_CALL_BINDING_SIP_HEADER } = await import("../../src/elevenlabs/inbound-sip-uri.ts");
const { makeElevenLabsWebhookRoutes } = await import("../../src/routes/webhooks-elevenlabs.ts");
const { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER, makeElevenLabsInitWebhookRoutes } = await import(
  "../../src/routes/webhooks-elevenlabs-init.ts"
);
const { EXA_SCHLUESSEL_BEISPIEL, H7C2B4B2_UNBEKANNTER_BINDUNGS_TOKEN, H7C2B4B2_FEHLER_NACH_DEM_SENDEN, H7C2B4B2_WERKZEUG_TOKEN, H7C2B4B2_TOKEN_EINES_ANDEREN_MANDANTEN, H7C2B4B2_BINDUNGS_TOKEN, H7C2B4B2_FREMDER_BINDUNGS_TOKEN, H7C2B4B2_ERFUNDENES_TOKEN } = await import("../gemeinsam/erfundene-geheimnisse.js");
const { abrufMitFrist } = await import("../gemeinsam/antwortfrist.mjs");
const { EL_INBOUND_ACCESS_BOOT_ENV } = await import("../helpers.js");
const { BOOTSTRAP_TENANT_ID, legeMandantAn, makePgStore, makePgTestStore, nutzungAuffrischenVon } = await import("../pg-helpers.js");

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const TOOL_TOKEN = H7C2B4B2_WERKZEUG_TOKEN;
const AGENT_ID = "agent_h7c2b4b2";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const FREMD = "t_h7c2b4b2_fremd";
const KONVERSATION = "conv_h7c2b4b2_kunde";
const KONVERSATION_FREMD = "conv_h7c2b4b2_fremd";
const TOKEN_EINES_ANDEREN_MANDANTEN = H7C2B4B2_TOKEN_EINES_ANDEREN_MANDANTEN;
const BINDUNGS_TOKEN = H7C2B4B2_BINDUNGS_TOKEN;
const FREMDER_BINDUNGS_TOKEN = H7C2B4B2_FREMDER_BINDUNGS_TOKEN;
const NEUE_KONVERSATION = "conv_h7c2b4b2_neu";
const KONVERSATION_OHNE_BRUECKE = "conv_h7c2b4b2_ohne_bruecke";
const KONVERSATION_UNBEKANNT = "conv_h7c2b4b2_unbekannt";
const ABSENDER = "+4930555000330";
const ZIEL = "+4915112349941";
const SUCHANFRAGE_MIT_ZIFFERN = "opening hours 12345678 Grove Street";
const WEGE = Object.freeze({
  consult: { pfad: "/webhooks/elevenlabs/consult", koerper: { question: "Passt Donnerstag?" } },
  lookup: { pfad: "/webhooks/elevenlabs/lookup", koerper: { query: SUCHANFRAGE_MIT_ZIFFERN } },
});

config.voice.elevenLabsToolToken = TOOL_TOKEN;
config.research.lookupEnabled = true;
config.research.exaApiKey = EXA_SCHLUESSEL_BEISPIEL;
config.voice.elevenLabsInbound.initWebhookToken = INIT_TOKEN;
config.voice.elevenLabsOutbound.agentId = AGENT_ID;

const profilFreigegeben = (store) =>
  Object.assign(Object.create(store), {
    resolveProfile: () => ({ allowConsult: true, allowLookup: true }),
    nutzungAuffrischen: (tenantId) => nutzungAuffrischenVon(store.load(), tenantId),
  });

async function zweiInstanzen() {
  const { store: b, runner } = await makePgTestStore();
  const a = makePgStore(runner);
  await a.init();
  await legeMandantAn(b, FREMD);
  return { a, b, runner };
}

async function legeAnrufAn(store, { tenantId, konversation, ueber = {} }) {
  const call = store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId, provider: "telnyx" });
  Object.assign(call, { elevenlabsConversationId: konversation, ...ueber });
  await store.persistCall(call.id);
  return call;
}

function mitAusfall(runner) {
  const schalter = { aus: false };
  return {
    schalter,
    runner: { withClient: (fn) => (schalter.aus ? Promise.reject(new Error("Datenbank weg")) : runner.withClient(fn)) },
  };
}

const wartenderElAnruf = { costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, answeredAt: new Date().toISOString() };

async function mitServer(router, lauf) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = http.createServer(app);
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  try {
    return await lauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

function werkzeugRouter(store, beobachter) {
  return makeElevenLabsWebhookRoutes({
    store: profilFreigegeben(store),
    config,
    consultSlots: { withOpenSlot: async (_id, _mandant, run) => ({ granted: true, value: await run() }) },
    onConsultRaised: async (anfrage) => {
      beobachter.push(anfrage.callId);
      return { kind: "answered", facts: ["Ja, passt."] };
    },
    auditFor: () => () => {},
  });
}

function initRouter(store) {
  return makeElevenLabsInitWebhookRoutes({
    store,
    config,
    bridges: { clearDeadlines: () => {} },
    outboundInitInhalt: () => ({ marke: "h7c2b4b2-antwort" }),
    vorspannText: () => "",
  });
}

const werkzeugRuf = (url, weg, extra = {}) =>
  abrufMitFrist(`${url}${WEGE[weg].pfad}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hermes-tool-token": TOOL_TOKEN },
    body: JSON.stringify({ conversation_id: KONVERSATION, ...WEGE[weg].koerper, ...extra }),
  });

const initRuf = (url, token, konversation = NEUE_KONVERSATION) =>
  abrufMitFrist(`${url}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: konversation,
      called_number: ABSENDER,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: token },
    }),
  });

async function konversationInDatenbank(runner, id) {
  return runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    const { rows } = await client.query("SELECT elevenlabs_conversation_id FROM call WHERE id = $1", [id]);
    return rows[0].elevenlabs_conversation_id;
  });
}

test("H7c2b4b2-1: Consult auf Instanz B findet einen laufenden Anruf, den A nach dem Start von B angelegt hat, und die Frage geht durch", async () => {
  const { a, b } = await zweiInstanzen();
  const call = await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: KONVERSATION });
  const gefragt = [];
  await mitServer(werkzeugRouter(b, gefragt), async (url) => {
    const antwort = await werkzeugRuf(url, "consult");
    assert.equal(antwort.status, HTTP_OK);
    assert.equal((await antwort.json()).status, "answered");
  });
  assert.deepEqual(gefragt, [call.id]);
});

test("H7c2b4b2-2: Lookup auf Instanz B findet einen laufenden Anruf von A und beantwortet die Suche", async () => {
  const { a, b } = await zweiInstanzen();
  await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: KONVERSATION });
  await mitServer(werkzeugRouter(b, []), async (url) => {
    const antwort = await werkzeugRuf(url, "lookup");
    assert.equal(antwort.status, HTTP_OK);
    assert.equal((await antwort.json()).status, "declined");
  });
});

test("H7c2b4b2-3: Init auf Instanz B bindet die Konversation an einen wartenden Anruf von A und schreibt sie in die Datenbank", async () => {
  const { a, b, runner } = await zweiInstanzen();
  const call = await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: null, ueber: { ...wartenderElAnruf, streamToken: BINDUNGS_TOKEN } });
  await mitServer(initRouter(b), async (url) => {
    const antwort = await initRuf(url, BINDUNGS_TOKEN);
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(await antwort.json(), { type: "conversation_initiation_client_data", marke: "h7c2b4b2-antwort" });
  });
  await b.drainFlushes();
  assert.equal(await konversationInDatenbank(runner, call.id), NEUE_KONVERSATION);
});

test("H7c2b4b2-4: Consult und Lookup mit dem Mandanten-Token eines anderen Mandanten werden abgelehnt, die Frage geht nicht durch", async () => {
  const { a, b } = await zweiInstanzen();
  await legeAnrufAn(a, { tenantId: FREMD, konversation: KONVERSATION_FREMD });
  const gefragt = [];
  await mitServer(werkzeugRouter(b, gefragt), async (url) => {
    for (const weg of ["consult", "lookup"]) {
      const antwort = await werkzeugRuf(url, weg, { conversation_id: KONVERSATION_FREMD, tenant_token: TOKEN_EINES_ANDEREN_MANDANTEN });
      assert.equal(antwort.status, HTTP_NOT_FOUND, weg);
    }
    const ohneToken = await werkzeugRuf(url, "consult", { conversation_id: KONVERSATION_FREMD });
    assert.equal(ohneToken.status, HTTP_OK);
  });
  assert.equal(gefragt.length, 1);
});

test("H7c2b4b2-5: Consult, Lookup und Init finden keinen beendeten und keinen unbekannten Anruf", async () => {
  const { a, b } = await zweiInstanzen();
  const beendet = await legeAnrufAn(a, {
    tenantId: BOOTSTRAP_TENANT_ID,
    konversation: KONVERSATION,
    ueber: { ...wartenderElAnruf, streamToken: BINDUNGS_TOKEN, status: "completed", endedAt: new Date().toISOString() },
  });
  await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: null, ueber: { ...wartenderElAnruf, streamToken: FREMDER_BINDUNGS_TOKEN } });
  const gefragt = [];
  await mitServer(werkzeugRouter(b, gefragt), async (url) => {
    for (const weg of ["consult", "lookup"]) assert.equal((await werkzeugRuf(url, weg)).status, HTTP_NOT_FOUND, weg);
  });
  await mitServer(initRouter(b), async (url) => {
    assert.equal((await initRuf(url, BINDUNGS_TOKEN)).status, HTTP_NOT_FOUND);
    assert.equal((await initRuf(url, H7C2B4B2_ERFUNDENES_TOKEN)).status, HTTP_NOT_FOUND);
  });
  assert.deepEqual(gefragt, []);
  assert.equal(beendet.status, "completed");
});

test("H7c2b4b2-6: Ist die Datenbank nicht lesbar, antworten Consult, Lookup und Init mit 500, nie mit 404, und es geht nichts durch", async (t) => {
  t.mock.method(console, "error", () => {});
  const { runner } = await zweiInstanzen();
  const ausfall = mitAusfall(runner);
  const b = makePgStore(ausfall.runner);
  await b.init();
  ausfall.schalter.aus = true;
  const gefragt = [];
  await mitServer(werkzeugRouter(b, gefragt), async (url) => {
    for (const weg of ["consult", "lookup"]) {
      const antwort = await werkzeugRuf(url, weg);
      assert.equal(antwort.status, HTTP_SERVER_ERROR, weg);
      assert.deepEqual(await antwort.json(), { error: "intern" });
    }
  });
  await mitServer(initRouter(b), async (url) => {
    const antwort = await initRuf(url, BINDUNGS_TOKEN);
    assert.equal(antwort.status, HTTP_SERVER_ERROR);
    assert.deepEqual(await antwort.json(), { error: "intern" });
  });
  assert.deepEqual(gefragt, []);
});

test("H7c2b4b2-7: Consult findet einen laufenden Anruf, den nur der eigene Spiegel von B kennt, aber keinen beendeten eigenen", async () => {
  const { b } = await zweiInstanzen();
  const laufend = b.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  laufend.elevenlabsConversationId = KONVERSATION;
  const beendet = b.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  Object.assign(beendet, { elevenlabsConversationId: KONVERSATION_FREMD, status: "completed" });
  const gefragt = [];
  await mitServer(werkzeugRouter(b, gefragt), async (url) => {
    assert.equal((await werkzeugRuf(url, "consult")).status, HTTP_OK);
    assert.equal((await werkzeugRuf(url, "consult", { conversation_id: KONVERSATION_FREMD })).status, HTTP_NOT_FOUND);
  });
  assert.deepEqual(gefragt, [laufend.id]);
});

test("H7c2b4b2-8: aktiveAnrufeAlle liefert die laufenden Anrufe aller Mandanten je einmal, auch einen eigenen schon gespeicherten, und keinen beendeten", async () => {
  const { a, b } = await zweiInstanzen();
  const eigen = await legeAnrufAn(b, { tenantId: BOOTSTRAP_TENANT_ID, konversation: KONVERSATION });
  const fremdA = await legeAnrufAn(a, { tenantId: FREMD, konversation: KONVERSATION_FREMD });
  const kundeA = await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: NEUE_KONVERSATION });
  await legeAnrufAn(a, { tenantId: FREMD, konversation: null, ueber: { status: "completed", endedAt: new Date().toISOString() } });
  const ids = (await b.aktiveAnrufeAlle()).map((call) => call.id).sort();
  assert.deepEqual(ids, [eigen.id, fremdA.id, kundeA.id].sort());
});

async function mitExaZaehler(lauf) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      anfragen.push(req.url);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ results: [{ title: "Oeffnungszeiten", url: "https://x.invalid", highlights: ["Taeglich geoeffnet."] }] }));
    });
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const vorher = config.research.exaApiBase;
  config.research.exaApiBase = `http://127.0.0.1:${server.address().port}`;
  try {
    return await lauf(anfragen);
  } finally {
    config.research.exaApiBase = vorher;
    await new Promise((fertig) => server.close(fertig));
  }
}

test("H7c2b4b2-9: auf Instanz B wird der dritte Lookup eines Anrufs von A abgelehnt, die Grenze von 2 gilt auch dort", async () => {
  const { a, b } = await zweiInstanzen();
  await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: KONVERSATION });
  await mitExaZaehler(async (anfragen) => {
    await mitServer(werkzeugRouter(b, []), async (url) => {
      const antworten = [];
      for (let i = 0; i < 3; i++) {
        const antwort = await werkzeugRuf(url, "lookup", { query: `opening hours Grove Street ${"abc"[i]}` });
        assert.equal(antwort.status, HTTP_OK);
        antworten.push((await antwort.json()).status);
      }
      assert.deepEqual(antworten, ["ok", "ok", "declined"]);
    });
    assert.equal(anfragen.length, 2);
  });
});

test("H7c2b4b2-10: Consult auf Instanz B findet den Anruf von A und läuft zu Ende statt rejected/kein_anruf", async () => {
  const { a, b } = await zweiInstanzen();
  const call = await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: KONVERSATION });
  const gefragt = [];
  await mitServer(werkzeugRouter(b, gefragt), async (url) => {
    const antwort = await werkzeugRuf(url, "consult");
    assert.equal(antwort.status, HTTP_OK);
    const body = await antwort.json();
    assert.equal(body.status, "answered");
    assert.equal(body.reason, null);
    assert.equal(body.answer, "Ja, passt.");
  });
  assert.deepEqual(gefragt, [call.id]);
});

test("H7c2b4b2-11: wechseln die Lookups eines Anrufs zwischen Instanz B und A, wird der dritte abgelehnt und Exa genau 2-mal gerufen", async () => {
  const { a, b } = await zweiInstanzen();
  await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: KONVERSATION });
  await mitExaZaehler(async (anfragen) => {
    await mitServer(werkzeugRouter(b, []), async (urlB) => {
      await mitServer(werkzeugRouter(a, []), async (urlA) => {
        const antworten = [];
        for (const [i, url] of [urlB, urlB, urlA].entries()) {
          const antwort = await werkzeugRuf(url, "lookup", { query: `opening hours Grove Street ${"abc"[i]}` });
          assert.equal(antwort.status, HTTP_OK);
          antworten.push((await antwort.json()).status);
        }
        assert.deepEqual(antworten, ["ok", "ok", "declined"]);
      });
    });
    assert.equal(anfragen.length, 2);
  });
});

function nurImSpeicher(store, ueber) {
  const call = store.createCall({
    direction: "outbound",
    from: ABSENDER,
    to: ZIEL,
    goal: "Test",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
  });
  return Object.assign(call, { status: "active", ...wartenderElAnruf, streamToken: BINDUNGS_TOKEN, ...ueber });
}

test("H7c2b4b2-12: ein Anruf, der nur im eigenen Speicher steht und noch nicht in der Datenbank, wird bei Consult, Lookup und Init mit 200 beantwortet", async () => {
  const { a } = await zweiInstanzen();
  const ohneZeile = Object.assign(Object.create(a), { attachActiveCall: async () => null });
  const call = nurImSpeicher(ohneZeile, { elevenlabsConversationId: KONVERSATION });
  const gefragt = [];
  await mitServer(werkzeugRouter(ohneZeile, gefragt), async (url) => {
    const consult = await werkzeugRuf(url, "consult");
    assert.equal(consult.status, HTTP_OK);
    assert.equal((await consult.json()).status, "answered");
    assert.equal((await werkzeugRuf(url, "lookup")).status, HTTP_OK);
  });
  assert.deepEqual(gefragt, [call.id]);
  nurImSpeicher(ohneZeile, { streamToken: FREMDER_BINDUNGS_TOKEN });
  await mitServer(initRouter(ohneZeile), async (url) => {
    const antwort = await initRuf(url, FREMDER_BINDUNGS_TOKEN);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal((await antwort.json()).marke, "h7c2b4b2-antwort");
  });
});

test("H7c2b4b2-13: ein Anruf, den Instanz B beendet hat, wird auf A bei Consult, Lookup und Init mit 404 kein_laufender_anruf abgelehnt", async () => {
  const { a, b } = await zweiInstanzen();
  const call = await legeAnrufAn(a, {
    tenantId: BOOTSTRAP_TENANT_ID,
    konversation: KONVERSATION,
    ueber: { ...wartenderElAnruf, streamToken: BINDUNGS_TOKEN },
  });
  assert.equal((await b.attachActiveCall(call.id)).id, call.id);
  await b.endCallRecord(call.id);
  assert.equal(a.getCall(call.id).status, "active");
  const gefragt = [];
  await mitExaZaehler(async (anfragen) => {
    await mitServer(werkzeugRouter(a, gefragt), async (url) => {
      for (const weg of ["consult", "lookup"]) {
        const antwort = await werkzeugRuf(url, weg);
        assert.equal(antwort.status, HTTP_NOT_FOUND, weg);
        assert.equal((await antwort.json()).error, "kein_laufender_anruf", weg);
      }
    });
    assert.deepEqual(anfragen, []);
  });
  await mitServer(initRouter(a), async (url) => {
    assert.equal((await initRuf(url, BINDUNGS_TOKEN)).status, HTTP_NOT_FOUND);
  });
  assert.deepEqual(gefragt, []);
});

test("H7c2b4b2-14: ein eigener Anruf ohne Datenbankzeile wird bei Consult mit 200 beantwortet und steht in aktiveAnrufeAlle, ein beendeter nicht", async () => {
  const { a, runner } = await zweiInstanzen();
  const call = nurImSpeicher(a, { elevenlabsConversationId: KONVERSATION });
  const beendet = nurImSpeicher(a, { elevenlabsConversationId: KONVERSATION_FREMD, status: "completed" });
  await a.drainFlushes();
  await runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    await client.query("DELETE FROM call WHERE id = ANY($1)", [[call.id, beendet.id]]);
  });
  assert.deepEqual((await a.aktiveAnrufeAlle()).map((eintrag) => eintrag.id), [call.id]);
  const gefragt = [];
  await mitServer(werkzeugRouter(a, gefragt), async (url) => {
    assert.equal((await werkzeugRuf(url, "consult")).status, HTTP_OK);
  });
  assert.deepEqual(gefragt, [call.id]);
});

test("H7c2b4b2-15: steht der Anruf in der Liste, ist beim Anhängen aber schon beendet, lehnen Consult und Lookup mit 404 kein_laufender_anruf ab und loggen Grund und Anruf", async (t) => {
  const protokoll = [];
  t.mock.method(console, "log", (...teile) => protokoll.push(teile.join(" ")));
  const { a, b } = await zweiInstanzen();
  const konversationen = { consult: KONVERSATION, lookup: KONVERSATION_FREMD };
  const anrufe = {};
  for (const [weg, konversation] of Object.entries(konversationen))
    anrufe[weg] = await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation });
  const spaeterBeendet = Object.assign(Object.create(b), {
    attachActiveCall: async (id) => {
      await a.endCallRecord(id);
      return b.attachActiveCall(id);
    },
  });
  const gefragt = [];
  await mitServer(werkzeugRouter(spaeterBeendet, gefragt), async (url) => {
    for (const weg of ["consult", "lookup"]) {
      const antwort = await werkzeugRuf(url, weg, { conversation_id: konversationen[weg] });
      assert.equal(antwort.status, HTTP_NOT_FOUND, weg);
      assert.equal((await antwort.json()).error, "kein_laufender_anruf", weg);
    }
  });
  const zeilen = protokoll.filter((zeile) => zeile.includes("abgelehnt grund=kein_laufender_anruf"));
  assert.deepEqual(zeilen, [
    `[el-consult] abgelehnt grund=kein_laufender_anruf call=${anrufe.consult.id}`,
    `[el-lookup] abgelehnt grund=kein_laufender_anruf call=${anrufe.lookup.id}`,
  ]);
  assert.deepEqual(gefragt, []);
});

test("H7c2b4b2-16: schlägt die Abfrage nach beendeten Anrufen fehl, lehnt aktiveAnrufeAlle mit genau dieser Meldung ab und loggt sie", async (t) => {
  const fehlerLog = [];
  t.mock.method(console, "error", (...teile) => fehlerLog.push(teile));
  const { runner } = await zweiInstanzen();
  const kaputt = {
    withClient: (fn) =>
      runner.withClient((client) =>
        fn({
          query: (sql, werte) =>
            sql.includes("id = ANY") ? Promise.reject(new Error("vorhanden-abfrage-kaputt")) : client.query(sql, werte),
        }),
      ),
  };
  const b = makePgStore(kaputt);
  await b.init();
  nurImSpeicher(b, { elevenlabsConversationId: KONVERSATION });
  await assert.rejects(b.aktiveAnrufeAlle(), { message: "vorhanden-abfrage-kaputt" });
  assert.deepEqual(fehlerLog, [["[pg] aktive anrufe lesen fehlgeschlagen:", "vorhanden-abfrage-kaputt"]]);
});

test("H7c2b4b2-17: schlägt die Abfrage nach den Mandanten fehl, lehnt aktiveAnrufeAlle mit genau dieser Meldung ab und loggt sie", async (t) => {
  const fehlerLog = [];
  t.mock.method(console, "error", (...teile) => fehlerLog.push(teile));
  const { runner } = await zweiInstanzen();
  const kaputt = {
    withClient: (fn) =>
      runner.withClient((client) =>
        fn({
          query: (sql, werte) =>
            sql.includes("FROM tenant ORDER BY id") ? Promise.reject(new Error("mandanten-abfrage-kaputt")) : client.query(sql, werte),
        }),
      ),
  };
  const b = makePgStore(kaputt);
  await b.init();
  await assert.rejects(b.aktiveAnrufeAlle(), { message: "mandanten-abfrage-kaputt" });
  assert.deepEqual(fehlerLog, [["[pg] aktive anrufe lesen fehlgeschlagen:", "mandanten-abfrage-kaputt"]]);
});

test("H7c2b4b2-18: der dritte Lookup eines Anrufs wird mit genau einer Logzeile grund=kontingent und Anruf abgelehnt", async (t) => {
  const protokoll = [];
  t.mock.method(console, "log", (...teile) => protokoll.push(teile.join(" ")));
  const { a, b } = await zweiInstanzen();
  const call = await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: KONVERSATION });
  await mitExaZaehler(async () => {
    await mitServer(werkzeugRouter(b, []), async (urlB) => {
      await mitServer(werkzeugRouter(a, []), async (urlA) => {
        for (const [i, url] of [urlB, urlB, urlA].entries())
          await werkzeugRuf(url, "lookup", { query: `opening hours Grove Street ${"abc"[i]}` });
      });
    });
  });
  assert.deepEqual(
    protokoll.filter((zeile) => zeile.includes("grund=kontingent")),
    [`[el-lookup] abgelehnt grund=kontingent call=${call.id}`],
  );
});

function initRouterMitMarke(store) {
  return makeElevenLabsInitWebhookRoutes({
    store,
    config,
    bridges: { clearDeadlines: () => {} },
    outboundInitInhalt: (call) => ({ marke: call.id }),
    vorspannText: () => "",
  });
}

test("H7c2b4b2-19: Init bindet nur den Anruf mit dem vorgelegten Token, ein Anruf ohne ElevenLabs-Brücke oder ohne Token, ein Fremdtoken und der Text null oder undefined ergeben 404 ohne Anruf in der Logzeile", async (t) => {
  const protokoll = [];
  t.mock.method(console, "log", (...teile) => protokoll.push(teile.join(" ")));
  const { a } = await zweiInstanzen();
  const ohneToken = nurImSpeicher(a, { streamToken: undefined });
  const ohneBruecke = await legeAnrufAn(a, { tenantId: BOOTSTRAP_TENANT_ID, konversation: null, ueber: { streamToken: FREMDER_BINDUNGS_TOKEN } });
  const erster = await legeAnrufAn(a, {
    tenantId: BOOTSTRAP_TENANT_ID,
    konversation: null,
    ueber: { ...wartenderElAnruf, streamToken: TOKEN_EINES_ANDEREN_MANDANTEN },
  });
  const zweiter = await legeAnrufAn(a, {
    tenantId: BOOTSTRAP_TENANT_ID,
    konversation: null,
    ueber: { ...wartenderElAnruf, streamToken: BINDUNGS_TOKEN },
  });
  await mitServer(initRouterMitMarke(a), async (url) => {
    const richtig = await initRuf(url, BINDUNGS_TOKEN);
    assert.equal(richtig.status, HTTP_OK);
    assert.equal((await richtig.json()).marke, zweiter.id);
    const keineBruecke = await initRuf(url, FREMDER_BINDUNGS_TOKEN, KONVERSATION_OHNE_BRUECKE);
    assert.equal(keineBruecke.status, HTTP_NOT_FOUND);
    for (const text of ["undefined", "null"]) assert.equal((await initRuf(url, text, `conv_h7c2b4b2_${text}`)).status, HTTP_NOT_FOUND, text);
    const unbekannt = await initRuf(url, H7C2B4B2_UNBEKANNTER_BINDUNGS_TOKEN, KONVERSATION_UNBEKANNT);
    assert.equal(unbekannt.status, HTTP_NOT_FOUND);
  });
  const abgelehnt = protokoll.filter((zeile) => zeile.includes("abgelehnt grund=kein_wartender_anruf"));
  assert.equal(abgelehnt.length, 4);
  for (const zeile of abgelehnt) assert.equal(zeile.includes(" call="), false, zeile);
  assert.equal(new Set([erster.id, zweiter.id, ohneBruecke.id, ohneToken.id]).size, 4);
});

test("H7c2b4b2-20: ist der Anruf in der Liste, beim Anhängen aber schon beendet, antwortet Init mit 404 und loggt grund und Anruf statt 500", async (t) => {
  const protokoll = [];
  t.mock.method(console, "log", (...teile) => protokoll.push(teile.join(" ")));
  const { a, b } = await zweiInstanzen();
  const call = await legeAnrufAn(a, {
    tenantId: BOOTSTRAP_TENANT_ID,
    konversation: null,
    ueber: { ...wartenderElAnruf, streamToken: BINDUNGS_TOKEN },
  });
  const spaeterBeendet = Object.assign(Object.create(b), {
    attachActiveCall: async (id) => {
      await a.endCallRecord(id);
      return b.attachActiveCall(id);
    },
  });
  await mitServer(initRouter(spaeterBeendet), async (url) => {
    const antwort = await initRuf(url, BINDUNGS_TOKEN);
    assert.equal(antwort.status, HTTP_NOT_FOUND);
  });
  assert.equal(protokoll.filter((zeile) => zeile.includes(`abgelehnt grund=kein_wartender_anruf`) && zeile.endsWith(` call=${call.id}`)).length, 1);
});

test("H7c2b4b2-21: wirft Init erst nach dem Senden der Antwort, bleibt die Antwort stehen, der Fehler wird geloggt und nicht an den Fehlerhandler weitergereicht", async (t) => {
  const fehlerLog = [];
  t.mock.method(console, "error", (...teile) => fehlerLog.push(teile.join(" ")));
  const { a } = await zweiInstanzen();
  nurImSpeicher(a, { streamToken: BINDUNGS_TOKEN });
  const weitergereicht = [];
  const initHandler = initRouter(a);
  const router = express.Router();
  router.use((req, res, weiter) => {
    const senden = res.json.bind(res);
    Object.assign(res, {
      json: (koerper) => {
        Object.assign(res, { json: senden });
        senden(koerper);
        throw new Error(H7C2B4B2_FEHLER_NACH_DEM_SENDEN);
      },
    });
    initHandler(req, res, (err) => {
      weitergereicht.push(err?.message ?? "weitergereicht");
      weiter();
    });
  });
  await mitServer(router, async (url) => {
    const antwort = await initRuf(url, BINDUNGS_TOKEN);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal((await antwort.json()).marke, "h7c2b4b2-antwort");
  });
  assert.deepEqual(fehlerLog, [`[el-init] fehler: ${H7C2B4B2_FEHLER_NACH_DEM_SENDEN}`]);
  assert.deepEqual(weitergereicht, []);
});

test("H7c2b4b2-22: aktiveAnrufeAlle fragt nur nach beendeten Anrufen, die nicht schon aus der Datenbank gelesen wurden, und liefert den Anruf einmal", async () => {
  const { runner } = await zweiInstanzen();
  const abfragen = [];
  const mitProtokoll = {
    withClient: (fn) =>
      runner.withClient((client) => fn({ query: (sql, werte) => (abfragen.push(sql), client.query(sql, werte)) })),
  };
  const store = makePgStore(mitProtokoll);
  await store.init();
  const lokal = await legeAnrufAn(store, { tenantId: BOOTSTRAP_TENANT_ID, konversation: KONVERSATION });
  abfragen.length = 0;
  assert.deepEqual((await store.aktiveAnrufeAlle()).map((eintrag) => eintrag.id), [lokal.id]);
  assert.equal(abfragen.filter((sql) => sql.includes("id = ANY")).length, 0);
});
