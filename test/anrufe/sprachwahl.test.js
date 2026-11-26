import assert from "node:assert/strict";
import { test } from "node:test";

import { sprachcodeOf } from "../../src/i18n/sprachcode.ts";
import { sprachwahlOf } from "../../src/i18n/sprachwahl.ts";
import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;

const CODE_FAELLE = [
  ["pt-BR", { ok: true, wert: "pt-br" }],
  [" FR ", { ok: true, wert: "fr" }],
  [42, { ok: false, fehler: "kein-text" }],
  ["", { ok: false, fehler: "ungueltige-form" }],
  ["x", { ok: false, fehler: "ungueltige-form" }],
  ["deutsch", { ok: false, fehler: "ungueltige-form" }],
];

for (const [eingabe, erwartet] of CODE_FAELLE) {
  test(`sprachcodeOf(${JSON.stringify(eingabe)}) liefert ${JSON.stringify(erwartet)}`, () => {
    assert.deepEqual(sprachcodeOf(eingabe), erwartet);
  });
}

const WAHL_FAELLE = [
  ["fr", { ok: true, wert: { code: "fr", texte: "fr" } }],
  ["de", { ok: true, wert: { code: "de", texte: "de" } }],
  ["pt", { ok: false, fehler: { code: "pt", texte: "en" } }],
  ["pt-br", { ok: false, fehler: { code: "pt-br", texte: "en" } }],
];

for (const [eingabe, erwartet] of WAHL_FAELLE) {
  test(`sprachwahlOf(${eingabe}) liefert ${JSON.stringify(erwartet)}`, () => {
    assert.deepEqual(sprachwahlOf(eingabe), erwartet);
  });
}

async function startsprachZeilen(language) {
  const srv = await startServer({
    env: { ELEVENLABS_OUTBOUND_ENABLED: "true", ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true", ELEVENLABS_OUTBOUND_VORSPANN: "true" },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: "Termin vereinbaren", language }),
    });
    assert.equal(res.status, HTTP_OK, await res.text());
    return srv.stdout.split("\n").filter((zeile) => zeile.includes("startsprache="));
  } finally {
    await srv.stop();
  }
}

test("POST /api/calls mit language pt loggt genau einmal startsprache=pt texte=en", async () => {
  const zeilen = await startsprachZeilen("pt");
  assert.equal(zeilen.length, 1, zeilen.join("\n"));
  assert.match(zeilen[0], /startsprache=pt texte=en$/);
});

test("POST /api/calls mit language fr loggt startsprache=fr texte=fr", async () => {
  const zeilen = await startsprachZeilen("fr");
  assert.equal(zeilen.length, 1, zeilen.join("\n"));
  assert.match(zeilen[0], /startsprache=fr texte=fr$/);
});
