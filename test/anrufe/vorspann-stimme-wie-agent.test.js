import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { makeDirectiveSynth } from "../../src/tts/directive-synth.js";
import { stimmeAusVorlage } from "../../src/conversation/elevenlabs-agent-config.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { recordingStreamFetch } from "../helpers/fake-tts-stream.mjs";

const VORLAGE = JSON.parse(fs.readFileSync("elevenlabs/agent_configs/outbound-agent.template.json", "utf8"));
const TTS = VORLAGE.agent.conversation_config.tts;

async function vorspannKoerper() {
  const aufzeichnung = recordingStreamFetch();
  const original = globalThis.fetch;
  globalThis.fetch = aufzeichnung.fetchImpl;
  try {
    const { synthesizeVorspann } = makeDirectiveSynth({
      config: withConfigNamespaces({
        elevenLabsPlayTts: {
          apiKey: "k",
          voiceId: "plattform",
          model: "eleven_flash_v2_5",
          apiBase: "https://el.test",
          outputFormat: "mp3_44100_128",
          synthTimeoutMs: 2000,
          synthTotalTimeoutMs: 10000,
        },
      }),
      ttsStore: {},
      store: { platformTtsUsageView: () => ({ characters: 0, quota: 1_000_000 }), recordTtsCharacters: () => null },
      onQuotaWarning: () => {},
    });
    const result = await synthesizeVorspann("Hallo", "stimme-des-anrufs");
    assert.equal(result.ok, true);
    return { url: aufzeichnung.urls[0], body: JSON.parse(aufzeichnung.calls[0][1].body) };
  } finally {
    globalThis.fetch = original;
  }
}

test("Vorspann: Modell, stability und similarity_boost stammen aus dem tts-Abschnitt der Vorlage", async () => {
  const { body } = await vorspannKoerper();
  assert.equal(body.model_id, TTS.model_id);
  assert.equal(body.model_id, "eleven_v4_turbo");
  assert.equal(body.voice_settings.stability, 0.65);
  assert.equal(body.voice_settings.similarity_boost, 0.75);
});

test("Vorspann: die Vorlage setzt kein speed, also steht speed nicht im Koerper", async () => {
  const { body } = await vorspannKoerper();
  assert.equal(TTS.speed, undefined);
  assert.deepEqual(Object.keys(body.voice_settings).sort(), ["similarity_boost", "stability"]);
});

test("Vorspann: die Stimme bleibt die wirksame Stimme des Anrufs, nicht die der Vorlage", async () => {
  const { url } = await vorspannKoerper();
  assert.match(url, /\/v1\/text-to-speech\/stimme-des-anrufs\/stream/);
  assert.doesNotMatch(url, new RegExp(TTS.voice_id));
});

const STIMME_FAELLE = [
  [
    "speed gesetzt",
    { model_id: "m1", stability: 0.5, similarity_boost: 0.6, speed: 1.1 },
    { model: "m1", voiceSettings: { stability: 0.5, similarity_boost: 0.6, speed: 1.1 } },
  ],
  [
    "speed fehlt",
    { model_id: "m1", stability: 0.5, similarity_boost: 0.6 },
    { model: "m1", voiceSettings: { stability: 0.5, similarity_boost: 0.6 } },
  ],
  ["stability fehlt", { model_id: "m1", similarity_boost: 0.6 }, { model: "m1", voiceSettings: undefined }],
  ["similarity_boost fehlt", { model_id: "m1", stability: 0.5 }, { model: "m1", voiceSettings: undefined }],
  ["kein tts-Abschnitt", undefined, { model: undefined, voiceSettings: undefined }],
];

for (const [name, tts, erwartet] of STIMME_FAELLE) {
  test(`Vorlagen-Stimme: ${name}`, () => {
    assert.deepEqual(stimmeAusVorlage(tts), erwartet);
  });
}
