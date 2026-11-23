import assert from "node:assert/strict";
import { test } from "node:test";

import { ladeVorlage } from "../../scripts/lib/elevenlabs-agent-lesen.mjs";
import { setzeAnPfad, vergleicheBesitz } from "../../scripts/lib/elevenlabs-besitz.mjs";

const EINE_STIMME_ID = "cqPdIo76zSHFDcSZpFov";
const SOLL_MODELL = "eleven_v4_turbo";
const SOLL_STABILITY = 0.65;
const SOLL_SIMILARITY = 0.75;
const VORLAGE = ladeVorlage();
const TTS = VORLAGE.agent.conversation_config.tts;

test("Agent-Vorlage: tts.voice_id ist die eine Stimme", () => {
  assert.equal(TTS.voice_id, EINE_STIMME_ID);
});

test("Agent-Vorlage (die der Vorspann liest): Modell, stability und similarity_boost stehen auf dem Sollwert, ohne speed", () => {
  assert.equal(TTS.model_id, SOLL_MODELL);
  assert.equal(TTS.stability, SOLL_STABILITY);
  assert.equal(TTS.similarity_boost, SOLL_SIMILARITY);
  assert.equal(TTS.speed, undefined);
});

function abweichungen(tts) {
  const live = {};
  setzeAnPfad(live, "conversation_config.tts", { ...TTS, ...tts });
  return vergleicheBesitz({ vorlage: VORLAGE, live });
}

const DRIFT_FAELLE = [
  ["voice_id", "tts_voice_id", { voice_id: "andere-stimme" }],
  ["model_id", "tts_model_id", { model_id: "eleven_flash_v2_5" }],
  ["stability", "tts_stability", { stability: 0.3 }],
  ["similarity_boost", "tts_similarity_boost", { similarity_boost: 0.1 }],
];

for (const [name, feld, abweichung] of DRIFT_FAELLE) {
  test(`Drift-Check: Live-Abweichung bei tts.${name} wird als ${feld} gemeldet`, () => {
    const ergebnis = JSON.stringify(abweichungen(abweichung));
    assert.ok(ergebnis.includes(`conversation_config.tts.${name}`) || ergebnis.includes(feld), ergebnis);
  });
}

test("Drift-Check: Live gleich Sollwert meldet keine tts-Abweichung", () => {
  const ergebnis = JSON.stringify(abweichungen({}));
  assert.equal(/tts\.(voice_id|model_id|stability|similarity_boost)/.test(ergebnis), false, ergebnis);
});
