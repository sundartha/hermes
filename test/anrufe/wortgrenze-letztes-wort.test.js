import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startExaFake } from "../../scripts/convo-bench/exa-fake.mjs";

const HTTP_OK = 200;
const LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "wortgrenze-token-testgeheim";
const CONVERSATION_ID = "conv_wortgrenze_1";
const SUCHANFRAGE = "Sprechzeiten Praxis Dr. Hoffmann";

const FAKT_GRENZE_ZEICHEN = 200;
const TITEL = "Praxis Dr. Hoffmann";
const TITEL_TRENNER = ": ";
const AUSZUG_ANFANG =
  "Im November 2026 gilt ein neuer Plan: Sprechstunde nur vormittags, Rezepte nur nach Vorbestellung, Befunde per Post, und telefonisch erreichbar ist die Praxis am Brueckentag ";
const AUSZUG_ENDE = " mehr, auch nicht per Mail.";
const FAKT_ENDE_BIS_BRUECKENTAG = "und telefonisch erreichbar ist die Praxis am Brueckentag";

const LOOKUP_ENV = Object.freeze({
  LOOKUP_ENABLED: "true",
  EXA_API_KEY: "exa-test-key",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  SKIP_TWILIO_SIGNATURE_CHECK: "false",
  MULTI_TENANT: "true",
});

async function fragRecherche(auszug) {
  const exa = await startExaFake({ facts: [{ title: TITEL, highlight: auszug }] });
  const srv = await startServer({
    env: { ...LOOKUP_ENV, EXA_API_BASE: exa.url },
    seed: seedState({
      calls: [
        seedCall({
          id: "call_wortgrenze",
          status: "active",
          maxDurationS: 300,
          elevenlabsConversationId: CONVERSATION_ID,
        }),
      ],
    }),
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}${LOOKUP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
      body: JSON.stringify({ conversation_id: CONVERSATION_ID, query: SUCHANFRAGE }),
    });
    assert.equal(res.status, HTTP_OK);
    return await res.json();
  } finally {
    await srv.stop();
    await exa.close();
  }
}

const faktVon = (wortNachBrueckentag) =>
  `${TITEL}${TITEL_TRENNER}${AUSZUG_ANFANG}${wortNachBrueckentag}${AUSZUG_ENDE}`;

test("wortgrenze S1: Leerzeichen genau an der Grenze, Recherche-Fakt behaelt das letzte Wort 'nicht'", async () => {
  const fakt = faktVon("nicht");
  assert.equal(fakt[FAKT_GRENZE_ZEICHEN], " ", "Vorbedingung: Leerzeichen an Stelle 200");
  const erwarteterFakt = fakt.slice(0, FAKT_GRENZE_ZEICHEN);
  const antwort = await fragRecherche(fakt.slice(TITEL.length + TITEL_TRENNER.length));
  assert.equal(antwort.status, "ok");
  assert.ok(
    antwort.answer.endsWith(erwarteterFakt),
    `Fakt endet mit 200 Zeichen am Brueckentag nicht: ${antwort.answer}`,
  );
});

test("wortgrenze B2: Grenze mitten im Wort 'niemals' bleibt beim Wort davor", async () => {
  const fakt = faktVon("niemals");
  assert.equal(fakt[FAKT_GRENZE_ZEICHEN], "l", "Vorbedingung: 'l' an Stelle 200");
  const antwort = await fragRecherche(fakt.slice(TITEL.length + TITEL_TRENNER.length));
  assert.equal(antwort.status, "ok");
  assert.ok(antwort.answer.endsWith(FAKT_ENDE_BIS_BRUECKENTAG), `Fakt endet bei Brueckentag: ${antwort.answer}`);
  assert.ok(!antwort.answer.endsWith("niema"), `kein Bruchstueck von niemals am Ende: ${antwort.answer}`);
});

test("wortgrenze B3: Leerzeichen erst eine Stelle hinter der Grenze behaelt 'nichts' nicht", async () => {
  const fakt = faktVon("nichts");
  assert.equal(fakt[FAKT_GRENZE_ZEICHEN], "s", "Vorbedingung: 's' an Stelle 200");
  assert.equal(fakt[FAKT_GRENZE_ZEICHEN + 1], " ", "Vorbedingung: Leerzeichen an Stelle 201");
  const antwort = await fragRecherche(fakt.slice(TITEL.length + TITEL_TRENNER.length));
  assert.equal(antwort.status, "ok");
  assert.ok(antwort.answer.endsWith(FAKT_ENDE_BIS_BRUECKENTAG), `Fakt endet bei Brueckentag: ${antwort.answer}`);
  assert.ok(!antwort.answer.includes("nichts"), `kein nichts im Fakt: ${antwort.answer}`);
});

