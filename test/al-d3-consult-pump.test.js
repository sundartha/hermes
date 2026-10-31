import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readJsonBody } from "../scripts/convo-bench/http-fake-helpers.mjs";
import { startConsultPump } from "../scripts/convo-bench/consult-pump.mjs";
import { withFetch } from "./helpers.js";
import { fristSignal } from "./gemeinsam/antwortfrist.mjs";

const CALL_ID = "call1";
const CONSULT_PATH = `/api/calls/${CALL_ID}/consult`;
const ANSWER_PATH = `/api/calls/${CALL_ID}/consult/answer`;
const POLL_SETTLE_MS = 30;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const POLLS_UNTIL_DONE = 2;

async function withConsultServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nachAllenMikrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("AL-D3-N6: startConsultPump beantwortet ein consult-Event und kehrt bei done zurueck", async () => {
  let getCount = 0;
  const answerBodies = [];
  let resolveDone;
  const donePromise = new Promise((resolve) => (resolveDone = resolve));

  const srv = await withConsultServer(async (req, res) => {
    if (req.method === "GET" && req.url.startsWith(CONSULT_PATH)) {
      getCount += 1;
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      if (getCount === 1) {
        res.end(JSON.stringify({ event: "consult", eventId: "e1", question: "Wie spaet passt es?" }));
      } else {
        res.end(JSON.stringify({ event: "done" }));
        resolveDone();
      }
      return;
    }
    if (req.method === "POST" && req.url === ANSWER_PATH) {
      answerBodies.push(await readJsonBody(req));
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(HTTP_NOT_FOUND);
    res.end();
  });

  try {
    const pump = startConsultPump({ baseUrl: srv.url, callId: CALL_ID, answers: ["14 Uhr"] });
    await donePromise;
    await wait(POLL_SETTLE_MS);
    await assert.doesNotReject(() => pump.stop());
    assert.equal(getCount, POLLS_UNTIL_DONE);
    assert.deepEqual(answerBodies, [{ event_id: "e1", answers: ["14 Uhr"] }]);
  } finally {
    await srv.close();
  }
});

test("AL-D3-N7: startConsultPump wirft ueber stop(), wenn die Pumpe auf eine 403-Antwort lief", async () => {
  const srv = await withConsultServer((req, res) => {
    res.writeHead(HTTP_FORBIDDEN);
    res.end();
  });
  const echtesFetch = globalThis.fetch;
  let antwortErhalten;
  const antwortBeiDerPumpe = new Promise((resolve) => (antwortErhalten = resolve));
  const beobachtetesFetch = async (url, optionen = {}) => {
    const antwort = await echtesFetch(url, {
      ...optionen,
      signal: AbortSignal.any([fristSignal(), ...(optionen.signal ? [optionen.signal] : [])]),
    });
    antwortErhalten();
    return antwort;
  };
  try {
    await withFetch(beobachtetesFetch, async () => {
      const pump = startConsultPump({ baseUrl: srv.url, callId: CALL_ID, answers: [] });
      await antwortBeiDerPumpe;
      await nachAllenMikrotasks();
      await assert.rejects(() => pump.stop(), /403/);
    });
  } finally {
    await srv.close();
  }
});

test("AL-D3-N8: startConsultPump bricht sauber ab, wenn stop() waehrend eines haengenden fetch kommt", async () => {
  const srv = await withConsultServer(() => {
  });
  try {
    const pump = startConsultPump({ baseUrl: srv.url, callId: CALL_ID, answers: [] });
    await wait(POLL_SETTLE_MS);
    await assert.doesNotReject(() => pump.stop());
  } finally {
    await srv.close();
  }
});

import { after, before } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { DOMESTIC_TEST_NUMBER, seedCall, seedState, startServer } from "./helpers.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { starteAnbieterServer } from "./gemeinsam/anbieter-attrappe.mjs";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;
const EIGENER_ANRUF = "call_eigen";
const FREMDER_ANRUF = "call_fremd";
const UNBEKANNTER_ANRUF = "call_unbekannt";
const FREMDER_MANDANT = "t_fremd";
const FREMDE_IDENTITAET = "sub-fremd";
const BEANTWORTETES_EREIGNIS = "c0";
const EIGENES_ZIEL = "+4915112345678";
const NEUES_ZIEL = "+4915112340001";
const NICHT_GEFUNDEN = { error: "not found" };
const PFLICHT_FEHLER = { error: "to und objective sind Pflicht" };
const E164_FEHLER = { error: "'to' must be E.164, e.g. +4917212345678" };
const ANLEGE_FEHLER = {
  error: "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.",
};

const beantworteteKonsultation = () => ({
  id: BEANTWORTETES_EREIGNIS,
  seq: 0,
  questions: ["Passt Donnerstag?"],
  status: "answered",
  askedAt: new Date().toISOString(),
  answeredAt: new Date().toISOString(),
  answeredFacts: 1,
});

const anrufrouteSeed = () =>
  seedState({
    tenants: [{ id: FREMDER_MANDANT, status: "active", idpSubject: FREMDE_IDENTITAET }],
    calls: [
      seedCall({
        id: EIGENER_ANRUF,
        to: EIGENES_ZIEL,
        maxDurationS: 600,
        consults: [beantworteteKonsultation()],
      }),
      seedCall({ id: FREMDER_ANRUF, tenantId: FREMDER_MANDANT, maxDurationS: 600 }),
    ],
  });

async function starteTelnyxZaehler() {
  return starteAnbieterServer(({ req, res, vermerke }) => {
    vermerke({ method: req.method, pfad: req.url });
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify({ sid: "sid_nie_gewaehlt" }));
  });
}

