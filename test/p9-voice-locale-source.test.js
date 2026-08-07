// P9 - Regressionsschutz fuer die EINE Locale-Quelle und die sprach-aufgeloeste
// ElevenLabs-Stimme. Zwei Verhaltensaenderungen werden hier gepinnt:
// (1) der Renderer holt das `language`-Attribut aus dem Locale-Buendel
//     (src/i18n/locales.js) statt aus einer eigenen Voice-Tabelle - gemessen gegen den
//     BUENDELWERT, nicht gegen ein Literal: aendert jemand LOCALES.fr.sttLocale, folgt
//     der Renderer oder dieser Test ist rot (das ist der Drift-Faenger);
// (2) die ElevenLabs-Voice-ID folgt der Sprache (Owner-Entscheidung 2026-07-27), DE bleibt
//     die global konfigurierte Plattform-Stimme.
// Pur, offline, kein Env, kein Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives as renderTelnyx } from "../src/telephony/adapters/telnyx/render.js";
import { elevenLabsVoiceName } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";
import { sttLocaleForVoiceProfile } from "../src/telephony/voice-locale.js";
import { say, gather, VOICE_PROFILE } from "../src/telephony/directives.js";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";

const EL = { apiKeyRef: "elevenlabs_prod", voiceId: "platform-de", model: "Default" };
const OPTS = { elevenLabs: EL };
// Bindende Owner-IDs (2026-07-27). Byte-genau gepinnt, damit die Entscheidung nicht
// lautlos driftet. DE steht bewusst NICHT hier: Deutsch bleibt el.voiceId.
const FR_VOICE_ID = "FFXYdAYPzn8Tw8KiHZqg";
const EN_VOICE_ID = "wOPou4MhRIYEqQHVxjmp";

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

test("ElevenLabs-Stimme je Sprache: DE = Plattform-Stimme, FR/EN = kuratierte IDs", () => {
  const voiceIdOf = (voiceProfile) => {
    const out = renderTelnyx([say("Text", voiceProfile)], OPTS);
    const m = out.match(/<Say voice="ElevenLabs\.[^.]+\.([^"]+)"/);
    assert.ok(m, `kein ElevenLabs-Say gerendert fuer ${voiceProfile}`);
    return m[1];
  };
  assert.equal(voiceIdOf(VOICE_PROFILE.DE_FEMALE_NEURAL), EL.voiceId);
  assert.equal(voiceIdOf(VOICE_PROFILE.FR_FEMALE_NEURAL), FR_VOICE_ID);
  assert.equal(voiceIdOf(VOICE_PROFILE.EN_FEMALE_NEURAL), EN_VOICE_ID);
});

test("Assistant-speak (Call-Control) bleibt bewusst bei der GLOBALEN Stimme - der Renderer (TeXML/Play-TTS) loest sprachaufgeloest auf, der Assistant danach nicht (RCA-Wurzel R5)", () => {
  // speakVoiceFields (src/telephony/adapters/telnyx/voice.js) nutzt elevenLabsVoiceName(el)
  // OHNE voiceProfile - das ist die einzige Stelle, an der der Assistant-Pfad danach spricht
  // (EIN global provisioniertes Voice-Setting, scripts/telnyx-assistant-provision.mjs). Fuer
  // DE stimmt das mit dem Renderer ueberein (beide = el.voiceId); fuer FR/EN weicht der
  // Assistant-Pfad ABSICHTLICH vom sprachaufgeloesten Renderer ab, sonst spraeche der
  // speak-Node FR/EN, der folgende Assistant aber weiter DE (Review-Runde 2, R5-Regression).
  const globalVoice = elevenLabsVoiceName(EL);
  for (const voiceProfile of Object.values(VOICE_PROFILE)) {
    const rendered = renderTelnyx([say("Text", voiceProfile)], OPTS).match(
      /<Say voice="([^"]+)"/,
    )[1];
    if (voiceProfile === VOICE_PROFILE.DE_FEMALE_NEURAL) {
      assert.equal(globalVoice, rendered, "DE: Assistant-Stimme und Renderer-Stimme sind dieselbe");
    } else {
      assert.notEqual(
        globalVoice,
        rendered,
        `${voiceProfile}: Renderer loest sprachaufgeloest auf, Assistant-Pfad bleibt bewusst global`,
      );
    }
  }
});

test("Halbes/leeres ElevenLabs-Gate -> Azure-Bestand, auch fuer FR/EN (fail-safe, kein Wurf im Call)", () => {
  const dirs = [say("Bonjour", VOICE_PROFILE.FR_FEMALE_NEURAL)];
  const azure = renderTelnyx(dirs);
  assert.match(azure, /voice="Azure\.fr-FR-DeniseNeural" language="fr-FR"/);
  assert.equal(renderTelnyx(dirs, {}), azure);
  assert.equal(renderTelnyx(dirs, { elevenLabs: { apiKeyRef: "r", voiceId: "" } }), azure);
  assert.equal(renderTelnyx(dirs, { elevenLabs: { apiKeyRef: "", voiceId: "v" } }), azure);
});
