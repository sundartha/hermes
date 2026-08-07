// Unit-Test fuer src/tts/directive-synth.js (Server-Slim P2, reine Verschiebung aus
// server.js). Isoliert mit Fake-ttsStore (faengt put-Aufrufe in einem Array) + Fake-config,
// kein Server/DB/Netz (P12). fetch wird per globalThis.fetch-Override mit try/finally
// gesteuert (offline, deterministisch), Fake-Response-Shape wie tts-synth.test.js.
// Deckt zusaetzlich zum Spawn-Byte-Gate (voice-play-tts.test.js) den Synth-FAIL-Fail-safe
// ab (der Fake-Origin dort liefert immer 200) sowie die Empty-Text-Direktive isoliert.
//
// LCT P7: makeDirectiveSynth verlangt seit P7 zusaetzlich store/onQuotaWarning (injizierte
// Zaehl-/Alarm-Abhaengigkeit). fakeStore() ist ein No-op-Spy (recordTtsCharacters liefert
// immer null) - diese Datei prueft NUR die <Play>-Verdrahtung, nicht die Zaehl-Semantik
// selbst (die deckt test/tts-quota-counter.test.js ab).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDirectiveSynth } from "../src/tts/directive-synth.js";
import { say, gather, hangup, VOICE_PROFILE } from "../src/telephony/directives.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

// Ein Provider-Wert ohne CAPABILITY.PLAY_AUDIO_TTS. 'twilio' als Wert, weil genau dieser
// String seit C-P4 kein Anbieter mehr ist, aber als Altzeile in einer Bestands-DB stehen
// kann (`provider TEXT` ohne CHECK-Constraint).
const UNSUPPORTED_PROVIDER = "twilio";

const PUBLIC_URL = "https://agent.test";
const FIXED_TOKEN = "fixed-token-abc";

function fakeTtsStore() {
  const putCalls = [];
  return {
    putCalls,
    put(bytes, contentType) {
      putCalls.push({ bytes, contentType });
      return FIXED_TOKEN;
    },
  };
}

// LCT P7: No-op-Spy fuer die injizierte Zaehl-Abhaengigkeit (s. Modul-Kommentar oben).
function fakeCounterStore() {
  return { recordTtsCharacters: () => null };
}
function noopQuotaWarning() {
  assert.fail("onQuotaWarning haette in dieser Datei nie aufgerufen werden duerfen");
}

function fakeConfig({ enabled }) {
  return withConfigNamespaces({
    publicUrl: PUBLIC_URL,
    elevenLabsPlayTts: {
      enabled,
      apiKey: "sk_test_should_never_leak",
      voiceId: "voice123",
      model: "eleven_flash_v2_5",
      apiBase: "https://api.elevenlabs.io",
      outputFormat: "mp3_44100_128",
      synthTimeoutMs: 2000,
    },
  });
}

function withFakeFetch(fetchImpl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function throwingFetch() {
  throw new Error("fetch haette nie aufgerufen werden duerfen (Kosten-/Scope-Gate)");
}

function okFetch() {
  return async () => ({
    ok: true,
    headers: { get: () => "audio/mpeg" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });
}

function failFetch() {
  return async () => ({ ok: false, status: 500, text: async () => "boom" });
}

// Faengt die aufgerufene URL ein (voiceId steckt darin, s. src/tts/synth.js TTS_PATH) -
// ohne diesen Fake bliebe die Play-TTS-Vorabsynthese fuer B2 unsichtbar getestet.
function recordingFetch() {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, headers: { get: () => "audio/mpeg" }, arrayBuffer: async () => new Uint8Array([1]).buffer };
  };
  return { urls, fetchImpl };
}

test("Flag AUS -> Direktiven referenz-identisch zurueck, kein put, kein fetch", async () => {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig({ enabled: false }),
    ttsStore,
    store: fakeCounterStore(),
    onQuotaWarning: noopQuotaWarning,
  });
  const directives = [say("Hallo")];
  const call = { provider: "telnyx" };
  await withFakeFetch(throwingFetch, async () => {
    const out = await synthesizeDirectiveAudio(call, directives);
    assert.equal(out, directives, "referenz-identisch");
  });
  assert.equal(ttsStore.putCalls.length, 0);
});

