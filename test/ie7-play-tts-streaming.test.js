import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { makeDirectiveSynth } from "../src/tts/directive-synth.js";
import { say } from "../src/telephony/directives.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import {
  FAKE_FIRST_CHUNK,
  FAKE_REST_CHUNK,
  deferred,
  recordingStreamFetch,
} from "./helpers/fake-tts-stream.mjs";
import {
  turnBudgetMs,
  turnBudgetOverrun,
  turnLoopDeadlineMs,
} from "../src/turn-budget.js";
import { startServer, seedWithTelnyxNumber, postTelnyxIncoming } from "./helpers.js";

const PUBLIC_URL = "https://agent.test";
const TOKEN = "ie7-token";
const PROVIDER = "telnyx";
const SPOKEN_TEXT = "Guten Tag";

function fakeConfig() {
  return withConfigNamespaces({
    publicUrl: PUBLIC_URL,
    elevenLabsPlayTts: {
      enabled: true,
      apiKey: "sk_test_should_never_leak",
      voiceId: "voice123",
      model: "eleven_v3_conversational",
      apiBase: "https://api.elevenlabs.io",
      outputFormat: "mp3_44100_128",
      synthTimeoutMs: 2000,
      synthTotalTimeoutMs: 10000,
    },
  });
}

function fakeTtsStore() {
  const putCalls = [];
  return {
    putCalls,
    put(audio) {
      putCalls.push(audio);
      return TOKEN;
    },
  };
}

function zaehlenderStore() {
  const calls = [];
  return {
    calls,
    recordTtsCharacters(chars, nowIso) {
      calls.push({ chars, nowIso });
      return null;
    },
  };
}

async function laufMitGehaltenemStrom({ store, chunks }) {
  const restGate = deferred();
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig(),
    ttsStore,
    store,
    onQuotaWarning: () => assert.fail("onQuotaWarning gehoert nicht zu dieser Messung"),
  });
  const { fetchImpl } = recordingStreamFetch({ restGate: restGate.promise, chunks });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  let out;
  try {
    out = await synthesizeDirectiveAudio({ provider: PROVIDER }, [say(SPOKEN_TEXT)]);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { out, putCalls: ttsStore.putCalls, restGate };
}

test("Nicht-Blockierung: synthesizeDirectiveAudio liefert die <Play>-URL, waehrend der Rest des Stroms noch haengt", async () => {
  const { out, putCalls, restGate } = await laufMitGehaltenemStrom({ store: zaehlenderStore() });
  assert.equal(
    out[0].audioUrl,
    `${PUBLIC_URL}/voice/tts/${TOKEN}`,
    "die Direktive traegt die Serve-URL, obwohl der Strom noch laeuft",
  );
  assert.equal(putCalls.length, 1, "genau EINE Ablage");
  assert.equal(typeof putCalls[0].bytes.then, "function", "abgelegt ist ein Versprechen, keine fertigen Bytes");
  restGate.resolve();
  assert.ok((await putCalls[0].bytes).length > 0);
});

test("Fehler NACH dem Rendern: bricht der Strom ab, liefert der Abruf das erste Paket - nie 404, nie Stille", async () => {
  const { out, putCalls, restGate } = await laufMitGehaltenemStrom({ store: zaehlenderStore() });
  assert.ok(out[0].audioUrl, "Vorbedingung: das <Play> steht bereits");
  restGate.reject(new Error("stream broke"));
  const bytes = await putCalls[0].bytes;
  assert.deepEqual(Array.from(bytes), [...FAKE_FIRST_CHUNK], "das erste Paket kommt trotzdem beim Abruf an");
  assert.ok(bytes.length > 0, "ein abgeschnittener gesprochener Satz - nie Stille");
});

