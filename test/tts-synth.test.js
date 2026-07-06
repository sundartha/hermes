// Unit-Tests fuer src/tts/synth.js (Play-TTS, reine IO-injizierte Funktion, DIP wie
// src/llm.js). Fake-fetchImpl statt echtem Netz (P12 F.I.R.S.T.) - offline, deterministisch.
// Pinnt: Erfolg liefert Bytes+ContentType; HTTP-Fehler -> {ok:false, reason:"http_<code>"};
// Abbruch/Timeout -> {ok:false, reason:"timeout"}; der API-Key taucht NIE in der
// Rueckgabe auf (Regel 4/Secrets). synthesizeSpeech wirft NIE (fail-safe).
import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesizeSpeech } from "../src/tts/synth.js";

const SECRET_KEY = "sk_test_secret_should_never_leak";

function baseOpts(overrides = {}) {
  return {
    apiKey: SECRET_KEY,
    voiceId: "voice123",
    model: "eleven_flash_v2_5",
    apiBase: "https://api.elevenlabs.io",
    outputFormat: "mp3_44100_128",
    timeoutMs: 2000,
    ...overrides,
  };
}

test("Erfolg -> {ok:true, bytes, contentType}; Body traegt model_id, URL traegt output_format", async () => {
  let seenUrl, seenBody, seenHeaders;
  const fetchImpl = async (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(init.body);
    seenHeaders = init.headers;
    return {
      ok: true,
      headers: { get: () => "audio/mpeg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
  const result = await synthesizeSpeech("Hallo Welt", { ...baseOpts(), fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.bytes), [1, 2, 3]);
  assert.equal(result.contentType, "audio/mpeg");
  assert.match(seenUrl, /output_format=mp3_44100_128/, "output_format ist ein Query-Parameter");
  assert.equal(seenBody.model_id, "eleven_flash_v2_5");
  assert.equal(seenBody.text, "Hallo Welt");
  assert.equal(seenHeaders["xi-api-key"], SECRET_KEY, "Key geht NUR als Header raus");
});

test("HTTP-Fehler (4xx/5xx) -> {ok:false, reason:'http_<status>', detail}, kein Wurf", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom detail" });
  const result = await synthesizeSpeech("x", { ...baseOpts(), fetchImpl });
  assert.deepEqual(result, { ok: false, reason: "http_500", detail: "boom detail" });
});

test("HTTP-Fehler ohne res.text (defensiv) -> detail:'' , kein Wurf", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400 });
  const result = await synthesizeSpeech("x", { ...baseOpts(), fetchImpl });
  assert.deepEqual(result, { ok: false, reason: "http_400", detail: "" });
});

test("Abbruch/Timeout -> {ok:false, reason:'timeout'}, kein Wurf, kein haengender Call", async () => {
  const fetchImpl = (url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  const result = await synthesizeSpeech("x", { ...baseOpts({ timeoutMs: 10 }), fetchImpl });
  assert.deepEqual(result, { ok: false, reason: "timeout" });
});

test("Sonstiger Fehler (z.B. Netzwerk) -> {ok:false, reason:'error'}, kein Wurf", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await synthesizeSpeech("x", { ...baseOpts(), fetchImpl });
  assert.deepEqual(result, { ok: false, reason: "error" });
});

test("Kein API-Key in Rueckgabe/Fehler (Regel 4/Secrets)", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 });
  const result = await synthesizeSpeech("x", { ...baseOpts(), fetchImpl });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(SECRET_KEY), false, "Key darf nie in der Rueckgabe stehen");
  assert.equal(Object.keys(result).includes("apiKey"), false);
});
