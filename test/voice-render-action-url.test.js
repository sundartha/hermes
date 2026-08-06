// S1-14: makeVoiceRender direkt (kein Server-Spawn) - turnDirectives() liefert
// [gather, redirect]; nur die action/url-Felder werden geprueft (Werte, kein Byte-
// Markup -> flakefrei). twilio -> relative Action-URL; telnyx -> absolute URL (TeXML
// loest relative URLs anders auf als Twilio, config.publicUrl zur Laufzeit gelesen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeVoiceRender } from "../src/telephony/voice-render.js";

const fakeConfig = {
  server: { publicUrl: "https://agent.test" },
  voice: { sttSpeechTimeoutSec: 2 },
};

test("S1-14a: twilio-Call -> relative Action-URL (Bestand)", () => {
  const { turnDirectives } = makeVoiceRender({ config: fakeConfig });
  const [gatherD, redirectD] = turnDirectives(
    { id: "call_1", provider: "twilio", language: "de" },
    "Hallo",
  );
  assert.equal(gatherD.action, "/voice/turn?callId=call_1");
  assert.equal(redirectD.url, "/voice/turn?callId=call_1");
});

test("S1-14b: telnyx-Call -> absolute Action-URL (config.publicUrl-Praefix)", () => {
  const { turnDirectives } = makeVoiceRender({ config: fakeConfig });
  const [gatherD, redirectD] = turnDirectives(
    { id: "call_2", provider: "telnyx", language: "de" },
    "Hallo",
  );
  assert.equal(gatherD.action, "https://agent.test/voice/turn?callId=call_2");
  assert.equal(redirectD.url, "https://agent.test/voice/turn?callId=call_2");
});

// S3 (P8-Testluecke): streamDirectives() - https->wss-Ersetzung + provider-abhaengiger
// MEDIA_PATH (twilio/telnyx) + Param-Form (call_id/stream_token). Bisher ungetestet.
test("S3: streamDirectives -> wss-URL + Provider-Pfad (twilio)", () => {
  const { streamDirectives } = makeVoiceRender({ config: fakeConfig });
  const [stream] = streamDirectives({ id: "call_9", provider: "twilio", streamToken: "tok9" });
  assert.equal(stream.url, "wss://agent.test/media");
  assert.deepEqual(stream.params, [
    { name: "call_id", value: "call_9" },
    { name: "stream_token", value: "tok9" },
  ]);
});

test("S3: streamDirectives -> telnyx-Media-Pfad", () => {
  const { streamDirectives } = makeVoiceRender({ config: fakeConfig });
  const [stream] = streamDirectives({ id: "call_10", provider: "telnyx", streamToken: "tok10" });
  assert.equal(stream.url, "wss://agent.test/media/telnyx");
});

// C-P1: der vierte DEFAULT_PROVIDER-Leser (MEDIA_PATH-Rueckfall) war bisher ungetestet -
// beide Tests oben setzen provider explizit. Literal statt MEDIA_PATH[DEFAULT_PROVIDER],
// damit die Assertion beim Zurueckdrehen des Flips ROT wird statt mitzuwandern.
test("C-P1: streamDirectives ohne call.provider -> Media-Pfad des Rueckfalls (Telnyx)", () => {
  const { streamDirectives } = makeVoiceRender({ config: fakeConfig });
  const [stream] = streamDirectives({ id: "call_11", streamToken: "tok11" });
  assert.equal(stream.url, "wss://agent.test/media/telnyx");
});
