// Sprach-, Stimm- und Offenlegungswahl pro Nutzer - Bestand pinnen, SOLL festnageln.
//
// EIGENTUEMER-VORGABE (bindend): nicht jeder Nutzer bekommt eine amerikanische Stimme.
// Deutscher Nutzer -> deutsches Modell und deutsche Stimme. Franzoesisch analog. Sonst
// Englisch. Diese Logik EXISTIERT BEREITS und laeuft live auf dem Telnyx-Pfad; sie ist
// Bestand, kein Wunsch - und genau die Sorte Regel, die beim Abriss lautlos verschwindet,
// weil sie im neuen Pfad kein Kriterium hat. Diese Datei gibt ihr eines, BEVOR am alten
// Pfad etwas abgerissen wird.
//
// ZWEI BAENKE, zwei Aussagen:
//
// Bestandspfad (Regressionsschutz, "npm test", GRUEN): die Aufloesungskette des heutigen
//   Pfades ist gepinnt - resolveCallLanguage (src/store/state-ops.js, Praezedenz
//   Spracheinstellung > Nummern-Geo > Tenant-Default aus der Herkunft > Weltdefault),
//   daraus das Stimmprofil (LOCALES.<sprache>.voiceProfile), daraus die ElevenLabs-Stimme
//   (elevenLabsVoiceIdFor) und der Offenlegungssatz (LOCALES.<sprache>.disclosure). Wer
//   diese Kette im Zuge des Umbaus entfernt, macht diesen Test rot - das ist der Zweck.
//   Kein Abnahmekriterium: der Zustand gilt heute schon, sein Wegfall waere eine
//   Regression.
//
// ABNAHME-G2 (Abnahmekriterium, "npm run test:abnahme", heute ROT): derselbe Nutzer, ueber
//   den ElevenLabs-Anrufstart gefuehrt, bekommt dasselbe. Heute nicht: der Agent der
//   Vorlage (elevenlabs/agent_configs/outbound-agent.template.json) traegt
//   conversation_config.agent.language als Fixwert "en" - laut ihrem eigenen Vermerk
//   (_sprache_und_datenschutz.sprache) ein AGENTEN-Feld und "NICHT per Anruf umschaltbar";
//   conversation_config.tts.voice_id steht nicht einmal in der Besitz-Liste der Vorlage
//   (_besitz._nicht_besessen: "im Dashboard vom Eigentuemer gewaehlt"); und
//   src/elevenlabs/outbound.js verdrahtet den englischen Offenlegungs-Ausdruck fest
//   (DISCLOSURE_OWNER_FALLBACK_EN) samt englischer Prompt-Bausteine (LOCALES.en.prompt).
//   Der Weltdefault Englisch ist damit NICHT umgesetzt, sondern ueberdehnt: er gilt fuer
//   jeden, statt nur fuer den, der keine Sprache gesetzt hat.
//
// KONFIGURATIONSTEST, KEIN ANRUF: kein Netz, kein Konto, keine Attrappe, kein Server.
// Geprueft wird ausschliesslich, was der Anrufstart aus dem gespeicherten Zustand eines
// Tenants ABLEITET - genau die Ebene, auf der die Regel beim Umbau verloren geht.
//
// Testnamen: das Abnahmekriterium traegt seine Kennung am NAMENSANFANG (package.json
// config.abnahmePattern), der Bestandsfall traegt keine - so laeuft jeder in genau EINER
// Bank (Lehre catalog-id-prefix-misroutes-tests).
import assert from "node:assert/strict";
import { test } from "node:test";

import { tenantGeoForCountry } from "../src/geo/resolve.js";
import { LOCALES, localeFor } from "../src/i18n/locales.js";
import { resolveCallLanguage } from "../src/store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";

const OWNER_NAME = "Owen Barrett";

// Die global konfigurierte Plattform-Stimme (TELNYX_ELEVENLABS_VOICE_ID) als Testwert.
// Sie muss herein statt gelesen zu werden: Deutsch hat in
// ELEVENLABS_VOICE_ID_BY_PROFILE ABSICHTLICH keinen eigenen Eintrag - die deutsche Stimme
// IST die Plattform-Stimme (s. Kommentar dort). Ein frei gewaehlter Wert macht die
// Unterscheidbarkeitspruefung unten zugleich zur Kontrolle, dass Deutsch nicht still auf
// die englische Stimme faellt.
const PLATFORM_VOICE_ID = "plattform-stimme-test";

