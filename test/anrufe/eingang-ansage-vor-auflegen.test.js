import { test } from "node:test";
import assert from "node:assert/strict";

import { FAKE_REST_CHUNK } from "../helpers/fake-tts-stream.mjs";
import { playTtsEnv, startSyntheseOrigin } from "../gemeinsam/play-tts-server.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  TELNYX_TEST_PEER_NUMBER,
  TELNYX_TEST_SIGNATURE_HEADERS,
  TELNYX_TEST_TENANT_NUMBER,
  seedWithTelnyxNumber,
  startServer,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const KURZE_GESAMTFRIST_MS = 1000;

const SYNTHESE_ENDE = Object.freeze({ HAENGT: "haengt", REISST_AB: "reisst_ab", VOLLSTAENDIG: "vollstaendig" });

const EL_ALLOWLIST_ENV = Object.freeze({
  ELEVENLABS_INBOUND_ENABLED: "true",
  ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
  ELEVENLABS_INBOUND_SCOPE: "allowlist",
  ...EL_INBOUND_ACCESS_BOOT_ENV,
});

function beendeSynthese(ende) {
  return (res, req) => {
    if (ende === SYNTHESE_ENDE.VOLLSTAENDIG) res.end(Buffer.from(FAKE_REST_CHUNK));
    if (ende === SYNTHESE_ENDE.REISST_AB) setImmediate(() => req.socket.destroy());
  };
}

async function mitSynthese({ ende, env, gesamtfristMs = KURZE_GESAMTFRIST_MS }, lauf) {
  const origin = await startSyntheseOrigin(beendeSynthese(ende));
  const srv = await startServer({
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: { ...env, ...playTtsEnv(origin.url), ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS: String(gesamtfristMs) },
  });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
    await origin.close();
  }
}

function pruefeSayDannHangup(texml) {
  assert.ok(!texml.includes("<Play>"), `kein Play bei unvollstaendiger Synthese: ${texml}`);
  assert.match(texml, /<Say [^>]*>[^<]*technischer Fehler[^<]*<\/Say><Hangup\/><\/Response>$/);
}

async function incomingAntwort(srv, callSid, wartezeitMs) {
  const res = await abrufMitFrist(
    `${srv.localUrl}/voice/incoming`,
    {
      method: "POST",
      headers: TELNYX_TEST_SIGNATURE_HEADERS,
      body: new URLSearchParams({ From: TELNYX_TEST_PEER_NUMBER, To: TELNYX_TEST_TENANT_NUMBER, CallSid: callSid }),
    },
    { wartezeitMs },
  );
  assert.equal(res.status, HTTP_OK);
  return res.text();
}

test("Rueckfall nach gescheiterter Uebergabe: Synthese haengt -> Say und Hangup", async () => {
  await mitSynthese({ ende: SYNTHESE_ENDE.HAENGT, env: EL_ALLOWLIST_ENV }, async (srv) => {
    await incomingAntwort(srv, "CAvorauflegenrueckfall");
    const [{ id: callId }] = srv.readStore().calls;
    const res = await abrufMitFrist(`${srv.localUrl}/voice/el-rueckfall?callId=${callId}&quelle=dial_ende`, {
      method: "POST",
      body: new URLSearchParams({}),
    });
    assert.equal(res.status, HTTP_OK);
    pruefeSayDannHangup(await res.text());
  });
});