test("Kein erstes Paket -> gar kein <Play>: Direktiven unveraendert, kein put", async () => {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: fakeConfig(),
    ttsStore,
    store: zaehlenderStore(),
    onQuotaWarning: () => assert.fail("onQuotaWarning gehoert nicht zu dieser Messung"),
  });
  const directives = [say(SPOKEN_TEXT)];
  const { fetchImpl } = recordingStreamFetch({ chunks: [] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  let out;
  try {
    out = await synthesizeDirectiveAudio({ provider: PROVIDER }, directives);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(out[0], directives[0], "referenz-identisch -> Azure-<Say>");
  assert.equal(ttsStore.putCalls.length, 0, "ein leeres <Play> entsteht gar nicht erst");
});

test("Das Kontingent wird beim ERSTEN Audio-Paket gebucht, nicht erst wenn der Strom fertig ist", async () => {
  const store = zaehlenderStore();
  const { restGate } = await laufMitGehaltenemStrom({ store });
  assert.equal(store.calls.length, 1, "die Buchung liegt vor der Webhook-Antwort, nicht hinter dem Strom");
  assert.equal(store.calls[0].chars, SPOKEN_TEXT.length);
  restGate.resolve();
});

test("Abgebrochener Strom zaehlt trotzdem genau einmal - eine Wiederholung gibt es nicht", async () => {
  const store = zaehlenderStore();
  const { putCalls, restGate } = await laufMitGehaltenemStrom({ store });
  restGate.reject(new Error("stream broke"));
  await putCalls[0].bytes;
  assert.equal(store.calls.length, 1, "der Abbruch bucht weder nach noch zurueck");
});

const SHIPPED_TURN_PARAMS = Object.freeze({
  requestTimeoutMs: 3500,
  maxRetries: 2,
  backoffMs: 250,
  synthTimeoutMs: 2000,
});
const ERWARTETE_LOOP_FRIST_MS = 11500;
const ABSURDE_GESAMTFRIST_MS = 30000;

test("Die Gesamtfrist des Hintergrund-Stroms liegt NICHT auf der Turn-Wanduhr", async () => {
  assert.equal(
    turnBudgetMs({ ...SHIPPED_TURN_PARAMS, synthTotalTimeoutMs: ABSURDE_GESAMTFRIST_MS }),
    turnBudgetMs(SHIPPED_TURN_PARAMS),
    "die Gesamtfrist ist kein Summand - sie laeuft, nachdem der Webhook geantwortet hat",
  );
  assert.equal(turnBudgetOverrun(SHIPPED_TURN_PARAMS), null, "das 15-s-Budget haelt unveraendert");
  assert.equal(turnLoopDeadlineMs(SHIPPED_TURN_PARAMS.synthTimeoutMs), ERWARTETE_LOOP_FRIST_MS);
});

const LANGSAMER_REST_MS = 3000;
const WEBHOOK_OBERGRENZE_MS = 1500;
const FAKE_MP3 = Buffer.concat([Buffer.from(FAKE_FIRST_CHUNK), Buffer.from(FAKE_REST_CHUNK)]);
const HTTP_OK = 200;

async function startLangsamenOrigin() {
  const timers = new Set();
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.setHeader("content-type", "audio/mpeg");
      res.write(Buffer.from(FAKE_FIRST_CHUNK));
      const timer = setTimeout(() => {
        timers.delete(timer);
        res.end(Buffer.from(FAKE_REST_CHUNK));
      }, LANGSAMER_REST_MS);
      timers.add(timer);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("Flag AN, langsamer Fake-Origin: /voice/incoming antwortet, bevor der Origin die letzten Bytes geschickt hat", async () => {
  const origin = await startLangsamenOrigin();
  const srv = await startServer({
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: {
      ELEVENLABS_PLAY_TTS_ENABLED: "true",
      ELEVENLABS_API_KEY: "test-elevenlabs-key",
      ELEVENLABS_VOICE_ID: "voice-1",
      ELEVENLABS_API_BASE: origin.url,
    },
  });
  try {
    const startedAt = Date.now();
    const res = await postTelnyxIncoming(srv, { callSid: "CAie7streaming" });
    const texml = await res.text();
    const webhookMs = Date.now() - startedAt;

    assert.equal(res.status, HTTP_OK);
    assert.match(texml, /<Play>https:\/\/agent\.test\/voice\/tts\/[A-Za-z0-9_-]+<\/Play>/);
    assert.ok(
      webhookMs < WEBHOOK_OBERGRENZE_MS,
      `der Webhook haette nicht auf den Rest warten duerfen, brauchte aber ${webhookMs} ms`,
    );

    const token = texml.match(/\/voice\/tts\/([A-Za-z0-9_-]+)/)[1];
    const audio = await fetch(`${srv.localUrl}/voice/tts/${token}`);
    assert.equal(audio.status, HTTP_OK);
    assert.deepEqual(
      Buffer.from(await audio.arrayBuffer()),
      FAKE_MP3,
      "der Abruf wartet den Rest ab und liefert ALLE Bytes",
    );
  } finally {
    await srv.stop();
    await origin.close();
  }
});
