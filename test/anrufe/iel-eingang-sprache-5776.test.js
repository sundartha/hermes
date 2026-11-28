import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { INIT_WEBHOOK_TOKEN_MIN_LENGTH } from "../../src/elevenlabs/inbound-path-decision.ts";
import { LOCALES } from "../../src/i18n/locales.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER, makeElevenLabsInitWebhookRoutes } from "../../src/routes/webhooks-elevenlabs-init.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { EL_INBOUND_ACCESS_BOOT_ENV } from "../helpers.js";
import { baueInitZustand, initBindungsKoerper } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const INIT_TOKEN = "i".repeat(INIT_WEBHOOK_TOKEN_MIN_LENGTH);
const AGENT_ID = "agent_iel_5776";
const FAKE_START_MS = Date.parse("2026-11-21T08:52:00.000Z");
const OWNER_NAME = "Antonio Beispiel";

const config = {
  voice: {
    elevenLabsInbound: {
      enabled: true,
      tenantIds: [BOOTSTRAP_TENANT_ID],
      sipUser: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_USER,
      sipPassword: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD,
      initWebhookToken: INIT_TOKEN,
    },
    elevenLabsOutbound: { agentId: AGENT_ID },
  },
  telnyx: { telnyxElevenLabs: { voiceId: "" } },
};

function zustand({ kontoSprache, nummerSprache }) {
  const { call, store } = baueInitZustand();
  const state = store.load();
  state.tenants[0].defaultLanguage = kontoSprache;
  state.tenants[0].ownerName = OWNER_NAME;
  if (nummerSprache !== undefined) state.numbers[0].language = nummerSprache;
  call.language = undefined;
  return { store, call };
}

async function initAntwort({ store, call }) {
  const app = express();
  app.use(express.json());
  app.use(makeElevenLabsInitWebhookRoutes({ store, config, bridges: { clearDeadlines: () => {} }, now: () => FAKE_START_MS }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
      body: JSON.stringify(initBindungsKoerper({ bindung: call.streamToken, agentId: AGENT_ID, conversationId: "conv_5776" })),
    });
    assert.equal(res.status, HTTP_OK);
    return JSON.parse(await res.text()).conversation_config_override.agent;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const faelle = [
  ["Konto de, Nummer ohne Sprache", { kontoSprache: "de", nummerSprache: undefined }, "de"],
  ["Konto de, Nummer mit leerer Sprache", { kontoSprache: "de", nummerSprache: "" }, "de"],
  ["Konto de, Nummer mit Sprache null", { kontoSprache: "de", nummerSprache: null }, "de"],
  ["Konto de, Nummer ausdruecklich fr", { kontoSprache: "de", nummerSprache: "fr" }, "de"],
];

for (const [name, eingabe, erwartet] of faelle) {
  test(`5776: Eingang ${name} -> agent.language ${erwartet}`, async () => {
    const agent = await initAntwort(zustand(eingabe));
    assert.equal(agent.language, erwartet);
    assert.equal(agent.first_message, LOCALES[erwartet].inboundEroeffnung(OWNER_NAME));
  });
}
