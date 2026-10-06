import { test } from "node:test";
import assert from "node:assert/strict";
import { makeVoiceRender } from "../src/telephony/voice-render.js";

const fakeConfig = {
  server: { publicUrl: "https://agent.test" },
  voice: { sttSpeechTimeoutSec: 2 },
};

test("S1-14b: telnyx-Call -> absolute Action-URL (config.publicUrl-Praefix)", () => {
  const { turnDirectives } = makeVoiceRender({ config: fakeConfig });
  const [gatherD, redirectD] = turnDirectives(
    { id: "call_2", provider: "telnyx", language: "de" },
    "Hallo",
  );
  assert.match(
    gatherD.action,
    /^https:\/\/agent\.test\/voice\/turn\?callId=call_2&turnToken=[0-9a-f]{16}$/,
  );
  assert.equal(redirectD.url, gatherD.action);
});

test("BEFUND (Charakterisierung): Call ohne provider -> TeXML-Renderer, aber RELATIVE Action-URL", () => {
  const { turnDirectives } = makeVoiceRender({ config: fakeConfig });
  const [gatherD, redirectD] = turnDirectives({ id: "call_12", language: "de" }, "Hallo");
  assert.match(gatherD.action, /^\/voice\/turn\?callId=call_12&turnToken=[0-9a-f]{16}$/);
  assert.equal(redirectD.url, gatherD.action);
});
