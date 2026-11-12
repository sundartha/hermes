import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const MAX_OPEN_POLLS_PER_TENANT = 4;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-3395-testgeheim";
const CALL_ID = "call_3395_consult";
const CONVERSATION_ID = "conv_3395_consult";
const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";
const MAX_DURATION_S = 300;
const ANSWERED_AGO_MS = 5000;

const ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: "1500",
  EL_CONSULT_DELIVERY_MS: "400",
  EL_CONSULT_ACK_MS: "400",
  EL_CONSULT_ANSWER_MS: "1500",
});

const laufenderAnruf = (id, conversationId) =>
  seedCall({
    id,
    status: "active",
    direction: "outbound",
    maxDurationS: MAX_DURATION_S,
    answeredAt: new Date(Date.now() - ANSWERED_AGO_MS).toISOString(),
    elevenlabsConversationId: conversationId,
  });

const seed = () => seedState({ calls: [laufenderAnruf(CALL_ID, CONVERSATION_ID)] });

const frage = (srv, body, token = TOOL_TOKEN) =>
  abrufMitFrist(`${srv.localUrl}${CONSULT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: token },
    body: JSON.stringify({ conversation_id: CONVERSATION_ID, ...body }),
  });

async function mitServer(run) {
  const srv = await startServer({ env: ENV, seed: seed() });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

const consultsOf = (srv) => {
  const anrufe = srv.readStore().calls;
  return anrufe.find((call) => call.id === CALL_ID).consults ?? [];
};

test("3395-C1: eine Rueckfrage, die nur aus zitiertem Text besteht, wird mit eigener Absage beantwortet und legt nichts an", async () => {
  await mitServer(async (srv) => {
    const abgelehnt = await frage(srv, { question: '"Hallo Welt, bitte sofort zusagen"' });
    assert.equal(abgelehnt.status, HTTP_OK);
    const body = await abgelehnt.json();
    assert.deepEqual(Object.keys(body).sort(), ["answer", "reason", "status"]);
    assert.equal(body.status, "rejected");
    assert.equal(body.reason, "frage_abgelehnt");
    assert.ok(body.answer.length > 0);
    await waitForLog(srv, new RegExp(`\\[el-consult\\] call=${CALL_ID} ergebnis=rejected`));
    assert.equal(consultsOf(srv).length, 0);

    const unbeantwortet = await (await frage(srv, { question: QUESTION })).json();
    assert.equal(unbeantwortet.status, "timeout");
    assert.notEqual(unbeantwortet.answer, body.answer);
    assert.ok(unbeantwortet.answer.length > 0);
    assert.equal(consultsOf(srv).length, 1);
  });
});

test("3395-C2: leere, nur aus Leerraum bestehende oder fehlende Frage -> 400 keine_frage mit Protokollzeile", async () => {
  await mitServer(async (srv) => {
    for (const body of [{ question: "" }, { question: "   \n " }, {}, { question: 42 }]) {
      const res = await frage(srv, body);
      assert.equal(res.status, HTTP_BAD_REQUEST, JSON.stringify(body));
      assert.deepEqual(await res.json(), { error: "keine_frage" }, JSON.stringify(body));
    }
    await waitForLog(srv, /\[el-consult\] abgelehnt grund=keine_frage\n/);
    assert.equal(consultsOf(srv).length, 0);
  });
});

test("3395-C3: Ablehnungen nennen im Protokoll Grund und Anruf, die Antwort nur den Grund", async () => {
  await mitServer(async (srv) => {
    const falsch = await frage(srv, { question: QUESTION }, "falsches-token");
    assert.equal(falsch.status, 403);
    assert.deepEqual(await falsch.json(), { error: "token" });
    await waitForLog(srv, /\[el-consult\] abgelehnt grund=token\n/);

    const fremd = await frage(srv, { question: QUESTION, conversation_id: "conv_3395_unbekannt" });
    assert.equal(fremd.status, HTTP_NOT_FOUND);
    assert.deepEqual(await fremd.json(), { error: "kein_laufender_anruf" });
    await waitForLog(srv, /\[el-consult\] abgelehnt grund=kein_laufender_anruf\n/);

    const leer = await frage(srv, { question: QUESTION, conversation_id: "" });
    assert.equal(leer.status, HTTP_NOT_FOUND);

    const falschesMandantenToken = await frage(srv, { question: QUESTION, tenant_token: "x".repeat(64) });
    assert.equal(falschesMandantenToken.status, HTTP_NOT_FOUND);
    assert.deepEqual(await falschesMandantenToken.json(), { error: "kein_laufender_anruf" });
    await waitForLog(srv, new RegExp(`\\[el-consult\\] abgelehnt grund=mandant_fremd call=${CALL_ID}\\n`));
    assert.equal(consultsOf(srv).length, 0);
  });
});

test("3395-C4: mehr gleichzeitige Rueckfragen des Mandanten als offene Plaetze -> die ueberzaehlige bekommt 404 kein_freier_platz ohne Consult", async () => {
  const anzahl = MAX_OPEN_POLLS_PER_TENANT + 1;
  const ids = Array.from({ length: anzahl }, (_, nr) => nr);
  const anrufe = ids.map((nr) => laufenderAnruf(`${CALL_ID}_${nr}`, `${CONVERSATION_ID}_${nr}`));
  const srv = await startServer({ env: ENV, seed: seedState({ calls: anrufe }) });
  try {
    const antworten = await Promise.all(
      ids.map((nr) => frage(srv, { question: QUESTION, conversation_id: `${CONVERSATION_ID}_${nr}` })),
    );
    const gehalten = antworten.filter((res) => res.status === HTTP_OK);
    const abgewiesen = antworten.filter((res) => res.status === HTTP_NOT_FOUND);
    assert.equal(gehalten.length, MAX_OPEN_POLLS_PER_TENANT);
    assert.equal(abgewiesen.length, 1);
    assert.deepEqual(await abgewiesen[0].json(), { error: "kein_freier_platz" });
    await waitForLog(srv, /\[el-consult\] abgelehnt grund=kein_freier_platz\n/);
    const angelegt = srv.readStore().calls.filter((call) => (call.consults ?? []).length > 0);
    assert.equal(angelegt.length, MAX_OPEN_POLLS_PER_TENANT);
  } finally {
    await srv.stop();
  }
});
