import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesizeSpeechStream } from "../../src/tts/synth.ts";
import {
  FAKE_FIRST_CHUNK,
  FAKE_REST_CHUNK,
  deferred,
  fakeTtsStreamResponse,
} from ".././helpers/fake-tts-stream.mjs";

const SECRET_KEY = "sk_test_secret_should_never_leak";
const SHORT_FIRST_CHUNK_TIMEOUT_MS = 10;

function baseOpts(overrides = {}) {
  return {
    apiKey: SECRET_KEY,
    voiceId: "voice123",
    model: "eleven_flash_v2_5",
    apiBase: "https://api.elevenlabs.io",
    outputFormat: "mp3_44100_128",
    firstChunkTimeoutMs: 2000,
    totalTimeoutMs: 10000,
    ...overrides,
  };
}

test("Erfolg -> {ok:true, contentType, audio}; URL traegt /stream + output_format, Body traegt model_id", async () => {
  let seenUrl, seenBody, seenHeaders;
  const fetchImpl = async (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(init.body);
    seenHeaders = init.headers;
    return fakeTtsStreamResponse();
  };
  const result = await synthesizeSpeechStream("Hallo Welt", { ...baseOpts(), fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.wert.contentType, "audio/mpeg");
  assert.equal(typeof result.wert.firstChunkMs, "number");
  const audio = await result.wert.audio;
  assert.equal(audio.complete, true);
  assert.deepEqual(
    Array.from(audio.bytes),
    [...FAKE_FIRST_CHUNK, ...FAKE_REST_CHUNK],
    "der Puffer traegt erstes Paket + Rest in der Reihenfolge des Stroms",
  );
  assert.match(seenUrl, /\/v1\/text-to-speech\/voice123\/stream\?/, "der Streaming-Endpunkt");
  assert.match(seenUrl, /output_format=mp3_44100_128/, "output_format ist ein Query-Parameter");
  assert.equal(seenBody.model_id, "eleven_flash_v2_5");
  assert.equal(seenBody.text, "Hallo Welt");
  assert.equal(seenHeaders["xi-api-key"], SECRET_KEY, "Key geht NUR als Header raus");
});

test("HTTP-Fehler (4xx/5xx) -> {ok:false, reason:'http_<status>', detail}, kein Wurf", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom detail" });
  const result = await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl });
  assert.deepEqual(result, { ok: false, fehler: { reason: "http_500", detail: "boom detail" } });
});

test("HTTP-Fehler ohne res.text (defensiv) -> detail:'' , kein Wurf", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400 });
  const result = await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl });
  assert.deepEqual(result, { ok: false, fehler: { reason: "http_400", detail: "" } });
});

test("Antwort ohne lesbaren Strom -> {ok:false, reason:'no_stream'}, kein Wurf", async () => {
  const fetchImpl = async () => ({ ok: true, headers: { get: () => "audio/mpeg" } });
  const result = await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl });
  assert.deepEqual(result, { ok: false, fehler: "no_stream" });
});

test("Kein erstes Paket (leerer Strom) -> {ok:false, reason:'empty_stream'} - kein <Play> ins Leere", async () => {
  const fetchImpl = async () => fakeTtsStreamResponse({ chunks: [] });
  const result = await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl });
  assert.deepEqual(result, { ok: false, fehler: "empty_stream" });
});

test("Abbruch/Timeout VOR dem ersten Paket -> {ok:false, reason:'timeout'}, kein Wurf", async () => {
  const fetchImpl = (url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  const result = await synthesizeSpeechStream("x", {
    ...baseOpts({ firstChunkTimeoutMs: SHORT_FIRST_CHUNK_TIMEOUT_MS }),
    fetchImpl,
  });
  assert.deepEqual(result, { ok: false, fehler: "timeout" });
});

test("Sonstiger Fehler (z.B. Netzwerk) -> {ok:false, reason:'error'}, kein Wurf", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl });
  assert.deepEqual(result, { ok: false, fehler: "error" });
});

