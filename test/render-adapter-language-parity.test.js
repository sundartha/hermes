// VOICE-22/23/25/29 des i18n-Launch-Testkatalogs (Spezifikation in
// tasks/i18n-tests/03-telefonie-render.md, Welle W2 Block B2).
//
// C-P4: diese Datei hiess "adapter-language-parity" und fuehrte BEIDE Budget-Engine-
// Renderer, weil die vier IDs adapteruebergreifende Aussagen waren ("in BEIDEN
// Adaptern"). Mit dem Twilio-Ausbau hat die PAAR-Aussage keinen Gegenstand mehr - ein
// Paritaetstest mit einem Teilnehmer ist keiner. Die EIGENSCHAFTEN, die die IDs sichern,
// sind aber adapter-unabhaengig und bleiben deshalb hier stehen, jetzt gegen den
// verbliebenen Renderer:
//   VOICE-22 kam aus der geloeschten directive-render.test.js (dort Twilio-Gather) und
//   ist hierher gezogen, statt mit dem Adapter zu verschwinden: die Aussage ist die
//   Sprach-UNABHAENGIGKEIT des STT-Modells, nicht eine Twilio-Eigenheit. telnyx-render.
//   test.js pinnt sie nur je Sprache einzeln (FR/R9, EN/R9) - nicht ueber die Profilmenge.
// Rein offline, pur: kein Env, kein Spawn, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives as renderTelnyx } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, VOICE_PROFILE } from "../src/telephony/directives.js";

// Ein Profilwert, den die Voice-Map NICHT kennt (Platzhalter fuer ein kuenftiges
// en-US-Profil, das jemand zu ergaenzen vergisst).
const UNKNOWN_VOICE_PROFILE = "en-US-female-neural";
// Attributnamen, die ein Sprach-Barge-in am Gather auszeichnen wuerden.
const BARGE_IN_ATTRIBUTE = /barge|interrupt/i;
// Das STT-Modell-Attribut des TeXML-Gather (Wert bewusst nicht gepinnt - hier zaehlt
// NUR, dass ueber alle Sprachen derselbe Wert steht, s. VOICE-22).
const STT_MODEL_ATTRIBUTE = /\bmodel="([^"]+)"/;

const gatherFor = (voiceProfile) =>
  gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1", voiceProfile });

// VOICE-22 (Mechanismus, gruen): das Gather traegt fuer JEDES Voice-Profil dasselbe
// STT-Modell. Die Sprache faerbt die Locale (language="fr-FR"), NICHT die Modellwahl -
// wer beides koppelt, macht diesen Test rot.
test("VOICE-22 (Mechanismus, gruen) - Gather traegt fuer JEDES Voice-Profil dasselbe STT-Modell", () => {
  const models = new Set();
  for (const profile of Object.values(VOICE_PROFILE)) {
    const match = renderTelnyx([gatherFor(profile)]).match(STT_MODEL_ATTRIBUTE);
    assert.ok(match, `${profile}: kein STT-Modell-Attribut im Gather`);
    models.add(match[1]);
  }
  assert.equal(models.size, 1, `STT-Modell variiert mit der Sprache: ${[...models].join(", ")}`);
});

// VOICE-23 (Charakterisierung, gruen): dokumentiert die BEWUSSTE Produktgrenze (Telnyx-
// TeXML-Gather kennt kein bargeIn, nur DTMF) im Kontrast zu VOICE-24 (Barge-in im
// Assistant-Pfad). Ein Treffer hier ist kein Fehler, sondern das Signal, dass die Grenze
// gefallen ist.
test("VOICE-23 (Charakterisierung, gruen) - Budget-Engine setzt fuer keine Sprache ein Barge-in-/Interrupt-Attribut", () => {
  for (const profile of Object.values(VOICE_PROFILE)) {
    const out = renderTelnyx([gatherFor(profile)]);
    assert.doesNotMatch(out, BARGE_IN_ATTRIBUTE, profile);
  }
});

// VOICE-25 (Mechanismus, gruen): verschraenkte DE-/EN-Renderaufrufe faerben sich nicht ab.
// Die dritte Assertion (third === first) ist die eigentliche Leak-Aussage; ohne sie
// testete der Fall nichts (Lehre "gleiche Fixture-Werte testen nichts").
test("VOICE-25 (Mechanismus, gruen) - verschraenkte DE-/EN-Renderaufrufe faerben sich nicht ab", () => {
  const first = renderTelnyx([gatherFor(VOICE_PROFILE.DE_FEMALE_NEURAL)]);
  const second = renderTelnyx([gatherFor(VOICE_PROFILE.EN_FEMALE_NEURAL)]);
  const third = renderTelnyx([gatherFor(VOICE_PROFILE.DE_FEMALE_NEURAL)]);

  assert.match(first, /language="de-DE"/, "erster Aufruf traegt de-DE");
  assert.match(second, /language="en-GB"/, "zweiter Aufruf traegt en-GB");
  assert.doesNotMatch(second, /language="de-DE"/, "zweiter Aufruf leakt kein de-DE");
  assert.equal(third, first, "dritter Aufruf ist byte-identisch zum ersten (kein Leak)");
});

// VOICE-29 (Mechanismus, gruen): die Profilmenge ist VOLLSTAENDIG bedient und ein
// Fremdprofil wirft. Der Wurf-Einzelfall steht auch in telnyx-render.test.js; die
// Aussage HIER ist die Vollstaendigkeit ueber Object.values(VOICE_PROFILE) - sie faengt
// ein neues Profil, das jemand dem Enum, aber nicht der Voice-Map hinzufuegt.
test("VOICE-29 (Mechanismus, gruen) - jedes bekannte Voice-Profil rendert, ein Fremdprofil wirft", () => {
  for (const profile of Object.values(VOICE_PROFILE))
    assert.doesNotThrow(() => renderTelnyx([say("Hallo", profile)]), `${profile} sollte bekannt sein`);

  assert.throws(
    () => renderTelnyx([say("Hallo", UNKNOWN_VOICE_PROFILE)]),
    /unbekanntes voiceProfile/,
    "Fremdprofil muss werfen",
  );
});