const TENANT_DE = "tenant-herkunft-de";
const TENANT_FR = "tenant-einstellung-fr";
const TENANT_OHNE_SPRACHE = "tenant-ohne-sprache";

// Stimmprofile und ElevenLabs-Stimm-Kennungen stehen hier als LITERALE, nicht als Import
// aus LOCALES/ELEVENLABS_VOICE_ID_BY_PROFILE. Beide Seiten aus derselben Quelle zu ziehen
// koennte ein Auseinanderlaufen nicht sehen (dieselbe Begruendung wie beim Werkzeugnamen
// in test/elevenlabs-agent-werkzeuge.test.js). Die IDs sind bindende Eigentuemer-Daten
// (Owner-Entscheidung 2026-07-27), kein Konfigurationswert.
const VOICE_PROFILE_DE = "de-female-neural";
const VOICE_PROFILE_FR = "fr-female-neural";
const VOICE_PROFILE_EN = "en-female-neural";
const VOICE_ID_FR = "FFXYdAYPzn8Tw8KiHZqg";
const VOICE_ID_EN = "wOPou4MhRIYEqQHVxjmp";

// Die drei Faelle der Eigentuemer-Vorgabe. Jeder greift eine ANDERE Stufe der
// Praezedenzkette an - drei Faelle, die alle ueber dieselbe Stufe liefen, wuerden die
// Kette nicht vermessen.
//
// Der Zustand kommt je Fall FRISCH aus einer Fabrik: settingsFor(s, tenantId) legt den
// Settings-Bucket lazy an (Bestandsverhalten), ein geteiltes Objekt truege also nach dem
// ersten Fall fremde Spuren.
const CASES = Object.freeze([
  {
    // Stufe "Tenant-Default aus der Herkunft": der Tenant traegt, was der Eintrittspfad
    // aus seinem Land geschrieben hat (tenantGeoForCountry, src/geo/resolve.js). Keine
    // eigene Spracheinstellung, keine Nummer - allein die Herkunft entscheidet.
    name: "Herkunft Deutschland, keine eigene Spracheinstellung",
    tenantId: TENANT_DE,
    stateOf: () => ({
      tenants: [{ id: TENANT_DE, ...tenantGeoForCountry("DE") }],
      settings: {},
    }),
    language: "de",
    voiceProfile: VOICE_PROFILE_DE,
    voiceId: PLATFORM_VOICE_ID,
    disclosureStart: "Guten Tag,",
  },
  {
    // Stufe "Spracheinstellung": sie steht VOR der Herkunft. Deshalb ist die Herkunft hier
    // bewusst US - der Fall belegt, dass die gesetzte Sprache das Land ueberstimmt, statt
    // nur ein zweites Mal dieselbe Stufe zu messen wie oben.
    name: "Spracheinstellung Franzoesisch schlaegt die Herkunft",
    tenantId: TENANT_FR,
    stateOf: () => ({
      tenants: [{ id: TENANT_FR, ...tenantGeoForCountry("US") }],
      settings: { [TENANT_FR]: { language: "fr" } },
    }),
    language: "fr",
    voiceProfile: VOICE_PROFILE_FR,
    voiceId: VOICE_ID_FR,
    disclosureStart: "Bonjour,",
  },
  {
    // Stufe "Weltdefault": nichts gesetzt - keine Spracheinstellung, keine Nummer, kein
    // Tenant-Default. GENAU dieser Fall ist der Geltungsbereich der Englisch-Regel.
    name: "keine Sprache gesetzt",
    tenantId: TENANT_OHNE_SPRACHE,
    stateOf: () => ({ tenants: [{ id: TENANT_OHNE_SPRACHE }], settings: {} }),
    language: "en",
    voiceProfile: VOICE_PROFILE_EN,
    voiceId: VOICE_ID_EN,
    disclosureStart: "Hello,",
  },
]);

// Die Sprache, die der BESTANDSPFAD fuer diesen Fall aufloest - die eine Quelle, gegen die
// beide Baenke messen. numberRecord bleibt weg: keiner der drei Faelle haengt an der
// Nummern-Geo-Stufe.
const bestandsSpracheFor = (kase) =>
  resolveCallLanguage(kase.stateOf(), { tenantId: kase.tenantId, numberRecord: null });

const disclosureFor = (language) => LOCALES[language].disclosure(OWNER_NAME);

