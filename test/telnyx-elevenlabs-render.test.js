// ElevenLabs-TTS ueber Telnyx (globale Plattform-Stimme): Snapshot-Tests fuer den
// opts.elevenLabs-Zweig des Telnyx-Renderers. Pur (kein Env, kein Spawn) - in
// Produktion injiziert die Registry config.telnyxElevenLabs, hier kommen die opts
// direkt. Pinnt: (1) Say-Attribute voice+api_key_ref OHNE language-Attribut,
// (2) Gather-STT-Attribute byte-identisch zum Azure-Bestand (STT bleibt Deepgram -
// Telnyx unterstuetzt ElevenLabs nur fuer TTS), (3) innerer Gather-Say erbt die
// ElevenLabs-Stimme, (4) halbes/leeres Gate -> Azure fail-safe ohne Wurf,
// (5) Model-Slot-Override. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, hangup, VOICE_PROFILE } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const EL = { apiKeyRef: "elevenlabs_prod", voiceId: "abc123", model: "Default" };
const OPTS = { elevenLabs: EL };

test("ElevenLabs-Say: voice=ElevenLabs.Default.<id> + api_key_ref, KEIN language-Attribut", () => {
  const out = renderDirectives([say("Hallo & <Test>"), hangup()], OPTS);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="ElevenLabs.Default.abc123" api_key_ref="elevenlabs_prod">Hallo &amp; &lt;Test&gt;</Say>' +
      "<Hangup/></Response>",
  );
});

test("ElevenLabs-Gather: STT-Attribute byte-identisch zum Azure-Bestand, innerer Say erbt die Stimme", () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1" })], OPTS);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=c1" method="POST">' +
      '<Say voice="ElevenLabs.Default.abc123" api_key_ref="elevenlabs_prod">Hallo?</Say>' +
      "</Gather>" +
      "</Response>",
  );
});

// VOICE-12 (tasks/i18n-tests/03-telefonie-render.md): eine Voice-ID fuer alle drei
// Sprachen, kein `language`-Attribut am ElevenLabs-<Say>. DE traegt der byte-exakte Test
// oben, FR/EN dieser Test - der Regex unten schliesst unmittelbar hinter `api_key_ref` mit
// `>`, das IST der Beweis fuer das fehlende `language`-Attribut. Kein zweiter Test (G5).
test("ElevenLabs + FR/EN-Profil: STT-Locale folgt dem Profil, Voice bleibt dieselbe ID (multilingual)", () => {
  for (const [profile, locale] of [
    [VOICE_PROFILE.FR_FEMALE_NEURAL, "fr-FR"],
    [VOICE_PROFILE.EN_FEMALE_NEURAL, "en-GB"],
  ]) {
    const out = renderDirectives(
      [gather({ promptText: "Oui?", action: "/x", voiceProfile: profile })],
      OPTS,
    );
    assert.match(out, new RegExp(`<Gather\\b[^>]*\\blanguage="${locale}"`), `STT-Locale ${locale}`);
    assert.match(
      out,
      /<Say voice="ElevenLabs\.Default\.abc123" api_key_ref="elevenlabs_prod">/,
      "eine Voice-ID fuer alle Sprachen",
    );
  }
});

test("Gate halb/aus -> Azure-Bestand byte-identisch (fail-safe, kein Wurf mitten im Call)", () => {
  const dirs = () => [say("Hi"), hangup()];
  const azure = renderDirectives(dirs());
  assert.match(azure, /voice="Azure\.de-DE-KatjaNeural"/, "Referenz ist der Azure-Bestand");
  assert.equal(renderDirectives(dirs(), {}), azure);
  assert.equal(renderDirectives(dirs(), { elevenLabs: { apiKeyRef: "r", voiceId: "" } }), azure);
  assert.equal(renderDirectives(dirs(), { elevenLabs: { apiKeyRef: "", voiceId: "v" } }), azure);
});

test("Model-Slot-Override: model=v3 -> ElevenLabs.v3.<id>; leer -> Default", () => {
  const v3 = renderDirectives([say("Hi")], { elevenLabs: { ...EL, model: "v3" } });
  assert.match(v3, /voice="ElevenLabs\.v3\.abc123"/);
  const empty = renderDirectives([say("Hi")], { elevenLabs: { ...EL, model: "" } });
  assert.match(empty, /voice="ElevenLabs\.Default\.abc123"/);
});
