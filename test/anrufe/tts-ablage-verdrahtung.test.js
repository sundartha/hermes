import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { createTtsStore } from "../../src/tts/store.js";
import { makeDirectiveSynth } from "../../src/tts/directive-synth.js";
import { say } from "../../src/telephony/directives.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { recordingStreamFetch } from "../helpers/fake-tts-stream.mjs";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { mitZweiHermesAufPostgres, postgresVorhanden } from "./hermes-mit-postgres.js";

const TTL_MS = 60000;
const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01]);
const TYP = "audio/mpeg";
const STORE_URL = new URL("../../src/store.js", import.meta.url).href;
const PUBLIC_URL = "https://agent.test";
const ABLAGE_TOKEN = "abruf-ueber-zweiten-prozess";

function fertigesAudio(bytes = AUDIO) {
  return { bytes: Promise.resolve(bytes), contentType: TYP };
}

function fakeAblage({ ablegenFehler = null, holenErgebnis = null } = {}) {
  const aufrufe = { ablegen: [], holen: [] };
  return {
    aufrufe,
    async ablegen(token, audio) {
      aufrufe.ablegen.push({ token, audio });
      if (ablegenFehler) throw ablegenFehler;
      return { fertig: Promise.resolve(true) };
    },
    async holen(token) {
      aufrufe.holen.push(token);
      return holenErgebnis;
    },
  };
}

test("Ablage aktiv: put legt in der Ablage ab, liefert den Token erst danach und nicht aus dem Prozessspeicher", async () => {
  const ablage = fakeAblage();
  const store = createTtsStore({ ttlMs: TTL_MS, ablage });
  const audio = fertigesAudio();
  const token = await store.put(audio);
  assert.equal(typeof token, "string");
  assert.equal(ablage.aufrufe.ablegen.length, 1);
  assert.equal(ablage.aufrufe.ablegen[0].token, token);
  assert.equal(ablage.aufrufe.ablegen[0].audio, audio);
});

test("Ablage aktiv: takeOnce holt aus der Ablage, was sie liefert, und null, wenn sie nichts hat", async () => {
  const geliefert = { bytes: AUDIO, contentType: TYP };
  const mitSatz = createTtsStore({ ttlMs: TTL_MS, ablage: fakeAblage({ holenErgebnis: geliefert }) });
  assert.deepEqual(await mitSatz.takeOnce("fremder-token"), geliefert);
  const ohneSatz = fakeAblage();
  const store = createTtsStore({ ttlMs: TTL_MS, ablage: ohneSatz });
  assert.equal(await store.takeOnce("fremder-token"), null);
  assert.deepEqual(ohneSatz.aufrufe.holen, ["fremder-token"]);
});

test("Ablage aktiv: scheitert die Ablage, scheitert put und es gibt keinen Token", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS, ablage: fakeAblage({ ablegenFehler: new Error("db weg") }) });
  await assert.rejects(() => store.put(fertigesAudio()), /db weg/);
});

test("Ablage aktiv: ein Vorspann mit bisFreigabe bleibt im Prozess, mehrfach abrufbar, ohne Ablage", async () => {
  const ablage = fakeAblage();
  const store = createTtsStore({ ttlMs: TTL_MS, ablage });
  const token = store.put(fertigesAudio(), { bisFreigabe: true });
  assert.equal(typeof token, "string");
  assert.deepEqual(await store.takeOnce(token), { bytes: AUDIO, contentType: TYP });
  assert.deepEqual(await store.takeOnce(token), { bytes: AUDIO, contentType: TYP });
  assert.equal(ablage.aufrufe.ablegen.length, 0);
  assert.equal(ablage.aufrufe.holen.length, 0);
  store.release(token);
  assert.equal(await store.takeOnce(token), null);
  assert.deepEqual(ablage.aufrufe.holen, [token]);
});

