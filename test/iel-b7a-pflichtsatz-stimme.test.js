import test from "node:test";
import assert from "node:assert/strict";
import { makeDirectiveSynth } from "../src/tts/directive-synth.js";
import { createTtsStore } from "../src/tts/store.js";
import { say, gather, sayWithVoiceId, DIRECTIVE, VOICE_PROFILE } from "../src/telephony/directives.js";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { elevenLabsVoiceIdFor } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";
import { runPlayTtsProbe, playTtsSynthConfig, PROBE_PLATTFORM_STIMME } from "./helpers/play-tts-stimm-probe.mjs";

const AGENT_STIMME = "v_agent";
const AGENT_STIMME_B = "v_agent_b";
const AGENT_SATZ = "Pflichtsatz-Testtext";
const TURN_ACTION = "https://agent.test/voice/turn?callId=c1";
const TTS_TOKEN_TTL_MS = 60000;
const QUOTA = 10;
const CYCLE_KEY = "2026-09";
const DREI_VERSCHIEDENE_STIMMEN = 3;

test("IEL-B7a-1: gesetzte voiceId an say gewinnt gegen die Profil-Stimme", async () => {
  const { out, voiceIds } = await runPlayTtsProbe([
    sayWithVoiceId({ text: AGENT_SATZ, voiceProfile: VOICE_PROFILE.DE_FEMALE_NEURAL, voiceId: AGENT_STIMME }),
  ]);
  assert.deepEqual(voiceIds, [AGENT_STIMME]);
  assert.notEqual(
    elevenLabsVoiceIdFor(PROBE_PLATTFORM_STIMME, VOICE_PROFILE.DE_FEMALE_NEURAL),
    AGENT_STIMME,
    "Positiv-Kontrolle: das Profil hat eine eigene Stimme, verschieden von der Agent-Stimme",
  );
  assert.ok(out[0].audioUrl);
});

test("IEL-B7a-2: gesetzte voiceId an gather gewinnt gegen die Profil-Stimme", async () => {
  const { out, voiceIds } = await runPlayTtsProbe([
    gather({
      promptText: AGENT_SATZ,
      action: TURN_ACTION,
      voiceProfile: VOICE_PROFILE.FR_FEMALE_NEURAL,
      voiceId: AGENT_STIMME,
    }),
  ]);
  assert.deepEqual(voiceIds, [AGENT_STIMME]);
  assert.ok(out[0].promptAudioUrl);
});

test("IEL-B7a-3: ohne Feld -> heutige Aufloesung (Profil-Stimme)", async () => {
  const profiles = [VOICE_PROFILE.DE_FEMALE_NEURAL, VOICE_PROFILE.FR_FEMALE_NEURAL, VOICE_PROFILE.EN_FEMALE_NEURAL];
  const { voiceIds } = await runPlayTtsProbe(profiles.map((profile) => say(AGENT_SATZ, profile)));
  assert.deepEqual(
    voiceIds,
    profiles.map((profile) => elevenLabsVoiceIdFor(PROBE_PLATTFORM_STIMME, profile)),
  );
});

test("IEL-B7a-4: ohne Feld und ohne Profil-Stimme -> cfg.voiceId", async () => {
  const { voiceIds } = await runPlayTtsProbe([{ kind: DIRECTIVE.SAY, text: AGENT_SATZ }]);
  assert.deepEqual(voiceIds, [PROBE_PLATTFORM_STIMME]);
});

test('IEL-B7a-5: voiceId "" am Builder -> kein Feld, Direktive formgleich zum Bestand', () => {
  const withEmptySay = sayWithVoiceId({ text: AGENT_SATZ, voiceProfile: VOICE_PROFILE.DE_FEMALE_NEURAL, voiceId: "" });
  assert.deepStrictEqual(withEmptySay, say(AGENT_SATZ, VOICE_PROFILE.DE_FEMALE_NEURAL));
  assert.equal(Object.hasOwn(withEmptySay, "voiceId"), false);

  const withEmptyGather = gather({ promptText: AGENT_SATZ, action: TURN_ACTION, voiceId: "" });
  assert.deepStrictEqual(withEmptyGather, gather({ promptText: AGENT_SATZ, action: TURN_ACTION }));
  assert.equal(Object.hasOwn(withEmptyGather, "voiceId"), false);
});

