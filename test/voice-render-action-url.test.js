// S1-14: makeVoiceRender direkt (kein Server-Spawn) - turnDirectives() liefert
// [gather, redirect]; nur die action/url-Felder werden geprueft (Werte, kein Byte-
// Markup -> flakefrei). Telnyx -> absolute URL (TeXML loest relative URLs anders auf,
// config.publicUrl zur Laufzeit gelesen).
//
// C-P4: hier standen zwei Tests, deren Gegenstand der UNTERSCHIED zwischen zwei Anbietern
// war ("twilio -> relative Action-URL", "streamDirectives -> Twilio-Media-Pfad"). Mit dem
// Ausbau haben sie keinen Gegenstand mehr und sind entfallen. Beim Entfernen ist ein
// BEFUND aufgefallen, der weiter unten als Charakterisierung festgehalten ist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeVoiceRender } from "../src/telephony/voice-render.js";

const fakeConfig = {
  server: { publicUrl: "https://agent.test" },
  voice: { sttSpeechTimeoutSec: 2 },
};

test("S1-14b: telnyx-Call -> absolute Action-URL (config.publicUrl-Praefix)", () => {
  const { turnDirectives } = makeVoiceRender({ config: fakeConfig });
  const [gatherD, redirectD] = turnDirectives(
    { id: "call_2", provider: "telnyx", language: "de" },
    "Hallo",
  );
  // SEC-P1: die Action-URL traegt seither eine frische Turn-Marke je gerendertem Gather
  // (Ereignis-Anker des Wiederholungs-Riegels). Praefix byte-genau, die Marke als FORM
  // (16 Hex-Zeichen aus 8 Zufallsbytes) - ein fester Wert waere per Definition nicht
  // frisch. Gather und Redirect MUESSEN dieselbe Marke tragen: bei TeXML feuert genau
  // eines von beiden, also gehoert zu einem Gather genau EIN Ereignis-Anker.
  assert.match(
    gatherD.action,
    /^https:\/\/agent\.test\/voice\/turn\?callId=call_2&turnToken=[0-9a-f]{16}$/,
  );
  assert.equal(redirectD.url, gatherD.action);
});

// S3 (P8-Testluecke): streamDirectives() - https->wss-Ersetzung + MEDIA_PATH + Param-Form
// (call_id/stream_token).
test("S3: streamDirectives -> telnyx-Media-Pfad + Param-Form", () => {
  const { streamDirectives } = makeVoiceRender({ config: fakeConfig });
  const [stream] = streamDirectives({ id: "call_10", provider: "telnyx", streamToken: "tok10" });
  assert.equal(stream.url, "wss://agent.test/media/telnyx");
  assert.deepEqual(stream.params, [
    { name: "call_id", value: "call_10" },
    { name: "stream_token", value: "tok10" },
  ]);
});

// C-P1: der vierte DEFAULT_PROVIDER-Leser (MEDIA_PATH-Rueckfall) war bisher ungetestet -
// der Test oben setzt provider explizit. Literal statt MEDIA_PATH[DEFAULT_PROVIDER],
// damit die Assertion beim Zurueckdrehen des Flips ROT wird statt mitzuwandern.
test("C-P1: streamDirectives ohne call.provider -> Media-Pfad des Rueckfalls (Telnyx)", () => {
  const { streamDirectives } = makeVoiceRender({ config: fakeConfig });
  const [stream] = streamDirectives({ id: "call_11", streamToken: "tok11" });
  assert.equal(stream.url, "wss://agent.test/media/telnyx");
});

// CHARAKTERISIERUNG (C-P4-Befund, BEWUSST NICHT GEFIXT - Scope).
//
// Die drei provider-lesenden Stellen in voice-render.js sind sich NICHT einig, was bei
// einem Call OHNE provider-Feld gilt:
//   - render()          -> voiceRenderer(undefined) -> DEFAULT_PROVIDER = Telnyx -> TeXML
//   - streamDirectives  -> MEDIA_PATH[undefined] || MEDIA_PATH[DEFAULT_PROVIDER] -> Telnyx
//   - turnDirectives    -> call.provider === PROVIDER.TELNYX ist FALSE -> base = ""
//                          -> RELATIVE Action-URL
// Ergebnis: TeXML mit relativer Action-URL - genau die Kombination, die der Kommentar an
// turnDirectives ausschliesst ("Telnyx-TeXML loest relative URLs anders auf").
//
// Das ist dieselbe Fehlerklasse wie C-P1b (ein Anbieter-Default, der nicht DEFAULT_PROVIDER
// folgt), nur an einer sechsten Stelle, die C-P1b nicht erwischt hat. Bis C-P4 war der
// Zweig harmlos: base="" galt fuer Twilio, und Twilio rendert relative URLs korrekt.
//
// LIVE-WIRKUNG heute: keine. createCall setzt provider IMMER auf DEFAULT_PROVIDER
// (test/telephony-registry.test.js, "call.provider-Eintrittspfade"), ein Call ohne Feld
// entsteht also nicht mehr - nur Bestandszeilen koennten ihn tragen.
//
// Dieser Test pinnt den IST-Zustand, damit der Befund nicht still verschwindet oder still
// kippt. Wer ihn behebt, macht diesen Test rot - und das ist die Absicht.
test("BEFUND (Charakterisierung): Call ohne provider -> TeXML-Renderer, aber RELATIVE Action-URL", () => {
  const { turnDirectives } = makeVoiceRender({ config: fakeConfig });
  const [gatherD, redirectD] = turnDirectives({ id: "call_12", language: "de" }, "Hallo");
  assert.match(gatherD.action, /^\/voice\/turn\?callId=call_12&turnToken=[0-9a-f]{16}$/);
  assert.equal(redirectD.url, gatherD.action);
});
