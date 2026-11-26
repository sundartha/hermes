import { test } from "node:test";
import assert from "node:assert/strict";

import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { LOCALES } from "../../src/i18n/locales.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { EL_INBOUND_ACCESS_BOOT_ENV, TELNYX_TEST_TENANT_NUMBER, postTelnyxIncoming, seedWithTelnyxNumber, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const AGENT_ID = "agent_5789";
const OWNER_NAME = "Jonas";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;

const ENV = {
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
  ELEVENLABS_AGENT_ID: AGENT_ID,
};

function seedMitKontoDe(nummerSprache) {
  const seed = seedWithTelnyxNumber({ language: nummerSprache });
  seed.tenants[0].defaultLanguage = "de";
  return seed;
}

async function agentNachVoiceEingang(nummerSprache) {
  const srv = await startServer({ env: ENV, seed: seedMitKontoDe(nummerSprache) });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CA5789" });
    assert.equal(res.status, HTTP_OK);
    const token = (await res.text()).match(new RegExp(`${EL_CALL_BINDING_SIP_HEADER}=([0-9a-f]{32})`))[1];
    const init = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
      body: JSON.stringify({
        agent_id: AGENT_ID,
        conversation_id: "conv_5789",
        called_number: TELNYX_TEST_TENANT_NUMBER,
        sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: token },
      }),
    });
    assert.equal(init.status, HTTP_OK, await init.clone().text());
    return (await init.json()).conversation_config_override.agent;
  } finally {
    await srv.stop();
  }
}

test("5789: Anruf ueber /voice, Konto de, Nummer ohne Sprache -> agent.language de", async () => {
  const agent = await agentNachVoiceEingang(undefined);
  assert.equal(agent.language, "de");
  assert.equal(agent.first_message, LOCALES.de.inboundEroeffnung(OWNER_NAME));
});

test("5789: Anruf ueber /voice, Konto de, Nummer ausdruecklich fr -> agent.language fr", async () => {
  const agent = await agentNachVoiceEingang("fr");
  assert.equal(agent.language, "de");
  assert.equal(agent.first_message, LOCALES.de.inboundEroeffnung(OWNER_NAME));
});
