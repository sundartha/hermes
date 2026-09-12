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
//
// IP3: seit dem entfernten ElevenLabs-Relay-Zweig am TeXML-<Say> hostet diese Datei den
// Katalog-Messpunkt VOICE-12 (Bank test:gates), weil die Play-TTS-Vorabsynthese der
// einzige verbleibende sprachaufgeloeste Sprechpfad ist.
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
// Beliebiger Fake-Audio-Inhalt fuer okFetch() - der Bytewert selbst ist ohne Bedeutung,
// nur seine blosse Existenz zaehlt (arrayBuffer() muss etwas liefern).
const FAKE_AUDIO_BYTES = [1];
// Erwartete put()-Aufrufe im gemischten Gather+Say-Fall: EINE sprechende Direktive je
// Aufruf (Gather-Prompt + Say), s. Testname.
const EXPECTED_PUT_CALLS_FOR_GATHER_AND_SAY = 2;

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
    arrayBuffer: async () => new Uint8Array(FAKE_AUDIO_BYTES).buffer,
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
  assert.equal(
    ttsStore.putCalls.length,
    EXPECTED_PUT_CALLS_FOR_GATHER_AND_SAY,
    "genau ein put je sprechender Direktive",
  );
});

// EIN Messwerkzeug fuer die beiden Stimm-Tests unten (G5): schickt je Profil eine
// sprechende Direktive durch die Vorabsynthese und liefert die Voice-ID, mit der
// ElevenLabs gerufen wurde - sie steckt im Pfad der Synthese-URL (src/tts/synth.js,
// TTS_PATH). Am beobachtbaren Ergebnis gemessen, nicht an einer Funktionssignatur.
async function synthesizedVoiceIdsFor(profiles) {
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig({ enabled: true }),
    ttsStore: fakeTtsStore(),
    store: fakeCounterStore(),
    onQuotaWarning: noopQuotaWarning,
  });
  const { urls, fetchImpl } = recordingFetch();
  await withFakeFetch(fetchImpl, () =>
    synthesizeDirectiveAudio({ provider: "telnyx" }, profiles.map((profile) => say("Text", profile))),
  );
  assert.equal(urls.length, profiles.length, "je Profil genau ein Synth-Aufruf");
  return urls.map((url) => url.match(/text-to-speech\/([^/?]+)/)[1]);
}

// B2 (Review GATES-P9): der Play-TTS-Pfad muss der P9-Sprachaufloesung folgen statt
// der einen globalen Plattform-Stimme - sonst umgeht die Vorabsynthese VOICE-12
// vollstaendig, sobald ELEVENLABS_PLAY_TTS_ENABLED=true laeuft (der <Say>-Zweig allein
// wird davon nie beruehrt).
test("Telnyx + Flag AN -> Voice-ID der Vorabsynthese folgt dem voiceProfile (DE/FR/EN), nicht der globalen Plattform-Stimme", async () => {
  const [fr, en, de] = await synthesizedVoiceIdsFor([
    VOICE_PROFILE.FR_FEMALE_NEURAL,
    VOICE_PROFILE.EN_FEMALE_NEURAL,
    VOICE_PROFILE.DE_FEMALE_NEURAL,
  ]);
  assert.equal(fr, "WeAAwKYcS06VmXw086yZ", "FR folgt der bindenden FR-ID");
  assert.equal(en, "ZSNL4hPqCnqoMPaI4jGX", "EN folgt der bindenden EN-ID");
  assert.equal(de, "cqPdIo76zSHFDcSZpFov", "DE folgt der bindenden DE-ID");
  assert.ok(
    ![fr, en, de].includes("voice123"),
    "keine Sprache faellt mehr auf die globale Plattform-Stimme zurueck (Anruf-7-Defekt)",
  );
});

// VOICE-12 - Leittest des Katalog-Clusters D20. MESSPUNKT UMGEZOGEN (IP3): bis IP3 stand
// er am gerenderten TeXML-<Say> (test/telnyx-elevenlabs-render.test.js) - genau an dem
// ElevenLabs-Relay-Zweig, den IP3 als A/B-belegt defekt entfernt hat. Er ist nicht
// geloescht, sondern auf den ueberlebenden sprachaufgeloesten Sprechpfad umgehaengt: die
// Play-TTS-Vorabsynthese. Kennung bleibt am Namensanfang, damit er in derselben Bank
// laeuft wie vorher (npm run test:gates). Sollzustand aus Owner-Entscheidung 7.5
// (PLAN-I18N-TESTS.md): die TTS-Stimme loest regional auf statt EINER globalen ID. Bewusst
// am beobachtbaren Ergebnis formuliert, nicht am Weg - der Fix darf die Stimme aus der
// Karte, dem Buendel oder dem Tenant ziehen. Das (b)-Etikett "(SOLL, rot)" faellt weg: der
// Fall ist seit 2026-08-18 gruen (drei kuratierte IDs), ein "rot" im Namen waere falsch.
test("VOICE-12 (gruen) - TTS-Stimme loest pro Sprache auf statt einer globalen ID (Messpunkt: Play-TTS-Vorabsynthese)", async () => {
  const profiles = [
    VOICE_PROFILE.DE_FEMALE_NEURAL,
    VOICE_PROFILE.FR_FEMALE_NEURAL,
    VOICE_PROFILE.EN_FEMALE_NEURAL,
  ];
  const ids = await synthesizedVoiceIdsFor(profiles);
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
