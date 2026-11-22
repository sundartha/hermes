import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pinCall,
  sendeAnrufstartKoerper,
} from "../helpers/elevenlabs-anrufstart-attrappe.mjs";
import { playTtsVoiceIdsFor } from "../helpers/play-tts-stimm-probe.mjs";
import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import { consultAllowedForCall } from "../../src/consult/gate.ts";
import { LOCALES, SUPPORTED_LANGUAGES } from "../../src/i18n/locales.ts";

const ZIEL_JE_SPRACHE = Object.freeze({
  de: "+491737250000",
  fr: "+33612345678",
  en: "+447700900123",
});

test("Anker-Reichweite: jede unterstuetzte Sprache hat ein Ziel in der Messkarte", () => {
  assert.deepEqual([...Object.keys(ZIEL_JE_SPRACHE)].sort(), [...SUPPORTED_LANGUAGES].sort());
});

for (const sprache of Object.keys(ZIEL_JE_SPRACHE)) {
  const { voiceProfile } = LOCALES[sprache];

  test(`Stimm-Anker ${sprache}: Outbound-Anrufstart und Play-TTS sprechen dieselbe eine Stimme`, async () => {
    const erwartetOutbound = "cqPdIo76zSHFDcSZpFov";
    const erwartetPlayTts = erwartetOutbound;

    const koerper = await sendeAnrufstartKoerper({
      makeElevenLabsOutbound,
      consultAllowedForCall,
      call: { ...pinCall(), to: ZIEL_JE_SPRACHE[sprache], language: sprache },
    });
    const uebersteuerung = koerper.conversation_initiation_client_data.conversation_config_override;
    assert.equal(uebersteuerung.tts.voice_id, erwartetOutbound);

    const [playTtsId] = await playTtsVoiceIdsFor([voiceProfile]);
    assert.equal(playTtsId, erwartetPlayTts);

    if (sprache === "de") assert.equal(uebersteuerung.tts.voice_id, playTtsId);
  });
}
