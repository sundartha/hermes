import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { makeDirectiveSynth } from "../src/tts/directive-synth.js";
import { say, gather, hangup, VOICE_PROFILE } from "../src/telephony/directives.js";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../src/turn-budget.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { playTtsVoiceIdsFor, PROBE_PLATTFORM_STIMME } from "./helpers/play-tts-stimm-probe.mjs";
import { deferred, recordingStreamFetch } from "./helpers/fake-tts-stream.mjs";

const UNSUPPORTED_PROVIDER = "twilio";

const PUBLIC_URL = "https://agent.test";
const FIXED_TOKEN = "fixed-token-abc";
const EXPECTED_PUT_CALLS_FOR_GATHER_AND_SAY = 2;

function fakeTtsStore() {
  const putCalls = [];
  return {
    putCalls,
    put(audio) {
      putCalls.push(audio);
      return FIXED_TOKEN;
    },
  };
}

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
      synthTotalTimeoutMs: 10000,
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
  return recordingStreamFetch().fetchImpl;
}

function failFetch() {
  return async () => ({ ok: false, status: 500, text: async () => "boom" });
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
  assert.equal(
    ttsStore.putCalls.length,
    EXPECTED_PUT_CALLS_FOR_GATHER_AND_SAY,
    "genau ein put je sprechender Direktive",
  );
});

test("Telnyx + Flag AN -> Voice-ID der Vorabsynthese folgt dem voiceProfile (DE/FR/EN), nicht der globalen Plattform-Stimme", async () => {
  const [fr, en, de] = await playTtsVoiceIdsFor([
    VOICE_PROFILE.FR_FEMALE_NEURAL,
    VOICE_PROFILE.EN_FEMALE_NEURAL,
    VOICE_PROFILE.DE_FEMALE_NEURAL,
  ]);
  assert.equal(fr, "WeAAwKYcS06VmXw086yZ", "FR folgt der bindenden FR-ID");
  assert.equal(en, "ZSNL4hPqCnqoMPaI4jGX", "EN folgt der bindenden EN-ID");
  assert.equal(de, "cqPdIo76zSHFDcSZpFov", "DE folgt der bindenden DE-ID");
  assert.ok(
    ![fr, en, de].includes(PROBE_PLATTFORM_STIMME),
    "keine Sprache faellt mehr auf die globale Plattform-Stimme zurueck (Anruf-7-Defekt)",
  );
});

test("VOICE-12 (gruen) - TTS-Stimme loest pro Sprache auf statt einer globalen ID (Messpunkt: Play-TTS-Vorabsynthese)", async () => {
  const profiles = [
    VOICE_PROFILE.DE_FEMALE_NEURAL,
    VOICE_PROFILE.FR_FEMALE_NEURAL,
    VOICE_PROFILE.EN_FEMALE_NEURAL,
  ];
  const ids = await playTtsVoiceIdsFor(profiles);
  assert.equal(
    new Set(ids).size,
    profiles.length,
    `DE/FR/EN muessen drei verschiedene Voice-IDs liefern, gefunden: ${ids.join(", ")}`,
  );
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
  const hangupDirective = hangup();
  const directives = [hangupDirective, say("Auf Wiedersehen")];
  const out = await withFakeFetch(okFetch(), () => synthesizeDirectiveAudio(call, directives));
  assert.equal(out[0], hangupDirective, "hangup unveraendert");
  assert.equal(out[1].audioUrl, `${PUBLIC_URL}/voice/tts/${FIXED_TOKEN}`);
  assert.equal(ttsStore.putCalls.length, 1, "genau ein Synth-Call fuer die eine sprechende Direktive");
});

async function synthMitStrom(directives, { eingangMs, beendeStrom, vorher = true }) {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig({ enabled: true }),
    ttsStore,
    store: fakeCounterStore(),
    onQuotaWarning: noopQuotaWarning,
  });
  const restGate = deferred();
  const { fetchImpl } = recordingStreamFetch({ restGate: restGate.promise });
  if (vorher) beendeStrom(restGate);
  const out = await withFakeFetch(fetchImpl, () => synthesizeDirectiveAudio({ provider: "telnyx" }, directives, eingangMs));
  if (!vorher) beendeStrom(restGate);
  return { out, ttsStore };
}

const reisstAb = (restGate) => restGate.reject(new Error("stream broke"));
const endetNormal = (restGate) => restGate.resolve();

test("Dokument endet mit Hangup, Strom reisst ab -> kein Play, der Azure-Say bleibt (Fehlersatz, Verabschiedung)", async () => {
  const directives = [say("Auf Wiedersehen"), hangup()];
  const { out, ttsStore } = await synthMitStrom(directives, { beendeStrom: reisstAb });
  assert.equal(out[0], directives[0]);
  assert.equal(ttsStore.putCalls.length, 0);
});

test("Dokument endet mit Hangup, Strom reisst ab -> Warnzeile nennt den Grund und den Azure-Fallback", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    await synthMitStrom([say("Auf Wiedersehen"), hangup()], { beendeStrom: reisstAb });
    const zeilen = warn.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
    assert.ok(zeilen.some((zeile) => /Satz vor dem Auflegen unvollstaendig oder zu spaet -> Azure-Fallback/.test(zeile)), zeilen.join("\n"));
  } finally {
    warn.mock.restore();
  }
});

test("Dokument ohne Hangup, Strom reisst ab -> Play streamt weiter (Gespraechsrunde)", async () => {
  const { out, ttsStore } = await synthMitStrom([say("Guten Tag")], { beendeStrom: reisstAb });
  assert.equal(out[0].audioUrl, `${PUBLIC_URL}/voice/tts/${FIXED_TOKEN}`);
  assert.equal(ttsStore.putCalls.length, 1);
});

test("Dokument endet mit Hangup, Strom noch offen, Webhook-Eingang liegt schon lange zurueck -> kein Play, der Say bleibt", async () => {
  const eingangMs = Date.now() - PROVIDER_WEBHOOK_HARDCUT_MS;
  const directives = [say("Auf Wiedersehen"), hangup()];
  const { out, ttsStore } = await synthMitStrom(directives, { eingangMs, beendeStrom: endetNormal, vorher: false });
  assert.equal(out[0], directives[0]);
  assert.equal(ttsStore.putCalls.length, 0);
});
