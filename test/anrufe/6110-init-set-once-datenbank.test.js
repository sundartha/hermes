import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import express from "express";

import { config } from "../../src/config.ts";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import {
  ELEVENLABS_INIT_PATH,
  INIT_TOKEN_HEADER,
  makeElevenLabsInitWebhookRoutes,
} from "../../src/routes/webhooks-elevenlabs-init.ts";
import { H7C2B4B2_BINDUNGS_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { EL_INBOUND_ACCESS_BOOT_ENV } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";

const HTTP_OK = 200;
const HTTP_NICHT_GEFUNDEN = 404;
const AGENT_ID = "agent_6110";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const ABSENDER = "+4930555000610";
const ZIEL = "+4915112349610";
const ERSTE = "conv_6110_erste";
const ZWEITE = "conv_6110_zweite";
const JETZT_ISO = new Date("2026-01-01T00:00:00.000Z").toISOString();
const SPAETER_ISO = new Date("2026-01-01T00:00:05.000Z").toISOString();

config.voice.elevenLabsInbound.initWebhookToken = INIT_TOKEN;
config.voice.elevenLabsOutbound.agentId = AGENT_ID;

async function zeileLesen(runner, callId) {
  return runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    const { rows } = await client.query("SELECT elevenlabs_conversation_id, el_bound_at FROM call WHERE id = $1", [callId]);
    return rows[0];
  });
}

async function zweiInstanzen() {
  const { store: a, runner } = await makePgTestStore();
  const call = a.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  Object.assign(call, {
    elevenlabsConversationId: null,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: JETZT_ISO,
    streamToken: H7C2B4B2_BINDUNGS_TOKEN,
  });
  await a.persistCall(call.id);
  const b = makePgStore(runner);
  await b.init();
  assert.ok(b.getCall(call.id) ?? (await b.attachActiveCall(call.id)));
  return { a, b, runner, callId: call.id };
}

test("Die zweite Instanz mit veraltetem Spiegel ueberschreibt eine gebundene Konversation nicht und meldet die Bindung als nicht gespeichert", async () => {
  const { a, b, runner, callId } = await zweiInstanzen();
  assert.equal(await a.bindInboundElConversation(callId, { conversationId: ERSTE, nowIso: JETZT_ISO }).dauerhaft, true);
  const zweite = b.bindInboundElConversation(callId, { conversationId: ZWEITE, nowIso: SPAETER_ISO });
  assert.equal(zweite.changed, true);
  assert.equal(await zweite.dauerhaft, false);
  assert.deepEqual(
    { id: (await zeileLesen(runner, callId)).elevenlabs_conversation_id, gebunden: (await zeileLesen(runner, callId)).el_bound_at.toISOString() },
    { id: ERSTE, gebunden: JETZT_ISO },
  );
});

test("Dieselbe Konversation ein zweites Mal in der Datenbank gilt als gespeichert", async () => {
  const { a, b, runner, callId } = await zweiInstanzen();
  assert.equal(await a.bindInboundElConversation(callId, { conversationId: ERSTE, nowIso: JETZT_ISO }).dauerhaft, true);
  assert.equal(await b.bindInboundElConversation(callId, { conversationId: ERSTE, nowIso: SPAETER_ISO }).dauerhaft, true);
  assert.equal((await zeileLesen(runner, callId)).el_bound_at.toISOString(), JETZT_ISO);
});

test("Ein beendeter Anruf gilt nicht als gespeichert", async () => {
  const { a, runner, callId } = await zweiInstanzen();
  await runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    await client.query("UPDATE call SET status = 'completed' WHERE id = $1", [callId]);
  });
  assert.equal(await a.bindInboundElConversation(callId, { conversationId: ERSTE, nowIso: JETZT_ISO }).dauerhaft, false);
});

function gegenInit(url, konversation) {
  return abrufMitFrist(`${url}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: konversation,
      called_number: ABSENDER,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: H7C2B4B2_BINDUNGS_TOKEN },
    }),
  });
}

async function mitInitServer(store, lauf) {
  const app = express();
  app.use(express.json());
  app.use(
    makeElevenLabsInitWebhookRoutes({
      store,
      config,
      bridges: { clearDeadlines: () => {} },
      outboundInitInhalt: () => ({ marke: "6110" }),
      vorspannText: () => "",
    }),
  );
  const server = http.createServer(app);
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  try {
    return await lauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

test("Der Init antwortet 404, wenn die Datenbank die Konversation einer anderen Instanz behalten hat", async (t) => {
  const protokoll = [];
  t.mock.method(console, "log", (...teile) => protokoll.push(teile.join(" ")));
  const { a, b, runner, callId } = await zweiInstanzen();
  const dazwischen = Object.create(b);
  dazwischen.bindInboundElConversation = (id, bindung) => {
    const fremd = a.bindInboundElConversation(id, { conversationId: ERSTE, nowIso: JETZT_ISO });
    const eigen = b.bindInboundElConversation(id, bindung);
    return { ...eigen, dauerhaft: fremd.dauerhaft.then(() => eigen.dauerhaft) };
  };
  await mitInitServer(dazwischen, async (url) => {
    assert.equal((await gegenInit(url, ZWEITE)).status, HTTP_NICHT_GEFUNDEN);
  });
  assert.equal((await zeileLesen(runner, callId)).elevenlabs_conversation_id, ERSTE);
  assert.ok(protokoll.some((zeile) => zeile.includes("[el-init] abgelehnt grund=kein_wartender_anruf")));
});

test("Der Init antwortet 200, wenn die Datenbank die eigene Konversation gespeichert hat", async () => {
  const { b, runner, callId } = await zweiInstanzen();
  await mitInitServer(b, async (url) => {
    assert.equal((await gegenInit(url, ZWEITE)).status, HTTP_OK);
  });
  assert.equal((await zeileLesen(runner, callId)).elevenlabs_conversation_id, ZWEITE);
});
