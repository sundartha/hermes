// P9 - Regressionsschutz fuer die EINE Locale-Quelle und die sprach-aufgeloeste
// ElevenLabs-Stimme. Zwei Verhaltensaenderungen werden hier gepinnt:
// (1) der Renderer holt das `language`-Attribut aus dem Locale-Buendel
//     (src/i18n/locales.js) statt aus einer eigenen Voice-Tabelle - gemessen gegen den
//     BUENDELWERT, nicht gegen ein Literal: aendert jemand LOCALES.fr.sttLocale, folgt
//     der Renderer oder dieser Test ist rot (das ist der Drift-Faenger);
// (2) die ElevenLabs-Voice-ID folgt der Sprache (Owner-Entscheidung 2026-08-18) - seit
//     diesem Tag fuer ALLE DREI Sprachen, auch fuer DE. Vorher fiel Deutsch auf die global
//     konfigurierte Plattform-Stimme zurueck; war die nicht gesetzt, sprach ein deutsches
//     Gespraech in der Dashboard-Stimme des Agenten (an Anruf 7 gemessen: en/american).
//     Messpunkt seit IP3 ist die Play-TTS-Vorabsynthese (test/directive-synth.test.js);
//     hier wird nur noch gepinnt, dass opts.elevenLabs den Renderer nicht mehr erreicht.
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

test("Assistant-speak (Call-Control) bleibt bewusst bei der GLOBALEN Stimme - der Renderer (TeXML/Play-TTS) loest sprachaufgeloest auf, der Assistant danach nicht (RCA-Wurzel R5)", () => {
  // speakVoiceFields (src/telephony/adapters/telnyx/voice.js) nutzt elevenLabsVoiceName(el)
  // OHNE voiceProfile - das ist die einzige Stelle, an der der Assistant-Pfad danach spricht
  // (EIN global provisioniertes Voice-Setting, scripts/telnyx-assistant-provision.mjs). Fuer
  // Der Assistant-Pfad weicht ABSICHTLICH vom sprachaufgeloesten Renderer ab, sonst
  // spraeche der speak-Node in der Sprache des Anrufs, der folgende Assistant aber weiter
  // in der global provisionierten (Review-Runde 2, R5-Regression). SEIT 2026-08-18 gilt das
  // fuer ALLE DREI Profile: vorher fiel DE mit der globalen Stimme zusammen, weil es keine
  // eigene hatte - die Uebereinstimmung war ein Nebeneffekt des Lochs, keine Zusage.
  const globalVoice = elevenLabsVoiceName(EL);
  for (const voiceProfile of Object.values(VOICE_PROFILE)) {
    const rendered = renderTelnyx([say("Text", voiceProfile)], OPTS).match(
      /<Say voice="([^"]+)"/,
    )[1];
    assert.notEqual(
      globalVoice,
      rendered,
      `${voiceProfile}: Renderer loest sprachaufgeloest auf, Assistant-Pfad bleibt bewusst global`,
    );
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
