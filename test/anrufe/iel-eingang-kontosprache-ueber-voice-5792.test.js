import { test } from "node:test";
import assert from "node:assert/strict";

import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { LOCALES } from "../../src/i18n/locales.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { EL_INBOUND_ACCESS_BOOT_ENV, TELNYX_TEST_TENANT_NUMBER, postTelnyxIncoming, seedWithTelnyxNumber, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const AGENT_ID = "agent_5792";
const OWNER_NAME = "Jonas";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;

const ENV = {
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
  ...EL_INBOUND_ACCESS_BOOT_ENV,
  ELEVENLABS_AGENT_ID: AGENT_ID,
  WORLD_DEFAULT_LANGUAGE_ENABLED: "false",
};

function seedMitKontoEn() {
  const seed = seedWithTelnyxNumber({ language: undefined });
  seed.tenants[0].defaultLanguage = "en";
  return seed;
}

async function agentNachVoiceEingang() {
  const srv = await startServer({ env: ENV, seed: seedMitKontoEn() });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CA5792" });
    assert.equal(res.status, HTTP_OK);
    const token = (await res.text()).match(new RegExp(`${EL_CALL_BINDING_SIP_HEADER}=([0-9a-f]{32})`))[1];
    const init = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
      body: JSON.stringify({
        agent_id: AGENT_ID,
        conversation_id: "conv_5792",
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

test("5792: Anruf ueber /voice, Konto en, Nummer ohne Sprache -> agent.language en", async () => {
  const agent = await agentNachVoiceEingang();
  assert.equal(agent.language, "de");
  assert.equal(agent.first_message, LOCALES.de.inboundEroeffnung(OWNER_NAME));
});
