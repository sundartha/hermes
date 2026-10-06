import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives as renderTelnyx } from "../src/telephony/adapters/telnyx/render.js";
import { sttLocaleForVoiceProfile } from "../src/telephony/voice-locale.js";
import { say, gather, VOICE_PROFILE } from "../src/telephony/directives.js";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";

const EL = { apiKeyRef: "elevenlabs_prod", voiceId: "platform-de", model: "Default" };
const OPTS = { elevenLabs: EL };

test("Voice-Tabellen fuehren die STT-Locale nicht mehr selbst - der Renderer folgt dem Locale-Buendel", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const { voiceProfile, sttLocale } = LOCALES[language];
    const dirs = [gather({ promptText: "Hallo?", action: "/x", voiceProfile })];
    assert.match(
      renderTelnyx(dirs),
      new RegExp(`<Gather\\b[^>]*\\blanguage="${sttLocale}"`),
      `Telnyx-Gather ${language} -> ${sttLocale}`,
    );
    assert.equal(sttLocaleForVoiceProfile(voiceProfile), sttLocale);
  }
});

test("sttLocaleForVoiceProfile wirft fail-closed beim Fremdprofil - kein stiller de-DE-Fallback", () => {
  assert.throws(() => sttLocaleForVoiceProfile("en-US-female-neural"), /unbekanntes voiceProfile/);
  assert.throws(() => sttLocaleForVoiceProfile(undefined), /unbekanntes voiceProfile/);
});

test("opts.elevenLabs erreicht den TeXML-Renderer nicht mehr (IP3): jedes Profil rendert Azure - die kuratierten IDs sind am Play-TTS-Pfad gepinnt", () => {
  for (const voiceProfile of Object.values(VOICE_PROFILE)) {
    const dirs = [say("Text", voiceProfile)];
    assert.equal(renderTelnyx(dirs, OPTS), renderTelnyx(dirs), `${voiceProfile}: opts inert`);
    assert.ok(!renderTelnyx(dirs, OPTS).includes("ElevenLabs."), `${voiceProfile}: kein ElevenLabs-Say`);
  }
});

test("Halbes/leeres/VOLLSTAENDIGES elevenLabs-opts -> Azure-Bestand, auch fuer FR/EN (inert seit IP3)", () => {
  const dirs = [say("Bonjour", VOICE_PROFILE.FR_FEMALE_NEURAL)];
  const azure = renderTelnyx(dirs);
  assert.match(azure, /voice="Azure\.fr-FR-DeniseNeural" language="fr-FR"/);
  assert.equal(renderTelnyx(dirs, {}), azure);
  assert.equal(renderTelnyx(dirs, { elevenLabs: { apiKeyRef: "r", voiceId: "" } }), azure);
  assert.equal(renderTelnyx(dirs, { elevenLabs: { apiKeyRef: "", voiceId: "v" } }), azure);
  assert.equal(renderTelnyx(dirs, { elevenLabs: EL }), azure);
});