test("Bricht der Strom NACH dem ersten Paket, lehnt audio NICHT ab: bisherige Bytes + complete:false", async () => {
  const restGate = deferred();
  const fetchImpl = async () => fakeTtsStreamResponse({ restGate: restGate.promise });
  const result = await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl });
  assert.equal(result.ok, true);
  restGate.reject(new Error("stream broke"));
  const audio = await result.wert.audio;
  assert.equal(audio.complete, false, "der Abbruch ist sichtbar, nicht verschluckt");
  assert.deepEqual(Array.from(audio.bytes), [...FAKE_FIRST_CHUNK], "mindestens das erste Paket - nie Stille");
});

test("Kein API-Key in Rueckgabe/Fehler (Regel 4/Secrets)", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 });
  const result = await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(SECRET_KEY), false, "Key darf nie in der Rueckgabe stehen");
  assert.equal(Object.keys(result).includes("apiKey"), false);
});

const CONTENT_TYPE_TABELLE = [
  ["", "audio/mpeg"],
  [null, "audio/mpeg"],
  [undefined, "audio/mpeg"],
  ["audio/ogg", "audio/ogg"],
];

for (const [kopf, erwartet] of CONTENT_TYPE_TABELLE) {
  test(`synth: Content-Type ${JSON.stringify(kopf)} liefert ${erwartet}`, async () => {
    const fetchImpl = async () => {
      const antwort = fakeTtsStreamResponse();
      return { ...antwort, headers: { get: () => kopf } };
    };
    const ergebnis = await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl });
    assert.equal(ergebnis.ok, true);
    assert.equal(ergebnis.wert.contentType, erwartet);
    const audio = await ergebnis.wert.audio;
    assert.deepEqual(Array.from(audio.bytes.subarray(0, FAKE_FIRST_CHUNK.length)), [...FAKE_FIRST_CHUNK]);
  });
}

test("synth: HTTP-Fehler nennt den Status als http_<zahl> samt Text", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => "zu viele" });
  assert.deepEqual(await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl }), {
    ok: false,
    fehler: { reason: "http_429", detail: "zu viele" },
  });
});

const FEHLER_TABELLE = [
  [{ name: "AbortError" }, "timeout"],
  [{ name: "TypeError" }, "error"],
  [{ name: 5 }, "error"],
  [null, "error"],
  [undefined, "error"],
  ["AbortError", "error"],
];

for (const [geworfen, grund] of FEHLER_TABELLE) {
  test(`synth: geworfen ${JSON.stringify(geworfen)} ergibt ${grund}`, async () => {
    const fetchImpl = async () => {
      throw geworfen;
    };
    assert.deepEqual(await synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl }), { ok: false, fehler: grund });
  });
}

test("synth: die Frist fuers erste Paket bricht die Anfrage ab (timeout)", async () => {
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("abgebrochen"), { name: "AbortError" })));
    });
  const ergebnis = await synthesizeSpeechStream("x", { ...baseOpts({ firstChunkTimeoutMs: 5 }), fetchImpl });
  assert.deepEqual(ergebnis, { ok: false, fehler: "timeout" });
});

async function ersteLesung(lesung) {
  const antwort = { ok: true, headers: { get: () => "audio/mpeg" }, body: { getReader: () => ({ read: async () => lesung }) } };
  return synthesizeSpeechStream("x", { ...baseOpts(), fetchImpl: async () => antwort });
}

test("synth: leeres erstes Paket ohne Stromende ergibt empty_stream", async () => {
  assert.deepEqual(await ersteLesung({ done: false, value: new Uint8Array() }), { ok: false, fehler: "empty_stream" });
});

test("synth: erstes Paket fehlt ohne Stromende ergibt empty_stream", async () => {
  assert.deepEqual(await ersteLesung({ done: false }), { ok: false, fehler: "empty_stream" });
});

test("synth: Stromende mit Bytes ergibt empty_stream", async () => {
  assert.deepEqual(await ersteLesung({ done: true, value: FAKE_FIRST_CHUNK }), { ok: false, fehler: "empty_stream" });
});