const anrufrouteEnv = (telnyx) => ({
  ALLOWED_COUNTRY_CODES: "*",
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  TELNYX_API_BASE: telnyx.url,
  TELNYX_API_KEY: "test",
  TELNYX_ACCOUNT_SID: "acc_nie",
});

let anrufrouten;

before(async function starteAnrufrouten() {
  const telnyx = await starteTelnyxZaehler();
  const srv = await startServer({
    ownerNumber: DOMESTIC_TEST_NUMBER,
    seed: anrufrouteSeed(),
    env: anrufrouteEnv(telnyx),
  });
  anrufrouten = { srv, telnyx };
});

after(async function beendeAnrufrouten() {
  await anrufrouten?.srv.stop();
  await anrufrouten?.telnyx.close();
});

async function anfrage(pfad, { methode = "GET", koerper, identitaet, srv = anrufrouten.srv } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (identitaet) headers["X-Internal-Identity"] = identitaet;
  const res = await abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: methode,
    headers,
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  return { status: res.status, body: await res.json() };
}

const antworte = (callId, koerper) =>
  anfrage(`/api/calls/${callId}/consult/answer`, { methode: "POST", koerper });

const waehleAn = (koerper, srv) => anfrage("/api/calls", { methode: "POST", koerper, srv });

test("Konsultationsabfrage eines unbekannten oder fremden Anrufs antwortet 404 not found", async () => {
  assert.deepEqual(await anfrage(`/api/calls/${UNBEKANNTER_ANRUF}/consult`), {
    status: HTTP_NOT_FOUND,
    body: NICHT_GEFUNDEN,
  });
  assert.deepEqual(await anfrage(`/api/calls/${FREMDER_ANRUF}/consult`), {
    status: HTTP_NOT_FOUND,
    body: NICHT_GEFUNDEN,
  });
});

test("Konsultationsabfrage eines Mandanten ohne Konsultationsrecht antwortet 404 not found", async () => {
  assert.deepEqual(
    await anfrage(`/api/calls/${FREMDER_ANRUF}/consult`, { identitaet: FREMDE_IDENTITAET }),
    { status: HTTP_NOT_FOUND, body: NICHT_GEFUNDEN },
  );
});

test("Abbruch eines unbekannten oder fremden Anrufs antwortet 404 not found und waehlt nicht", async () => {
  const pfad = (callId) => `/api/calls/${callId}/cancel`;
  assert.deepEqual(await anfrage(pfad(UNBEKANNTER_ANRUF), { methode: "POST" }), {
    status: HTTP_NOT_FOUND,
    body: NICHT_GEFUNDEN,
  });
  assert.deepEqual(await anfrage(pfad(FREMDER_ANRUF), { methode: "POST" }), {
    status: HTTP_NOT_FOUND,
    body: NICHT_GEFUNDEN,
  });
  assert.deepEqual(anrufrouten.telnyx.anfragen, []);
});