function alleZweierPaare(liste) {
  const paare = [];
  for (let idx = 0; idx < liste.length; idx += 1)
    for (let jdx = idx + 1; jdx < liste.length; jdx += 1) paare.push([liste[idx], liste[jdx]]);
  return paare;
}

// Die drei Merkmale muessen sich PAARWEISE unterscheiden, sonst ist jede Pruefung darunter
// wertlos: waere die deutsche Stimme dieselbe wie die englische, bestuende ein Pfad, der
// stur englisch spricht, den Test (Lehre pruefkommando-ohne-positiv-kontrolle).
function assertUnterscheidbar(werteJeFall, merkmal) {
  for (const [links, rechts] of alleZweierPaare(werteJeFall))
    assert.notEqual(
      links.wert,
      rechts.wert,
      `${merkmal} von "${links.name}" und "${rechts.name}" ist derselbe Wert - ` +
        "die Faelle waeren nicht unterscheidbar und jede Pruefung darunter waere blind.",
    );
}

const merkmalJeFall = (lies) => CASES.map((kase) => ({ name: kase.name, wert: lies(kase) }));

test("Bestandspfad Sprachwahl: Herkunft und Spracheinstellung des Nutzers bestimmen Sprache, Stimme und Offenlegungssatz", () => {
  for (const kase of CASES) {
    const language = bestandsSpracheFor(kase);
    assert.equal(language, kase.language, `aufgeloeste Sprache im Fall "${kase.name}"`);

    const locale = localeFor(language);
    assert.equal(locale.voiceProfile, kase.voiceProfile, `Stimmprofil im Fall "${kase.name}"`);
    assert.equal(
      elevenLabsVoiceIdFor(PLATFORM_VOICE_ID, locale.voiceProfile),
      kase.voiceId,
      `ElevenLabs-Stimme im Fall "${kase.name}"`,
    );

    const disclosure = disclosureFor(language);
    assert.ok(
      disclosure.startsWith(kase.disclosureStart),
      `Offenlegungssatz im Fall "${kase.name}" beginnt mit "${kase.disclosureStart}" - ` +
        `er ist in der Sprache des Nutzers, nicht in einer anderen (bekommen: "${disclosure}")`,
    );
    assert.ok(
      disclosure.includes(OWNER_NAME),
      `Offenlegungssatz im Fall "${kase.name}" nennt den Auftraggeber (Artikel 50 EU AI Act)`,
    );
  }

  // Positiv-Kontrolle: die drei Faelle sind in allen drei Merkmalen unterscheidbar.
  assertUnterscheidbar(merkmalJeFall(bestandsSpracheFor), "die Sprache");
  assertUnterscheidbar(
    merkmalJeFall((kase) => elevenLabsVoiceIdFor(PLATFORM_VOICE_ID, kase.voiceProfile)),
    "die ElevenLabs-Stimme",
  );
  assertUnterscheidbar(
    merkmalJeFall((kase) => disclosureFor(kase.language)),
    "der Offenlegungssatz",
  );
});

// Die NAHT, die ABNAHME-G2 verlangt - hier VOR dem Bau gepinnt, wie R16 die Naht
// outboundAgentConfigFor gepinnt hat (test/elevenlabs-agent-werkzeuge.test.js).
//   ORT: src/elevenlabs/ - dort liegt der Anrufstart, der die Werte braucht
//     (outbound.js). Eine zweite Aufloesung in src/telephony/ waere eine zweite Wahrheit.
//   EINGABE: der Store-Zustand und der Tenant, NICHT eine fertige Sprache - sonst haette
//     der neue Pfad eine eigene Praezedenzkette neben resolveCallLanguage, und genau die
//     Doppelung ist der Weg, auf dem die Regel still auseinanderlaeuft. defaultVoiceId
//     kommt herein statt aus config gelesen zu werden (DIP, wie bei elevenLabsVoiceIdFor):
//     Deutsch hat keine eigene ElevenLabs-Kennung, seine Stimme IST die Plattform-Stimme.
//   RUECKGABE: { language, voiceId, firstMessage }. firstMessage heisst wie das Feld des
//     Anbieters, an dem die Offenlegung haengt. Weitere Felder darf die Naht liefern,
//     dieser Test liest nur diese drei.
const SEAM = Object.freeze({
  module: "../src/elevenlabs/call-locale.js",
  export: "callLocaleFor",
});

