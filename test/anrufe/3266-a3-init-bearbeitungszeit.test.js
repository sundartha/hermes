import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, seedCall, startServer } from "../helpers.js";
import { INBOUND_TO, elInboundInitSpawnEnv, spawnSeedWartenderElCall } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const AGENT_ID = "agent_3266_a3";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const ABSENDER = "+15005550006";
const TOKEN_BREITE = 32;
const AUSGEHEND_ID = "call_3266_a3_aus";
const EINGEHEND_ID = "call_3266_a3_ein";

const bindungsToken = (nummer) => String(nummer).padStart(TOKEN_BREITE, "0");

const ausgehend = seedCall({
  id: AUSGEHEND_ID,
  direction: "outbound",
  from: ABSENDER,
  to: "+491737250000",
  answeredAt: new Date().toISOString(),
  costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
  streamToken: bindungsToken(1),
});

function seed() {
  const eingehend = spawnSeedWartenderElCall({ callId: EINGEHEND_ID, bindungsToken: bindungsToken(2), answeredVorS: 1 });
  return { ...eingehend, calls: [...eingehend.calls, ausgehend] };
}

async function binde(srv, { token, calledNumber, conversationId }) {
  const startMs = performance.now();
  const antwort = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: conversationId,
      called_number: calledNumber,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: token },
    }),
  });
  assert.equal(antwort.status, HTTP_OK, await antwort.text());
  return performance.now() - startMs;
}

const gebundenZeile = (srv, callId) =>
  srv.stdout.split("\n").find((zeile) => zeile.startsWith(`[el-init] gebunden call=${callId} `)) ?? "";

test("3266-A3-1: [el-init] gebunden traegt bei ausgehenden Bruecken die Bearbeitungszeit in ganzen ms, eingehend unveraendert", async () => {
  const srv = await startServer({ env: elInboundInitSpawnEnv(AGENT_ID), seed: seed() });
  try {
    const dauerMs = await binde(srv, { token: ausgehend.streamToken, calledNumber: ABSENDER, conversationId: "conv_3266_a3_aus" });
    await binde(srv, { token: bindungsToken(2), calledNumber: INBOUND_TO, conversationId: "conv_3266_a3_ein" });

    const zeile = gebundenZeile(srv, AUSGEHEND_ID);
    const treffer = zeile.match(/^\[el-init\] gebunden call=\S+ ms_seit_annahme=-?\d+ ms_bearbeitung=(\d+)$/);
    assert.ok(treffer, srv.stdout);
    assert.ok(Number(treffer[1]) <= Math.ceil(dauerMs), `${treffer[1]} ms > Anfragedauer ${dauerMs} ms`);

    const eingehendZeile = gebundenZeile(srv, EINGEHEND_ID);
    assert.match(eingehendZeile, /^\[el-init\] gebunden call=\S+ ms_seit_annahme=-?\d+$/, srv.stdout);
  } finally {
    await srv.stop();
  }
});
