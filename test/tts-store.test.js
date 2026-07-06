// Unit-Tests fuer src/tts/store.js (PII-Audio-Serve-Seam, In-Memory-Port). Pinnt:
// put->takeOnce liefert exakt die Bytes+ContentType; zweiter takeOnce -> null (EINMALIG);
// nach TTL -> null (kein Nichtabruf-Leck); zwei put -> verschiedene, URL-sichere Tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtsStore } from "../src/tts/store.js";

test("put -> takeOnce liefert exakt die Bytes + ContentType", () => {
  const store = createTtsStore({ ttlMs: 60000 });
  const bytes = Buffer.from([9, 8, 7]);
  const token = store.put(bytes, "audio/mpeg");
  const result = store.takeOnce(token);
  assert.deepEqual(result, { bytes, contentType: "audio/mpeg" });
});

test("Zweiter takeOnce fuer denselben Token -> null (EINMALIGER Abruf)", () => {
  const store = createTtsStore({ ttlMs: 60000 });
  const token = store.put(Buffer.from([1]), "audio/mpeg");
  assert.notEqual(store.takeOnce(token), null);
  assert.equal(store.takeOnce(token), null);
});

test("Unbekannter Token -> null", () => {
  const store = createTtsStore({ ttlMs: 60000 });
  assert.equal(store.takeOnce("nie-vergeben"), null);
});

test("Nach Ablauf der TTL -> null (kein Nichtabruf-Leck)", async () => {
  const store = createTtsStore({ ttlMs: 5 });
  const token = store.put(Buffer.from([1]), "audio/mpeg");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(store.takeOnce(token), null);
});

test("Zwei put() -> verschiedene, URL-sichere Tokens (base64url, kein Escaping noetig)", () => {
  const store = createTtsStore({ ttlMs: 60000 });
  const t1 = store.put(Buffer.from([1]), "audio/mpeg");
  const t2 = store.put(Buffer.from([2]), "audio/mpeg");
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]+$/, "base64url-Alphabet, kein +/=");
  assert.match(t2, /^[A-Za-z0-9_-]+$/, "base64url-Alphabet, kein +/=");
});
