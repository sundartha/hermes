import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { makeDirectiveSynth } from "../../src/tts/directive-synth.js";
import { say, hangup } from "../../src/telephony/directives.ts";
import { PROVIDER_WEBHOOK_HARDCUT_MS } from "../../src/turn-budget.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { recordingStreamFetch } from "../helpers/fake-tts-stream.mjs";

const PUBLIC_URL = "https://agent.test";

function synthMitPut(put) {
  return makeDirectiveSynth({
    config: withConfigNamespaces({
      publicUrl: PUBLIC_URL,
      elevenLabsPlayTts: {
        enabled: true,
        apiKey: "k",
        voiceId: "voice123",
        model: "eleven_flash_v2_5",
        apiBase: "https://api.elevenlabs.io",
        outputFormat: "mp3_44100_128",
        synthTimeoutMs: 2000,
        synthTotalTimeoutMs: 10000,
      },
    }),
    ttsStore: { put },
    store: { recordTtsCharacters: () => null },
    onQuotaWarning: () => assert.fail("keine Warnung erwartet"),
  }).synthesizeDirectiveAudio;
}

async function lauf(put, direktiven, eingangMs) {
  const original = globalThis.fetch;
  globalThis.fetch = recordingStreamFetch().fetchImpl;
  const stumm = [mock.method(console, "warn", () => {}), mock.method(console, "log", () => {})];
  try {
    return await synthMitPut(put)({ provider: "telnyx" }, direktiven, eingangMs);
  } finally {
    globalThis.fetch = original;
    stumm.forEach((m) => m.mock.restore());
  }
}

const NIE_FERTIG = () => new Promise(() => {});
const SPAET = Date.now() - PROVIDER_WEBHOOK_HARDCUT_MS;

test("Ablage haengt, Turn-Frist abgelaufen -> Say bleibt ohne Abruf-URL (Azure-Stimme)", async () => {
  const direktiven = [say("Guten Tag")];
  const out = await lauf(NIE_FERTIG, direktiven, SPAET);
  assert.equal(out[0], direktiven[0]);
  assert.equal(out[0].audioUrl, undefined);
});

test("Ablage haengt bei Dokument mit Hangup, Turn-Frist abgelaufen -> Say bleibt ohne Abruf-URL", async () => {
  const direktiven = [say("Auf Wiedersehen"), hangup()];
  const out = await lauf(NIE_FERTIG, direktiven, SPAET);
  assert.equal(out[0], direktiven[0]);
});

test("Ablage haengt, mehrere Direktiven -> alle fallen zurueck, keine wartet einzeln", async () => {
  const direktiven = [say("Eins"), say("Zwei")];
  const out = await lauf(NIE_FERTIG, direktiven, SPAET);
  assert.deepEqual(out, direktiven);
});

test("Ablage fertig innerhalb der Turn-Frist -> Abruf-URL mit Token", async () => {
  const out = await lauf(async () => "tok", [say("Guten Tag")], Date.now());
  assert.equal(out[0].audioUrl, `${PUBLIC_URL}/voice/tts/tok`);
});

test("Ablage fertig, Dokument mit Hangup, innerhalb der Turn-Frist -> Abruf-URL mit Token", async () => {
  const out = await lauf(() => "sync", [say("Tschuess"), hangup()], Date.now());
  assert.equal(out[0].audioUrl, `${PUBLIC_URL}/voice/tts/sync`);
});
