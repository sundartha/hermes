// VOICE-23/25/29 des i18n-Launch-Testkatalogs (Spezifikation in
// tasks/i18n-tests/03-telefonie-render.md, Welle W2 Block B2). Diese drei IDs sind
// ADAPTERUEBERGREIFENDE Aussagen ("in BEIDEN Adaptern", "kein Barge-in in der
// Budget-Engine") - deshalb EINE Datei mit beiden Renderern statt zweier gespiegelter
// Fassungen in directive-render.test.js und telnyx-render.test.js (G5).
// Rein offline, pur: kein Env, kein Spawn, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives as renderTwilio } from "../src/telephony/adapters/twilio/render.js";
import { renderDirectives as renderTelnyx } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, VOICE_PROFILE } from "../src/telephony/directives.js";

// Beide Budget-Engine-Renderer unter EINEM Namen (die Tests unten sagen dreimal
// "in beiden Adaptern" - der Name traegt die Aussage, nicht die Wiederholung).
const BUDGET_ENGINE_RENDERERS = Object.freeze([
  ["twilio", renderTwilio],
  ["telnyx", renderTelnyx],
]);
// Ein Profilwert, den KEINE der beiden Voice-Maps kennt (Platzhalter fuer ein
// kuenftiges en-US-Profil, das nur in EINEM Adapter ergaenzt wird).
const UNKNOWN_VOICE_PROFILE = "en-US-female-neural";
// Attributnamen, die ein Sprach-Barge-in am Gather auszeichnen wuerden.
const BARGE_IN_ATTRIBUTE = /barge|interrupt/i;

const gatherFor = (voiceProfile) =>
  gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1", voiceProfile });

// VOICE-23 (Charakterisierung, gruen): dokumentiert die BEWUSSTE Produktgrenze (Telnyx-
// TeXML-Gather kennt kein bargeIn, nur DTMF) im Kontrast zu VOICE-24 (Barge-in im
// Assistant-Pfad). Ein Treffer hier ist kein Fehler, sondern das Signal, dass die Grenze
// gefallen ist.
test("VOICE-23 (Charakterisierung, gruen) - Budget-Engine setzt fuer keine Sprache ein Barge-in-/Interrupt-Attribut", () => {
  for (const profile of Object.values(VOICE_PROFILE)) {
    for (const [name, render] of BUDGET_ENGINE_RENDERERS) {
      const out = render([gatherFor(profile)]);
      assert.doesNotMatch(out, BARGE_IN_ATTRIBUTE, `${name}/${profile}`);
    }
  }
});

// VOICE-25 (Mechanismus, gruen): verschraenkte DE-/EN-Renderaufrufe faerben sich nicht ab.
// Die dritte Assertion (third === first) ist die eigentliche Leak-Aussage; ohne sie
// testete der Fall nichts (Lehre "gleiche Fixture-Werte testen nichts").
test("VOICE-25 (Mechanismus, gruen) - verschraenkte DE-/EN-Renderaufrufe faerben sich nicht ab", () => {
  for (const [name, render] of BUDGET_ENGINE_RENDERERS) {
    const first = render([gatherFor(VOICE_PROFILE.DE_FEMALE_NEURAL)]);
    const second = render([gatherFor(VOICE_PROFILE.EN_FEMALE_NEURAL)]);
    const third = render([gatherFor(VOICE_PROFILE.DE_FEMALE_NEURAL)]);

    assert.match(first, /language="de-DE"/, `${name}: erster Aufruf traegt de-DE`);
    assert.match(second, /language="en-GB"/, `${name}: zweiter Aufruf traegt en-GB`);
    assert.doesNotMatch(second, /language="de-DE"/, `${name}: zweiter Aufruf leakt kein de-DE`);
    assert.equal(third, first, `${name}: dritter Aufruf ist byte-identisch zum ersten (kein Leak)`);
  }
});

// VOICE-29 (Mechanismus, gruen): Profil-Paritaet - beide Adapter kennen dieselbe
// Profilmenge und werfen beim selben Fremdprofil. Die per-Adapter-Wurftests in
// directive-render.test.js / telnyx-render.test.js bleiben, was sie sind - dieser Test
// behauptet die PAAR-Eigenschaft, die keiner von beiden ausdrueckt.
test("VOICE-29 (Mechanismus, gruen) - Profil-Paritaet: beide Adapter kennen dieselbe Profilmenge und werfen beim selben Fremdprofil", () => {
  for (const profile of Object.values(VOICE_PROFILE)) {
    for (const [name, render] of BUDGET_ENGINE_RENDERERS) {
      assert.doesNotThrow(() => render([say("Hallo", profile)]), `${name}/${profile} sollte bekannt sein`);
    }
  }

  for (const [name, render] of BUDGET_ENGINE_RENDERERS) {
    assert.throws(
      () => render([say("Hallo", UNKNOWN_VOICE_PROFILE)]),
      /unbekanntes voiceProfile/,
      `${name} sollte beim Fremdprofil werfen`,
    );
  }
});