// C-P4: der Gegenstand ist "ein Anbieter OHNE die Play-TTS-Faehigkeit synthetisiert NICHT".
// Er ueberlebt den Twilio-Ausbau, weil directive-synth.js NUR providerSupports() fragt
// (reine Tabellen-Abfrage, fail-closed) und nie pick() - ein unbekannter Provider wirft
// hier also nicht, er faellt durch. Damit ist das hier die KOSTEN-Zusicherung fuer eine
// Altzeile provider='twilio' in einer Bestands-DB: kein Request an ElevenLabs, kein put.
test("Anbieter ohne Play-TTS-Faehigkeit (Flag AN) -> Direktiven unveraendert, kein put, kein fetch", async () => {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig({ enabled: true }),
    ttsStore,
    store: fakeCounterStore(),
    onQuotaWarning: noopQuotaWarning,
  });
  const directives = [say("Hallo")];
  const call = { provider: UNSUPPORTED_PROVIDER };
  await withFakeFetch(throwingFetch, async () => {
    const out = await synthesizeDirectiveAudio(call, directives);
    assert.equal(out, directives, "referenz-identisch");
  });
  assert.equal(ttsStore.putCalls.length, 0);
});

test("Telnyx + Flag AN + Synth-OK -> GATHER bekommt promptAudioUrl, SAY bekommt audioUrl, EIN put je sprechender Direktive", async () => {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig({ enabled: true }),
    ttsStore,
    store: fakeCounterStore(),
    onQuotaWarning: noopQuotaWarning,
  });
  const call = { provider: "telnyx" };
  const directives = [say("Guten Tag"), gather({ promptText: "Wie kann ich helfen?", action: "/voice/turn" })];
  const out = await withFakeFetch(okFetch(), () => synthesizeDirectiveAudio(call, directives));
  assert.equal(out[0].audioUrl, `${PUBLIC_URL}/voice/tts/${FIXED_TOKEN}`);
  assert.equal(out[1].promptAudioUrl, `${PUBLIC_URL}/voice/tts/${FIXED_TOKEN}`);
  assert.equal(ttsStore.putCalls.length, 2, "genau ein put je sprechender Direktive");
});

// B2 (Review GATES-P9): der Play-TTS-Pfad muss der P9-Sprachaufloesung folgen statt
// der einen globalen Plattform-Stimme - sonst umgeht die Vorabsynthese VOICE-12
// vollstaendig, sobald ELEVENLABS_PLAY_TTS_ENABLED=true laeuft (der <Say>-Zweig allein
// wird davon nie beruehrt).
test("Telnyx + Flag AN -> Voice-ID der Vorabsynthese folgt dem voiceProfile (FR/EN), nicht der globalen Plattform-Stimme", async () => {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig({ enabled: true }),
    ttsStore,
    store: fakeCounterStore(),
    onQuotaWarning: noopQuotaWarning,
  });
  const call = { provider: "telnyx" };
  const directives = [
    say("Bonjour", VOICE_PROFILE.FR_FEMALE_NEURAL),
    say("Hello", VOICE_PROFILE.EN_FEMALE_NEURAL),
    say("Hallo", VOICE_PROFILE.DE_FEMALE_NEURAL),
  ];
  const { urls, fetchImpl } = recordingFetch();
  await withFakeFetch(fetchImpl, () => synthesizeDirectiveAudio(call, directives));
  assert.equal(urls.length, 3);
  assert.match(urls[0], /text-to-speech\/FFXYdAYPzn8Tw8KiHZqg\b/, "FR folgt der bindenden FR-ID");
  assert.match(urls[1], /text-to-speech\/wOPou4MhRIYEqQHVxjmp\b/, "EN folgt der bindenden EN-ID");
  assert.match(urls[2], /text-to-speech\/voice123\b/, "DE bleibt die konfigurierte Plattform-Stimme");
});

test("Telnyx + Flag AN + Synth-FAIL -> Liste unveraendert (Fail-safe -> Azure-Say), kein put", async () => {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig({ enabled: true }),
    ttsStore,
    store: fakeCounterStore(),
    onQuotaWarning: noopQuotaWarning,
  });
  const call = { provider: "telnyx" };
  const directives = [say("Guten Tag")];
  const out = await withFakeFetch(failFetch(), () => synthesizeDirectiveAudio(call, directives));
  assert.deepEqual(out[0], directives[0], "Direktive bleibt unveraendert -> Azure-<Say>");
  assert.equal(ttsStore.putCalls.length, 0);
});

test("Telnyx + Flag AN + nicht-sprechende Direktive gemischt mit sprechender -> nur EIN Synth-Call", async () => {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig({ enabled: true }),
    ttsStore,
    store: fakeCounterStore(),
    onQuotaWarning: noopQuotaWarning,
  });
  const call = { provider: "telnyx" };
  const h = hangup();
  const directives = [h, say("Auf Wiedersehen")];
  const out = await withFakeFetch(okFetch(), () => synthesizeDirectiveAudio(call, directives));
  assert.equal(out[0], h, "hangup unveraendert");
  assert.equal(out[1].audioUrl, `${PUBLIC_URL}/voice/tts/${FIXED_TOKEN}`);
  assert.equal(ttsStore.putCalls.length, 1, "genau ein Synth-Call fuer die eine sprechende Direktive");
});
