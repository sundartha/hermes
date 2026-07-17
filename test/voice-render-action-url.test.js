// S1-14: makeVoiceRender direkt (kein Server-Spawn) - turnDirectives() liefert
// [gather, redirect]; nur die action/url-Felder werden geprueft (Werte, kein Byte-
// Markup -> flakefrei). twilio -> relative Action-URL; telnyx -> absolute URL (TeXML
// loest relative URLs anders auf als Twilio, config.publicUrl zur Laufzeit gelesen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeVoiceRender } from "../src/telephony/voice-render.js";

const fakeConfig = { publicUrl: "https://agent.test", sttSpeechTimeoutSec: 2 };

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
