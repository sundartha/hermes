// Unit-Tests fuer src/tts/store.js (PII-Audio-Serve-Seam, In-Memory-Port). Pinnt:
// put->takeOnce liefert exakt die Bytes+ContentType; zweiter takeOnce -> null (EINMALIG);
// nach TTL -> null (kein Nichtabruf-Leck); zwei put -> verschiedene, URL-sichere Tokens.
// IE7: die Ablage haelt ein VERSPRECHEN auf die Bytes - ein noch laufendes wird beim
// Abruf abgewartet, und takeOnce loescht VOR dem Warten (ein paralleler zweiter Abruf
// bekommt 404, statt auf dieselben Bytes zu warten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtsStore } from "../src/tts/store.js";
// Die Bytewerte sind ohne Bedeutung - geliehen aus dem geteilten Strom-Harnisch, damit
// hier keine nackten Zahlen stehen (G25).
import { FAKE_FIRST_CHUNK, FAKE_REST_CHUNK } from "./helpers/fake-tts-stream.mjs";

const TTL_MS = 60000;
const SHORT_TTL_MS = 5;
const TTL_WAIT_MS = 30;
const BYTES_A = Buffer.from(FAKE_FIRST_CHUNK);
const BYTES_B = Buffer.from(FAKE_REST_CHUNK);

// Der schon fertige Sonderfall der EINEN Ablageform (IE7): Bytes als aufgeloestes
// Versprechen.
function fertigesAudio(bytes, contentType = "audio/mpeg") {
  return { bytes: Promise.resolve(bytes), contentType };
}

test("put -> takeOnce liefert exakt die Bytes + ContentType", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const bytes = BYTES_A;
  const token = store.put(fertigesAudio(bytes));
  const result = await store.takeOnce(token);
  assert.deepEqual(result, { bytes, contentType: "audio/mpeg" });
});

test("Zweiter takeOnce fuer denselben Token -> null (EINMALIGER Abruf)", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const token = store.put(fertigesAudio(BYTES_A));
  assert.notEqual(await store.takeOnce(token), null);
  assert.equal(await store.takeOnce(token), null);
});

test("Unbekannter Token -> null", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  assert.equal(await store.takeOnce("nie-vergeben"), null);
});

test("Nach Ablauf der TTL -> null (kein Nichtabruf-Leck)", async () => {
  const store = createTtsStore({ ttlMs: SHORT_TTL_MS });
  const token = store.put(fertigesAudio(BYTES_A));
  await new Promise((resolve) => setTimeout(resolve, TTL_WAIT_MS));
  assert.equal(await store.takeOnce(token), null);
});

test("Zwei put() -> verschiedene, URL-sichere Tokens (base64url, kein Escaping noetig)", () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const t1 = store.put(fertigesAudio(BYTES_A));
  const t2 = store.put(fertigesAudio(BYTES_B));
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]+$/, "base64url-Alphabet, kein +/=");
  assert.match(t2, /^[A-Za-z0-9_-]+$/, "base64url-Alphabet, kein +/=");
});

test("IE7: ein noch laufendes Versprechen wird beim Abruf abgewartet", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const bytes = BYTES_B;
  let liefern;
  const token = store.put({
    contentType: "audio/mpeg",
    bytes: new Promise((resolve) => {
      liefern = resolve;
    }),
  });
  const abruf = store.takeOnce(token);
  liefern(bytes);
  assert.deepEqual(await abruf, { bytes, contentType: "audio/mpeg" });
});

test("IE7: takeOnce loescht VOR dem Warten -> paralleler zweiter Abruf bekommt null", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  let liefern;
  const token = store.put({
    contentType: "audio/mpeg",
    bytes: new Promise((resolve) => {
      liefern = resolve;
    }),
  });
  const ersterAbruf = store.takeOnce(token);
  const zweiterAbruf = store.takeOnce(token); // startet WAEHREND der erste noch wartet
  assert.equal(await zweiterAbruf, null, "kein zweiter Konsument derselben Ausgabe");
  liefern(BYTES_A);
  assert.notEqual(await ersterAbruf, null);
});