test('IEL-B7a-6: voiceId "" an der Direktive -> heutige Aufloesung in der Synthese', async () => {
  const directive = { ...say(AGENT_SATZ, VOICE_PROFILE.DE_FEMALE_NEURAL), voiceId: "" };
  const { voiceIds } = await runPlayTtsProbe([directive]);
  assert.deepEqual(voiceIds, [elevenLabsVoiceIdFor(PROBE_PLATTFORM_STIMME, VOICE_PROFILE.DE_FEMALE_NEURAL)]);
});

test("IEL-B7a-7: Kontingent erschoepft -> kein Anbieter-Aufruf, Azure-<Say> wie heute", async () => {
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: playTtsSynthConfig(),
    ttsStore: { put: () => assert.fail("kein Provider-Aufruf erwartet") },
    store: {
      platformTtsUsageView: () => ({ characters: QUOTA, quota: QUOTA, cycleKey: CYCLE_KEY }),
      recordTtsCharacters: () => assert.fail("kein Provider-Aufruf erwartet"),
    },
    onQuotaWarning: () => assert.fail("onQuotaWarning gehoert nicht zu dieser Messung"),
  });
  const directive = sayWithVoiceId({ text: AGENT_SATZ, voiceProfile: VOICE_PROFILE.DE_FEMALE_NEURAL, voiceId: AGENT_STIMME });
  const out = await synthesizeDirectiveAudio({ provider: "telnyx" }, [directive]);
  assert.equal(out.length, 1);
  assert.equal(out[0], directive, "referenz-identisch zur Eingabe - unveraendert durchgereicht");
  assert.equal(
    renderDirectives(out),
    renderDirectives([say(AGENT_SATZ, VOICE_PROFILE.DE_FEMALE_NEURAL)]),
    "TeXML byte-identisch: Azure-<Say>",
  );
});

test("IEL-B7a-8: gleicher Text, verschiedene Stimmen -> zwei Synthesen, zwei Audio-URLs", async () => {
  const ttsStore = createTtsStore({ ttlMs: TTS_TOKEN_TTL_MS });
  const { out, voiceIds } = await runPlayTtsProbe(
    [
      sayWithVoiceId({ text: AGENT_SATZ, voiceId: AGENT_STIMME }),
      sayWithVoiceId({ text: AGENT_SATZ, voiceId: AGENT_STIMME_B }),
      say(AGENT_SATZ),
    ],
    { ttsStore },
  );
  assert.deepEqual(voiceIds, [
    AGENT_STIMME,
    AGENT_STIMME_B,
    elevenLabsVoiceIdFor(PROBE_PLATTFORM_STIMME, VOICE_PROFILE.DE_FEMALE_NEURAL),
  ]);
  assert.equal(new Set(out.map((directive) => directive.audioUrl)).size, DREI_VERSCHIEDENE_STIMMEN);
});

test("IEL-B7a-9: Direktive mit voiceId rendert ohne Play-Audio byte-identisch zum Bestand", () => {
  const mitVoiceId = renderDirectives([
    sayWithVoiceId({ text: AGENT_SATZ, voiceProfile: VOICE_PROFILE.FR_FEMALE_NEURAL, voiceId: AGENT_STIMME }),
    gather({
      promptText: AGENT_SATZ,
      action: TURN_ACTION,
      voiceProfile: VOICE_PROFILE.FR_FEMALE_NEURAL,
      voiceId: AGENT_STIMME,
    }),
  ]);
  const bestand = renderDirectives([
    say(AGENT_SATZ, VOICE_PROFILE.FR_FEMALE_NEURAL),
    gather({ promptText: AGENT_SATZ, action: TURN_ACTION, voiceProfile: VOICE_PROFILE.FR_FEMALE_NEURAL }),
  ]);
  assert.equal(mitVoiceId, bestand);
});
