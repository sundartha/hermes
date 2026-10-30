import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const WERKZEUG_GEHEIMNIS = "staende-am-server-geheimnis";
const ANRUF = "call_staende_am_server";
const GESPRAECH = "conv_staende_am_server";
const ERFOLG = 200;
const KONFLIKT = 409;
const MS_JE_MINUTE = 60000;

const RUECKFRAGE_ENV = Object.freeze({
  ELEVENLABS_TOOL_TOKEN: WERKZEUG_GEHEIMNIS,
  CONSULT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
});

const KURZE_STAFFEL = Object.freeze({
  ...RUECKFRAGE_ENV,
  EL_CONSULT_DELIVERY_MS: "1500",
  EL_CONSULT_ACK_MS: "600",
  EL_CONSULT_ANSWER_MS: "3000",
});

const offeneRueckfrage = (askedAt) => ({
  id: "c0",
  seq: 0,
  questions: ["Passt Donnerstag?"],
  status: "open",
  askedAt,
  answeredAt: null,
  answeredFacts: 0,
});

const anrufMit = (overrides) =>
  seedState({
    calls: [
      seedCall({
        id: ANRUF,
        direction: "outbound",
        status: "active",
        elevenlabsConversationId: GESPRAECH,
        maxDurationS: 300,
        ...overrides,
      }),
    ],
  });

const jsonPost = (url, body, headers = {}) =>
  abrufMitFrist(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const rueckfrageStellen = (srv) =>
  jsonPost(
    `${srv.localUrl}/webhooks/elevenlabs/consult`,
    { conversation_id: GESPRAECH, question: "Passt Donnerstag?" },
    { "x-hermes-tool-token": WERKZEUG_GEHEIMNIS },
  );

const rueckfrageAbholen = (srv) => abrufMitFrist(`${srv.localUrl}/api/calls/${ANRUF}/consult`);

const antwortSenden = (srv, koerper) =>
  jsonPost(`${srv.localUrl}/api/calls/${ANRUF}/consult/answer`, { event_id: "c0", ...koerper });

const gespeicherterAnruf = (srv) => srv.readStore().calls.find((anruf) => anruf.id === ANRUF);

const gespeicherteRueckfrage = (srv) => gespeicherterAnruf(srv).consults[0];

async function mitAbgeholterRueckfrage(ablauf, { env = KURZE_STAFFEL, seed = anrufMit({}) } = {}) {
  const srv = await startServer({ env, seed });
  try {
    const gestellt = rueckfrageStellen(srv);
    assert.equal((await rueckfrageAbholen(srv)).status, ERFOLG);
    return await ablauf({ srv, gestellt });
  } finally {
    await srv.stop();
  }
}

test("eine beantwortete Rueckfrage steht als answered im Speicher und der Audit meldet accepted", () =>
  mitAbgeholterRueckfrage(async ({ srv, gestellt }) => {
    const antwort = await antwortSenden(srv, { answers: ["Donnerstag passt"] });

    assert.equal(antwort.status, ERFOLG);
    await gestellt;
    await waitForLog(srv, new RegExp(`\\[audit\\] consult_answered .*call=${ANRUF} .*ergebnis=accepted `));
    assert.equal(gespeicherteRueckfrage(srv).status, "answered");
  }));

test("eine quittierte Rueckfrage meldet im Audit accepted", () =>
  mitAbgeholterRueckfrage(async ({ srv, gestellt }) => {
    const antwort = await antwortSenden(srv, { status: "working" });

    assert.equal(antwort.status, ERFOLG);
    await gestellt;
    await waitForLog(srv, new RegExp(`\\[audit\\] consult_acked .*call=${ANRUF} .*ergebnis=accepted`));
  }));

test("eine Antwort nach Ablauf der Frist wird mit deadline_passed abgewiesen und nicht gespeichert", () =>
  mitAbgeholterRueckfrage(
    async ({ srv, gestellt }) => {
      const antwort = await antwortSenden(srv, { answers: ["zu spaet"] });

      assert.equal(antwort.status, KONFLIKT);
      assert.deepEqual(await antwort.json(), { error: "deadline_passed" });
      await gestellt;
      assert.notEqual(gespeicherteRueckfrage(srv).status, "answered");
    },
    {
      env: { ...KURZE_STAFFEL, CONSULT_OPEN_MS: "0" },
      seed: anrufMit({ answeredAt: new Date(Date.now() - MS_JE_MINUTE).toISOString() }),
    },
  ));

test("beim Start werden offene Rueckfragen verwaister Anrufe als expired gespeichert", async () => {
  const srv = await startServer({
    env: RUECKFRAGE_ENV,
    seed: anrufMit({ consults: [offeneRueckfrage(new Date().toISOString())] }),
  });
  try {
    await waitForLog(srv, /verwaiste Rueckfragen geschlossen/);
    assert.equal(gespeicherteRueckfrage(srv).status, "expired");
  } finally {
    await srv.stop();
  }
});

test("eine zugestellte aber nie quittierte Rueckfrage endet mit not_acked und steht als timed_out im Speicher", () =>
  mitAbgeholterRueckfrage(async ({ srv, gestellt }) => {
    const antwort = await gestellt;

    assert.equal((await antwort.json()).reason, "not_acked");
    assert.equal(gespeicherteRueckfrage(srv).status, "timed_out");
    assert.equal(gespeicherteRueckfrage(srv).timeoutReason, "not_acked");
  }));

test("eine quittierte aber nie beantwortete Rueckfrage endet mit timeout und steht als timed_out im Speicher", () =>
  mitAbgeholterRueckfrage(async ({ srv, gestellt }) => {
    assert.equal((await antwortSenden(srv, { status: "working" })).status, ERFOLG);

    const antwort = await gestellt;

    assert.equal((await antwort.json()).reason, "timeout");
    assert.equal(gespeicherteRueckfrage(srv).status, "timed_out");
    assert.equal(gespeicherteRueckfrage(srv).timeoutReason, "timeout");
  }));