async function callLocaleSeam() {
  let module;
  try {
    module = await import(SEAM.module);
  } catch {
    module = null;
  }
  const resolve = module?.[SEAM.export];
  assert.equal(
    typeof resolve,
    "function",
    `NOCH NICHT GEBAUT: ${SEAM.module} exportiert ${SEAM.export}(state, ` +
      "{ tenantId, numberRecord, ownerName, defaultVoiceId }) nicht. Solange es die Naht " +
      "nicht gibt, spricht der ElevenLabs-Anrufstart fuer JEDEN Nutzer englisch: " +
      "agent.language ist der Fixwert 'en', die Stimme kommt aus dem Dashboard, und der " +
      "Offenlegungs-Ausdruck steht fest in src/elevenlabs/outbound.js.",
  );
  return resolve;
}

test("ABNAHME-G2: der ElevenLabs-Anrufstart spricht die Sprache des Nutzers - Deutsch mit deutscher Stimme und deutschem Offenlegungssatz fuer einen deutschen Nutzer, Franzoesisch analog, Englisch fuer jeden ohne gesetzte Sprache | ROT WEIL: der ElevenLabs-Pfad kennt keine Sprachwahl - conversation_config.agent.language ist der Fixwert 'en' und laut Vorlage nicht per Anruf umschaltbar, conversation_config.tts.voice_id steht nicht einmal in der Besitz-Liste der Vorlage, und src/elevenlabs/outbound.js verdrahtet den englischen Offenlegungs-Ausdruck fest (DISCLOSURE_OWNER_FALLBACK_EN) - Englisch gilt damit fuer jeden statt nur fuer den ohne gesetzte Sprache | FIX: eine Naht in src/elevenlabs/, die die Sprache mit resolveCallLanguage aufloest wie der Bestandspfad und daraus Sprache, ElevenLabs-Stimme (elevenLabsVoiceIdFor) und Offenlegungssatz (LOCALES.<sprache>.disclosure) des Anrufstarts liefert, plus die Uebergabe an den Anbieter (language_presets bzw. Ueberschreibung je Gespraech)", async () => {
  // 1. Positiv-Kontrolle: der Bestandspfad misst in alle drei Richtungen und ist in allen
  //    drei Merkmalen unterscheidbar. Ohne sie waere ein stur englischer Pfad von einem
  //    richtig aufloesenden nicht zu unterscheiden.
  for (const kase of CASES)
    assert.equal(bestandsSpracheFor(kase), kase.language, `Bestands-Aufloesung "${kase.name}"`);
  assertUnterscheidbar(
    merkmalJeFall((kase) => elevenLabsVoiceIdFor(PLATFORM_VOICE_ID, kase.voiceProfile)),
    "die ElevenLabs-Stimme",
  );
  assertUnterscheidbar(
    merkmalJeFall((kase) => disclosureFor(kase.language)),
    "der Offenlegungssatz",
  );

  // 2. Die eigentliche Pruefung, alle drei Faelle ueber dieselbe Naht.
  const resolveLocale = await callLocaleSeam();
  for (const kase of CASES) {
    const gewaehlt = resolveLocale(kase.stateOf(), {
      tenantId: kase.tenantId,
      numberRecord: null,
      ownerName: OWNER_NAME,
      defaultVoiceId: PLATFORM_VOICE_ID,
    });
    assert.equal(
      gewaehlt?.language,
      kase.language,
      `Fall "${kase.name}": der Agent bekommt die Sprache des Nutzers - sonst hoert ein ` +
        "deutscher Nutzer einen englischen Agenten (und ein US-Nutzer einen deutschen).",
    );
    assert.equal(
      gewaehlt?.voiceId,
      kase.voiceId,
      `Fall "${kase.name}": die Stimme folgt der Sprache (dieselbe Aufloesung wie der ` +
        "Bestandspfad, elevenLabsVoiceIdFor) - sonst spricht der Agent Deutsch mit " +
        "amerikanischer Stimme.",
    );
    assert.equal(
      gewaehlt?.firstMessage,
      disclosureFor(kase.language),
      `Fall "${kase.name}": der Offenlegungssatz kommt WOERTLICH aus ` +
        "LOCALES.<sprache>.disclosure (Regel 2, Artikel 50 EU AI Act) - keine am " +
        "Anbieter erzeugte Uebersetzung, keine zweite Fassung.",
    );
  }
});