test("[NIE1] Konsultationsantwort: 400 bei ungueltiger event_id, 404 bei unbekanntem und fremdem Anruf", async () => {
  assert.deepEqual(await antworte(EIGENER_ANRUF, { event_id: "e1", status: "working" }), {
    status: HTTP_BAD_REQUEST,
    body: { error: "event_id ist ungueltig" },
  });
  assert.deepEqual(await antworte(EIGENER_ANRUF, { status: "working" }), {
    status: HTTP_BAD_REQUEST,
    body: { error: "event_id ist ungueltig" },
  });
  const gueltig = { event_id: BEANTWORTETES_EREIGNIS, status: "working" };
  assert.deepEqual(await antworte(UNBEKANNTER_ANRUF, gueltig), {
    status: HTTP_NOT_FOUND,
    body: NICHT_GEFUNDEN,
  });
  assert.deepEqual(await antworte(FREMDER_ANRUF, gueltig), {
    status: HTTP_NOT_FOUND,
    body: NICHT_GEFUNDEN,
  });
});

test("[NIE1] Konsultationsantwort auf ein bereits beantwortetes Ereignis antwortet 409 mit dem Ergebnis", async () => {
  assert.deepEqual(
    await antworte(EIGENER_ANRUF, { event_id: BEANTWORTETES_EREIGNIS, status: "working" }),
    { status: HTTP_CONFLICT, body: { error: "already_answered" } },
  );
  assert.deepEqual(
    await antworte(EIGENER_ANRUF, {
      event_id: BEANTWORTETES_EREIGNIS,
      answers: ["Donnerstag passt."],
    }),
    { status: HTTP_CONFLICT, body: { error: "already_answered" } },
  );
});

test("[NIE2] GET /api/calls/:id eines unbekannten oder fremden Anrufs antwortet 404 not found ohne Anrufdaten", async () => {
  assert.deepEqual(await anfrage(`/api/calls/${UNBEKANNTER_ANRUF}`), {
    status: HTTP_NOT_FOUND,
    body: NICHT_GEFUNDEN,
  });
  assert.deepEqual(await anfrage(`/api/calls/${FREMDER_ANRUF}`), {
    status: HTTP_NOT_FOUND,
    body: NICHT_GEFUNDEN,
  });
  const eigener = await anfrage(`/api/calls/${EIGENER_ANRUF}`);
  assert.equal(eigener.status, HTTP_OK);
  assert.equal(eigener.body.id, EIGENER_ANRUF);
});

test("[NIE2] POST /api/calls auf ein laufendes Ziel antwortet 200 mit dem laufenden Anruf und waehlt nicht", async () => {
  const antwort = await waehleAn({ to: EIGENES_ZIEL, objective: "Termin vereinbaren" });
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(antwort.body.callId, EIGENER_ANRUF);
  assert.equal(antwort.body.deduplicated, true);
  assert.deepEqual(anrufrouten.telnyx.anfragen, []);
});

test("[NIE3] POST /api/calls ohne to oder objective und mit Trunk-Null antwortet 400 und waehlt nicht", async () => {
  assert.deepEqual(await waehleAn({ objective: "Termin vereinbaren" }), {
    status: HTTP_BAD_REQUEST,
    body: PFLICHT_FEHLER,
  });
  assert.deepEqual(await waehleAn({ to: NEUES_ZIEL }), {
    status: HTTP_BAD_REQUEST,
    body: PFLICHT_FEHLER,
  });
  assert.deepEqual(await waehleAn({ to: "+4901711234567", objective: "Termin vereinbaren" }), {
    status: HTTP_BAD_REQUEST,
    body: E164_FEHLER,
  });
  assert.deepEqual(anrufrouten.telnyx.anfragen, []);
});

test("[NIE3] POST /api/calls antwortet 503 ohne Wahl, wenn der Speicher den Anruf nicht anlegen kann", async () => {
  const telnyx = await starteTelnyxZaehler();
  const srv = await startServer({ ownerNumber: DOMESTIC_TEST_NUMBER, env: anrufrouteEnv(telnyx) });
  try {
    const speicherdatei = path.join(srv.dataDir, "store.json");
    fs.rmSync(speicherdatei);
    fs.mkdirSync(path.join(speicherdatei, "belegt"), { recursive: true });
    assert.deepEqual(await waehleAn({ to: NEUES_ZIEL, objective: "Termin vereinbaren" }, srv), {
      status: HTTP_SERVICE_UNAVAILABLE,
      body: ANLEGE_FEHLER,
    });
    assert.deepEqual(telnyx.anfragen, []);
  } finally {
    await srv.stop();
    await telnyx.close();
  }
});
