import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtsStore } from "../../src/tts/store.ts";

function geteilteAblage({ ablegenScheitert = false } = {}) {
  const zeilen = new Map();
  return {
    ablegen: async (token, audio) => {
      if (ablegenScheitert) throw new Error("ablage weg");
      zeilen.set(token, { bytes: await audio.bytes, contentType: audio.contentType });
    },
    lesen: async (token) => zeilen.get(token) ?? null,
    freigeben: async (token) => {
      zeilen.delete(token);
    },
  };
}

const audio = () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" });

test("nach erfolgreichem Ablegen liefert takeOnce nach release auf einer zweiten Store-Instanz mit derselben Ablage nichts mehr", async () => {
  const bisFreigabeAblage = geteilteAblage();
  const a = createTtsStore({ ttlMs: 60000, bisFreigabeAblage });
  const b = createTtsStore({ ttlMs: 60000, bisFreigabeAblage });
  const token = await a.put(audio(), { bisFreigabe: true });
  assert.deepEqual((await b.takeOnce(token)).bytes, new Uint8Array([1, 2, 3]));
  b.release(token);
  await new Promise((r) => setImmediate(r));
  assert.equal(await a.takeOnce(token), null);
});

test("scheitert das Ablegen, bleibt der Speichereintrag als Rueckfall", async () => {
  const bisFreigabeAblage = geteilteAblage({ ablegenScheitert: true });
  const a = createTtsStore({ ttlMs: 60000, bisFreigabeAblage });
  const stumm = console.error;
  console.error = () => {};
  const token = await a.put(audio(), { bisFreigabe: true }).finally(() => {
    console.error = stumm;
  });
  assert.deepEqual((await a.takeOnce(token)).bytes, new Uint8Array([1, 2, 3]));
});
