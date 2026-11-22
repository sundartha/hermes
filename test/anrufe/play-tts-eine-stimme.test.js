import assert from "node:assert/strict";
import { test } from "node:test";

import { sayWithVoiceId, VOICE_PROFILE } from "../../src/telephony/directives.ts";
import { runPlayTtsProbe, playTtsVoiceIdsFor } from "../helpers/play-tts-stimm-probe.mjs";

const EINE_STIMME = "cqPdIo76zSHFDcSZpFov";

test("Play-TTS-Vorabsynthese: FR, EN und DE sprechen dieselbe eine Stimme", async () => {
  const ids = await playTtsVoiceIdsFor([
    VOICE_PROFILE.FR_FEMALE_NEURAL,
    VOICE_PROFILE.EN_FEMALE_NEURAL,
    VOICE_PROFILE.DE_FEMALE_NEURAL,
  ]);
  assert.deepEqual(ids, [EINE_STIMME, EINE_STIMME, EINE_STIMME]);
});

test("Play-TTS-Vorabsynthese: eine ausdruecklich gesetzte voiceId bleibt erhalten", async () => {
  const { voiceIds } = await runPlayTtsProbe([sayWithVoiceId({ text: "Text", voiceId: "eigene-stimme-1" })]);
  assert.deepEqual(voiceIds, ["eigene-stimme-1"]);
});