test("Ohne Ablage: put liefert den Token sofort und takeOnce ruft nichts ausserhalb des Prozesses", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS, ablage: null });
  const token = store.put(fertigesAudio());
  assert.equal(typeof token, "string");
  assert.deepEqual(await store.takeOnce(token), { bytes: AUDIO, contentType: TYP });
  assert.equal(await store.takeOnce(token), null);
});

function synthMit(ttsStore) {
  const config = withConfigNamespaces({
    publicUrl: PUBLIC_URL,
    elevenLabsPlayTts: {
      enabled: true,
      apiKey: "sk_test_nie_ausgeben",
      voiceId: "voice123",
      model: "eleven_flash_v2_5",
      apiBase: "https://api.elevenlabs.io",
      outputFormat: "mp3_44100_128",
      synthTimeoutMs: 2000,
      synthTotalTimeoutMs: 10000,
    },
  });
  return makeDirectiveSynth({
    config,
    ttsStore,
    store: { recordTtsCharacters: () => null },
    onQuotaWarning: () => assert.fail("keine Kontingentwarnung erwartet"),
  }).synthesizeDirectiveAudio({ provider: "telnyx" }, [say("Guten Tag")]);
}

async function mitFetch(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = recordingStreamFetch().fetchImpl;
  const stumm = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
    console.error = stumm;
  }
}

test("Satz-URL traegt den Token, den die asynchrone Ablage liefert", async () => {
  const out = await mitFetch(() => synthMit({ put: async () => "token-aus-der-ablage" }));
  assert.equal(out[0].audioUrl, `${PUBLIC_URL}/voice/tts/token-aus-der-ablage`);
});

test("Scheitert die Ablage, bleibt die Direktive ohne Abruf-URL (Azure-Stimme)", async () => {
  const out = await mitFetch(() =>
    synthMit({
      put: async () => {
        throw new Error("db weg");
      },
    }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].audioUrl, undefined);
  assert.equal(out[0].text, "Guten Tag");
});

const ABLEGEN_SKRIPT = `
const speicher = await import(${JSON.stringify(STORE_URL)});
await speicher.oeffneSpeicher();
const { fertig } = await speicher.ttsAblage.ablegen(process.argv[1], {
  contentType: process.argv[2],
  bytes: Promise.resolve(Buffer.from(process.argv[3], "base64")),
});
console.log("fertig " + (await fertig));
process.exit(0);
`;

function legeInAblageAb(umgebung, token) {
  const kind = spawn(
    process.execPath,
    ["--input-type=module", "-e", ABLEGEN_SKRIPT, token, TYP, AUDIO.toString("base64")],
    { env: { ...process.env, ...umgebung }, stdio: ["ignore", "pipe", "inherit"] },
  );
  let aus = "";
  kind.stdout.on("data", (stueck) => {
    aus += stueck;
  });
  return new Promise((fertig) => kind.on("close", () => fertig(aus)));
}

const abrufen = (srv, token) => fetch(`${srv.localUrl}/voice/tts/${token}`);

test("Zwei Prozesse am selben Postgres: der Satz eines dritten Prozesses ist ueber die Route abrufbar, genau einmal", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitZweiHermesAufPostgres(t, {}, async ({ a, b, db }) => {
    const umgebung = pgStartUmgebung(db.adresse);
    assert.match(await legeInAblageAb(umgebung, ABLAGE_TOKEN), /fertig true/);
    const antworten = await Promise.all([abrufen(a, ABLAGE_TOKEN), abrufen(b, ABLAGE_TOKEN)]);
    const stati = antworten.map((antwort) => antwort.status).sort();
    assert.deepEqual(stati, [HTTP_OK, HTTP_NOT_FOUND]);
    const treffer = antworten.find((antwort) => antwort.status === HTTP_OK);
    assert.deepEqual(Buffer.from(await treffer.arrayBuffer()), AUDIO);
    assert.equal(treffer.headers.get("content-type"), TYP);
    assert.equal((await abrufen(b, ABLAGE_TOKEN)).status, HTTP_NOT_FOUND);
    assert.equal((await abrufen(a, "nie-abgelegt")).status, HTTP_NOT_FOUND);
  });
});
