import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, hangup, VOICE_PROFILE } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const EL = { apiKeyRef: "elevenlabs_prod", voiceId: "abc123", model: "Default" };
const OPTS = { elevenLabs: EL };

function assertInert(directives, opts, label) {
  assert.equal(renderDirectives(directives, opts), renderDirectives(directives), label);
}

test("Selbstarmierung weg: vollstaendiges elevenLabs-opts rendert TROTZDEM Azure - kein api_key_ref, kein ElevenLabs-Voice-Name", () => {
  const dirs = [say("Hallo & <Test>"), hangup()];
  const out = renderDirectives(dirs, OPTS);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">Hallo &amp; &lt;Test&gt;</Say>' +
      "<Hangup/></Response>",
  );
  assert.ok(!out.includes("api_key_ref"), "kein api_key_ref am <Say>");
  assert.ok(!out.includes("ElevenLabs."), "kein ElevenLabs-Voice-Name am <Say>");
});

test("Selbstarmierung weg: Gather-STT-Attribute byte-identisch, innerer Say bleibt Azure", () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1" })], OPTS);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=c1" method="POST">' +
      '<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">Hallo?</Say>' +
      "</Gather>" +
      "</Response>",
  );
});

test("Selbstarmierung weg fuer JEDES Sprachprofil: STT-Locale folgt der Sprache, die Stimme bleibt Azure", () => {
  for (const [profile, locale, azureVoice] of [
    [VOICE_PROFILE.DE_FEMALE_NEURAL, "de-DE", "Azure.de-DE-KatjaNeural"],
    [VOICE_PROFILE.FR_FEMALE_NEURAL, "fr-FR", "Azure.fr-FR-DeniseNeural"],
    [VOICE_PROFILE.EN_FEMALE_NEURAL, "en-GB", "Azure.en-GB-SoniaNeural"],
  ]) {
    const dirs = [gather({ promptText: "Oui?", action: "/x", voiceProfile: profile })];
    const out = renderDirectives(dirs, OPTS);
    assertInert(dirs, OPTS, `${profile}: opts inert`);
    assert.match(out, new RegExp(`<Gather\\b[^>]*\\blanguage="${locale}"`), `STT-Locale ${locale}`);
    assert.match(out, new RegExp(`<Say voice="${azureVoice}"`), "Stimme bleibt Azure");
    assert.ok(!out.includes("ElevenLabs."), `${profile}: kein ElevenLabs-Say`);
  }
});

test("opts.elevenLabs ist INERT statt verboten: kein Zustand (fehlend/leer/halb/voll) aendert das TeXML, keiner wirft", () => {
  const dirs = () => [say("Hi"), hangup()];
  assert.match(renderDirectives(dirs()), /voice="Azure\.de-DE-KatjaNeural"/, "Referenz ist der Azure-Bestand");
  for (const opts of [
    undefined,
    {},
    { elevenLabs: undefined },
    { elevenLabs: {} },
    { elevenLabs: { apiKeyRef: "r", voiceId: "" } },
    { elevenLabs: { apiKeyRef: "", voiceId: "v" } },
    { elevenLabs: EL },
  ])
    assertInert(dirs(), opts, `opts=${JSON.stringify(opts) ?? "undefined"}`);
});

test("Model-Slot inert: model=v3 und model=\"\" aendern nichts - der Slot existierte nur am Relay", () => {
  const dirs = () => [say("Hi")];
  assertInert(dirs(), { elevenLabs: { ...EL, model: "v3" } }, "model=v3 inert");
  assertInert(dirs(), { elevenLabs: { ...EL, model: "" } }, 'model="" inert');
});
