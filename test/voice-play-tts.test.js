// Play-TTS end-to-end (Server-Spawn, json-Store, Telnyx-Outbound-Pfad): mit
// ELEVENLABS_PLAY_TTS_ENABLED=true + einem lokalen Fake-ElevenLabs-Origin rendert
// /voice/outbound ein <Play> statt <Say> und die Serve-URL liefert die Bytes GENAU
// EINMAL (danach 404). Flag AUS bleibt byte-identisch auf dem Azure-<Say>-Bestand
// (kein <Play>). Offline/deterministisch: der Fake-Origin laeuft auf Loopback, kein
// echter ElevenLabs-Key noetig (Muster telnyx-elevenlabs-inbound.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runOutbound, runOutboundKeepOpen } from "./_outbound-harness.js";

const FAKE_MP3_BYTES = Buffer.from([0x49, 0x44, 0x33, 0x01, 0x02, 0x03]); // Fake-"ID3"-Praefix

// Fake-ElevenLabs-Origin: antwortet auf JEDEN POST mit festen mp3-Bytes (kein echtes
// Netz, kein echter Key). requests[] zeichnet Pfad+Query fuer optionale Assertions auf.
async function startFakeElevenLabsOrigin() {
  const requests = [];
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url });
      res.setHeader("content-type", "audio/mpeg");
      res.end(FAKE_MP3_BYTES);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

const PLAY_TTS_ENV_BASE = {
  ELEVENLABS_API_KEY: "test-elevenlabs-key",
  ELEVENLABS_VOICE_ID: "voice-1",
};

test("Flag AN: /voice/outbound (Telnyx) rendert <Play> statt <Say>; Token liefert die Bytes GENAU EINMAL", async () => {
  const origin = await startFakeElevenLabsOrigin();
  try {
    const { body, srv } = await runOutboundKeepOpen({
      provider: "telnyx",
      env: {
        ...PLAY_TTS_ENV_BASE,
        ELEVENLABS_PLAY_TTS_ENABLED: "true",
        ELEVENLABS_API_BASE: origin.url,
      },
    });
    try {
      assert.match(body, /<Play>https:\/\/agent\.test\/voice\/tts\/[A-Za-z0-9_-]+<\/Play>/);
      assert.doesNotMatch(body, /<Say\b/, "kein <Say> mehr, wenn Play-TTS greift");
      assert.equal(origin.requests.length, 1, "genau EIN Synth-Call pro Turn");
      assert.match(origin.requests[0].url, /output_format=/, "output_format ist Query-Parameter");

      const token = body.match(/\/voice\/tts\/([A-Za-z0-9_-]+)/)[1];
      const first = await fetch(`${srv.localUrl}/voice/tts/${token}`);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get("content-type"), "audio/mpeg");
      const gotBytes = Buffer.from(await first.arrayBuffer());
      assert.deepEqual(gotBytes, FAKE_MP3_BYTES);

      const second = await fetch(`${srv.localUrl}/voice/tts/${token}`);
      assert.equal(second.status, 404, "zweiter Abruf desselben Tokens -> 404 (EINMALIG)");
    } finally {
      await srv.stop();
    }
  } finally {
    await origin.close();
  }
});

test("Flag AUS: /voice/outbound (Telnyx) bleibt byte-identisch auf dem Azure-<Say>-Bestand (kein <Play>)", async () => {
  const { body } = await runOutbound({ provider: "telnyx" });
  assert.match(body, /<Say voice="Azure\.de-DE-KatjaNeural"/, "Azure-Bestand unveraendert");
  assert.doesNotMatch(body, /<Play>/, "Gate aus -> kein Play-Zweig");
});

// S1-2: das Provider-Gate in synthesizeDirectiveAudio (call.provider !== PROVIDER.TELNYX
// -> kein ElevenLabs-Call) war bislang ungetestet. Flag AN, aber provider=twilio: der
// Twilio-Renderer bleibt byte-identisch auf Polly-<Say> (Twilio hat gar kein Azure/
// ElevenLabs-Voice-Profil), UND am Fake-ElevenLabs-Origin darf KEIN Request ankommen -
// das Gate darf niemals Twilio-Calls an ElevenLabs synthetisieren lassen (Kosten/Scope).
test("Flag AN + provider=twilio: Renderer-Bestand unveraendert, KEIN Request an ElevenLabs (Twilio-Gate)", async () => {
  const origin = await startFakeElevenLabsOrigin();
  try {
    const { body } = await runOutbound({
      provider: "twilio",
      env: {
        ...PLAY_TTS_ENV_BASE,
        ELEVENLABS_PLAY_TTS_ENABLED: "true",
        ELEVENLABS_API_BASE: origin.url,
      },
    });
    assert.match(body, /<Say voice="Polly\.Vicki-Neural"/, "Twilio-Bestand unveraendert (kein Azure/ElevenLabs)");
    assert.doesNotMatch(body, /<Play>/, "Twilio-Gate: kein Play-Zweig, auch bei Flag AN");
    assert.equal(origin.requests.length, 0, "Twilio-Gate: KEIN Synth-Request an ElevenLabs ausgeloest");
  } finally {
    await origin.close();
  }
});
