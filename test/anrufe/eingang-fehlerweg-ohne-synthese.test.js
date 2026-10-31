import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { playTtsEnv, startSyntheseOrigin } from "../gemeinsam/play-tts-server.mjs";
import {
  TELNYX_TEST_PEER_NUMBER,
  TELNYX_TEST_SIGNATURE_HEADERS,
  TELNYX_TEST_TENANT_NUMBER,
  seedWithTelnyxNumber,
  startServer,
} from "../helpers.js";
import { FAKE_REST_CHUNK } from "../helpers/fake-tts-stream.mjs";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;

function machePlattenSpeicherUnbeschreibbar(dataDir) {
  const datei = path.join(dataDir, "store.json");
  fs.rmSync(datei);
  fs.mkdirSync(datei);
  fs.writeFileSync(path.join(datei, "belegt"), "");
}

async function mitSynthese(lauf) {
  const origin = await startSyntheseOrigin((res) => res.end(Buffer.from(FAKE_REST_CHUNK)));
  const srv = await startServer({
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: playTtsEnv(origin.url),
  });
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
    await origin.close();
  }
}

test("Speicher faellt mitten im Anruf aus: die Gespraechsrunde antwortet Telnyx trotzdem mit Say und Hangup, mit Logzeile", async () => {
  await mitSynthese(async (srv) => {
    const eingang = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      headers: TELNYX_TEST_SIGNATURE_HEADERS,
      body: new URLSearchParams({
        From: TELNYX_TEST_PEER_NUMBER,
        To: TELNYX_TEST_TENANT_NUMBER,
        CallSid: "CAfehlerwegspeicher",
      }),
    });
    assert.equal(eingang.status, HTTP_OK);
    const [{ id: callId }] = srv.readStore().calls;
    machePlattenSpeicherUnbeschreibbar(srv.dataDir);

    const res = await abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${callId}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Hallo" }),
    });
    assert.equal(res.status, HTTP_OK);
    const texml = await res.text();
    assert.ok(!texml.includes("<Play>"), `kein vorab synthetisiertes Audio im Fehlerweg: ${texml}`);
    assert.match(texml, /<Say [^>]*>[^<]+<\/Say><Hangup\/><\/Response>$/);
    assert.match(srv.stdout, /\[play-tts\] Synthese geworfen/);
  });
});
