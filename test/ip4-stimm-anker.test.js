// IP4: "eine Stimme in beiden Richtungen" als GEPRUEFTE Invariante statt als Beobachtung.
//
// Gemessen werden DREI Stellen gegen EINE Aufloesung (elevenLabsVoiceIdFor):
//   (1) der Resolver selbst,
//   (2) tts.voice_id im ECHTEN Anfragekoerper des Outbound-Anrufstarts
//       (conversation_config_override - modul-privat, von aussen nur ueber den
//       abgegriffenen Koerper erreichbar: test/helpers/elevenlabs-anrufstart-attrappe.mjs),
//   (3) die Voice-ID, mit der die Play-TTS-Vorabsynthese ElevenLabs ruft
//       (test/helpers/play-tts-stimm-probe.mjs).
//
// REICHWEITE - WAS DIESER TEST BEWUSST NICHT PINNT: den Telnyx-AI-Assistant-Pfad.
// Dessen Speak-Node und dessen Provisionierung benutzen elevenLabsVoiceName mit der
// STATISCHEN Plattform-Stimme und sind absichtlich sprachblind (RCA-Wurzel R5: EINE
// Stimme im ganzen Call). Ihn mitzunehmen hiesse einen Sollzustand pinnen, den niemand
// beschlossen hat - und wuerde die R5-Regression in test/p9-voice-locale-source.test.js
// brechen.
//
// NICHT gegen Literale gemessen: die drei bindenden Kennungen stehen genau einmal, in
// elevenlabs-voice.js. Ein Test, der sie abschreibt, waere eine zweite Wahrheit ueber
// einen Owner-Beschluss (G5) und wuerde bei einer Aenderung doppelt rot.
//
// KEIN KATALOG-ID-PRAEFIX am Testnamen ("IP4" steht nicht im Muster
// package.json#config.i18nCatalogPattern): diese Faelle gehoeren in die Regressionsbank.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pinCall,
  sendeAnrufstartKoerper,
  PIN_PLATTFORM_STIMME,
} from "./helpers/elevenlabs-anrufstart-attrappe.mjs";
import { playTtsVoiceIdsFor, PROBE_PLATTFORM_STIMME } from "./helpers/play-tts-stimm-probe.mjs";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { consultAllowedForCall } from "../src/consult/gate.js";
import { elevenLabsVoiceIdFor } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";

// Ziel-Rufnummer je Sprache: sie setzt die OFFENLEGUNGS-Sprache (callee-Vorrang,
// call-locale.js), call.language die GESPRAECHS-Sprache - und die Stimme folgt dem
// GESPRAECH. Beide gleich gesetzt = der Regelfall "Anruf im eigenen Sprachraum": der
// Koerper bleibt in seiner Bestandsform (kein first_message-Zweig, perCallFirstMessage).
const ZIEL_JE_SPRACHE = Object.freeze({
  de: "+491737250000",
  fr: "+33612345678",
  en: "+447700900123",
});

// Fail-closed gegen eine vierte Sprache: sie wuerde hier sonst STILL nicht gemessen.
test("Anker-Reichweite: jede unterstuetzte Sprache hat ein Ziel in der Messkarte", () => {
  assert.deepEqual([...Object.keys(ZIEL_JE_SPRACHE)].sort(), [...SUPPORTED_LANGUAGES].sort());
});

for (const sprache of Object.keys(ZIEL_JE_SPRACHE)) {
  const { voiceProfile } = LOCALES[sprache];

  test(`Stimm-Anker ${sprache}: Outbound-Anrufstart und Play-TTS loesen ueber DENSELBEN Resolver auf`, async () => {
    // (0) Vorbedingung, die den Anker ueberhaupt tragfaehig macht: diese Sprache hat eine
    // EIGENE kuratierte Kennung. Faellt sie auf die Plattform-Stimme zurueck, haengt
    // "eine Stimme in beiden Richtungen" an einer Env - und die beiden Richtungen lesen
    // NICHT dieselbe Env (Outbound: TELNYX_ELEVENLABS_VOICE_ID, Play-TTS:
    // ELEVENLABS_VOICE_ID). Genau dann ist der Anker gebrochen, und das muss laut sein.
    const erwartetOutbound = elevenLabsVoiceIdFor(PIN_PLATTFORM_STIMME, voiceProfile);
    const erwartetPlayTts = elevenLabsVoiceIdFor(PROBE_PLATTFORM_STIMME, voiceProfile);
    assert.equal(
      erwartetOutbound,
      erwartetPlayTts,
      `${sprache} faellt auf die Plattform-Stimme zurueck - die beiden Richtungen lesen dort verschiedene Env-Werte`,
    );

    // (2) der ECHTE Anfragekoerper des Anrufstarts
    const koerper = await sendeAnrufstartKoerper({
      makeElevenLabsOutbound,
      consultAllowedForCall,
      call: { ...pinCall(), to: ZIEL_JE_SPRACHE[sprache], language: sprache },
    });
    const uebersteuerung = koerper.conversation_initiation_client_data.conversation_config_override;
    assert.equal(uebersteuerung.tts.voice_id, erwartetOutbound);

    // (3) die Vorabsynthese
    const [playTtsId] = await playTtsVoiceIdsFor([voiceProfile]);
    assert.equal(playTtsId, erwartetPlayTts);

    // der Anker selbst: beide Richtungen, EIN Wert
    assert.equal(
      uebersteuerung.tts.voice_id,
      playTtsId,
      `${sprache}: Inbound-Play-TTS und Outbound-Anrufstart muessen dieselbe Stimme sprechen`,
    );
  });
}
