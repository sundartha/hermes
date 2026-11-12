import assert from "node:assert/strict";
import { withFetch } from "../helpers.js";
import { mitKurzerFrist } from "./kurze-antwortfrist.mjs";

function antwort() {
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
}

export async function pruefeNaht(aufruf, erwartet) {
  const gesehen = [];
  const fristen = await mitKurzerFrist(() =>
    withFetch(
      async (url, init) => {
        gesehen.push({ hatSignal: init?.signal instanceof AbortSignal, fristMs: init?.fristMs });
        return antwort();
      },
      async () => {
        try {
          await aufruf();
        } catch (fehler) {
          assert.notEqual(fehler?.name, "TypeError");
        }
      },
    ),
  );
  assert.equal(gesehen.length, erwartet.length);
  assert.deepEqual([...new Set(fristen)].sort(), [...new Set(erwartet)].sort());
  assert.ok(fristen.length >= erwartet.length);
  assert.ok(gesehen.every((eintrag) => eintrag.hatSignal && eintrag.fristMs === undefined));
}
