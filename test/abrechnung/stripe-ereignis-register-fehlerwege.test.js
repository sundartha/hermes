import assert from "node:assert/strict";
import { test } from "node:test";

import * as regeln from "../../src/store/stripe-ereignis-regeln.js";

const MS_JE_SEKUNDE = 1_000;
const WARTEGRENZE_MS = 10_000;
const ANTWORTGRENZE_MS = 12_000;
const TAKT_MS = 50;

function steuerbareUhr() {
  let jetzt = 0;
  return {
    jetzt: () => jetzt,
    schlafen: async (ms) => {
      jetzt += ms;
    },
  };
}

test("Stripe-Fehlerwege: belegte Sperre gibt nach der Wartegrenze auf, nicht erst nach Ablauf plus Zugabe", async () => {
  const uhr = steuerbareUhr();
  let versuche = 0;

  await assert.rejects(
    regeln.wartenBisFrei({ versuch: async () => (versuche += 1, null), ...uhr }),
    /stripe event lock busy/,
  );

  assert.ok(uhr.jetzt() >= WARTEGRENZE_MS, `gewartet ${uhr.jetzt()} ms`);
  assert.ok(uhr.jetzt() <= ANTWORTGRENZE_MS - MS_JE_SEKUNDE, `gewartet ${uhr.jetzt()} ms`);
  assert.ok(versuche > 1);
});

test("Stripe-Fehlerwege: wird die Sperre kurz vor der Wartegrenze frei, kommt das Ereignis noch dran", async () => {
  const uhr = steuerbareUhr();
  const zeile = { ereignis_id: "evt_vorher" };

  const ergebnis = await regeln.wartenBisFrei({
    versuch: async () => (uhr.jetzt() >= WARTEGRENZE_MS - TAKT_MS * 2 ? zeile : null),
    ...uhr,
  });

  assert.equal(ergebnis, zeile);
});

test("Stripe-Fehlerwege: eine freie Sperre wird ohne Warten genommen", async () => {
  const uhr = steuerbareUhr();
  const zeile = { ereignis_id: null };

  const ergebnis = await regeln.wartenBisFrei({ versuch: async () => zeile, ...uhr });

  assert.equal(ergebnis, zeile);
  assert.equal(uhr.jetzt(), 0);
});
