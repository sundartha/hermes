// IP2: Sprechpfad-Klassifikation (Unit) + Repo-Default-Regressionsfang (Integration).
// telnyx_relay ist seit IP3 am echten Renderer nicht erreichbar (render.js hat keinen
// ElevenLabs-<Say>-Zweig mehr) - die dritte Fixture ist deshalb ein literaler TeXML-
// String, keine renderDirectives()-Ausgabe (die diese Form nicht mehr erzeugen kann).
import { test } from "node:test";
import assert from "node:assert/strict";
// IP4: der Namensvorrat ist nach src/ gezogen (der Boot-Banner liest ihn seit IP4 mit) -
// dieselben Faelle, dieselben Zusicherungen, nur ein anderer Ort.
import { classifySprechpfad, SPRECHPFAD } from "../src/telephony/sprechpfad.js";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, VOICE_PROFILE } from "../src/telephony/directives.js";
import { startServer, seedWithTelnyxNumber, postTelnyxIncoming } from "./helpers.js";

const HTTP_OK = 200;

test("Klassifikation: <Play> -> play_tts", () => {
  const xml = renderDirectives([
    gather({ action: "/voice/turn", promptAudioUrl: "https://agent.test/voice/tts/tok123" }),
  ]);
  assert.equal(classifySprechpfad(xml), SPRECHPFAD.PLAY_TTS);
});

test('Klassifikation: <Say voice="Azure..."> -> azure_say', () => {
  const xml = renderDirectives([say("Hallo, hier ist der Assistent.", VOICE_PROFILE.DE_FEMALE_NEURAL)]);
  assert.equal(classifySprechpfad(xml), SPRECHPFAD.AZURE_SAY);
});

test('Klassifikation: <Say voice="ElevenLabs..."> (historische Relay-Form, seit IP3 am Renderer nicht mehr erzeugbar) -> telnyx_relay', () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    '<Say voice="ElevenLabs.eleven_flash_v2_5.voice123" api_key_ref="ref">Hallo</Say></Response>';
  assert.equal(classifySprechpfad(xml), SPRECHPFAD.TELNYX_RELAY);
});

test("Klassifikation Grenzfall: leeres Gather ohne Prompt -> null", () => {
  const xml = renderDirectives([gather({ action: "/voice/turn" })]);
  assert.equal(classifySprechpfad(xml), null);
});

test("Integration: Repo-Defaults rendern azure_say/Katja (IP3/IP4-Regressionsfang)", async () => {
  const srv = await startServer({ seed: seedWithTelnyxNumber({ language: "de" }) });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CAip2test" });
    assert.equal(res.status, HTTP_OK);
    const xml = await res.text();
    assert.equal(classifySprechpfad(xml), SPRECHPFAD.AZURE_SAY);
    assert.match(xml, /voice="Azure\.de-DE-KatjaNeural"/);
  } finally {
    await srv.stop();
  }
});
