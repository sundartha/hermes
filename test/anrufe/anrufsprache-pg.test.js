import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import express from "express";

const { config } = await import("../../src/config.ts");
const { KOSTENPROFIL } = await import("../../src/billing/kostenarten.ts");
const { EL_CALL_BINDING_SIP_HEADER } = await import("../../src/elevenlabs/inbound-sip-uri.ts");
const { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER, makeElevenLabsInitWebhookRoutes } = await import(
  "../../src/routes/webhooks-elevenlabs-init.ts"
);
const { H7C2B4B2_BINDUNGS_TOKEN } = await import("../gemeinsam/erfundene-geheimnisse.js");
const { abrufMitFrist } = await import("../gemeinsam/antwortfrist.mjs");
const { EL_INBOUND_ACCESS_BOOT_ENV } = await import("../helpers.js");
const { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } = await import("../pg-helpers.js");

const HTTP_OK = 200;
const AGENT_ID = "agent_anrufsprache_pg";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const ABSENDER = "+4930555000330";
const ZIEL_PORTUGAL = "+351912345678";

config.voice.elevenLabsInbound.initWebhookToken = INIT_TOKEN;
config.voice.elevenLabsOutbound.agentId = AGENT_ID;

async function zweiInstanzen() {
  const { store: b, runner } = await makePgTestStore();
  const a = makePgStore(runner);
  await a.init();
  return { a, b };
}

async function legeAnrufAn(store, ueber) {
  const call = store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL_PORTUGAL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx", ...ueber.anlage });
  Object.assign(call, {
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: "2026-11-28T10:00:00.000Z",
    streamToken: H7C2B4B2_BINDUNGS_TOKEN,
  });
  await store.persistCall(call.id);
  return call;
}

async function initAntwort(store) {
  const app = express();
  app.use(express.json());
  app.use(
    makeElevenLabsInitWebhookRoutes({
      store,
      config,
      bridges: { clearDeadlines: () => {} },
      outboundInitInhalt: (call) => ({ sprache: call.language, sprache_ausdruecklich: call.languageExplicit }),
      vorspannText: () => "",
    }),
  );
  const server = http.createServer(app);
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  try {
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
      body: JSON.stringify({
        agent_id: AGENT_ID,
        conversation_id: "conv_anrufsprache_pg",
        called_number: ABSENDER,
        sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: H7C2B4B2_BINDUNGS_TOKEN },
      }),
    });
    assert.equal(antwort.status, HTTP_OK);
    return await antwort.json();
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}


test("anrufsprache-pg-1: ein ausdruecklich gewaehltes de an +351 erreicht den Init nach dem Laden aus Postgres als ausdrueckliche Wahl", async () => {
  const { a, b } = await zweiInstanzen();
  await legeAnrufAn(a, { anlage: { language: "de", languageExplicit: true } });
  const antwort = await initAntwort(b);
  assert.equal(antwort.sprache, "de");
  assert.equal(antwort.sprache_ausdruecklich, true);
});

test("anrufsprache-pg-2: ohne ausdrueckliche Wahl erreicht der Init den Anruf nach dem Laden mit languageExplicit false", async () => {
  const { a, b } = await zweiInstanzen();
  await legeAnrufAn(a, { anlage: { language: "de" } });
  const antwort = await initAntwort(b);
  assert.equal(antwort.sprache_ausdruecklich, false);
});
