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
// [abgenommen G2] (frueher ABNAHME-G2, gruen seit 2026-08-17, s.
//   test/abnahme-ausgewandert.json): derselbe Nutzer, ueber den ElevenLabs-Anrufstart
//   gefuehrt, bekommt dasselbe. Die Naht dafuer ist src/elevenlabs/call-locale.js - sie
//   loest die Sprache mit derselben resolveCallLanguage auf wie der Bestandspfad und
//   liefert daraus Sprache, ElevenLabs-Stimme und Offenlegungssatz des Anrufstarts.
//   VORHER war der Weg fest englisch: agent.language stand als Fixwert "en" am Agenten,
//   die Stimme kam ungefragt aus dem Dashboard, und src/elevenlabs/outbound.js verdrahtete
//   den englischen Offenlegungs-Ausdruck fest (DISCLOSURE_OWNER_FALLBACK_EN). Der
//   Weltdefault Englisch war damit nicht umgesetzt, sondern ueberdehnt: er galt fuer jeden,
//   statt nur fuer den, der keine Sprache gesetzt hat. Ab jetzt haelt "npm test" diesen
//   Zustand fest.
//
// KONFIGURATIONSTEST, KEIN ANRUF: kein Netz, kein Konto, keine Attrappe, kein Server.
// Geprueft wird ausschliesslich, was der Anrufstart aus dem gespeicherten Zustand eines
// Tenants ABLEITET - genau die Ebene, auf der die Regel beim Umbau verloren geht.
//
// Testnamen: beide Faelle tragen die Abnahme-Kennung NICHT (der ausgewanderte traegt
// stattdessen sein Siegel) - so laeuft jeder im Regressionslauf und keiner doppelt (Lehre
// catalog-id-prefix-misroutes-tests).
import assert from "node:assert/strict";
import { test } from "node:test";

import { tenantGeoForCountry } from "../src/geo/resolve.js";
import { LOCALES, localeFor } from "../src/i18n/locales.js";
import { resolveCallLanguage } from "../src/store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";

const OWNER_NAME = "Owen Barrett";

// Die global konfigurierte Plattform-Stimme (TELNYX_ELEVENLABS_VOICE_ID) als Testwert.
// SEIT 2026-08-18 hat Deutsch eine EIGENE kuratierte Stimme (s.u.), dieser Wert ist damit
// der Rueckfall fuer ein Profil OHNE eigenen Eintrag. Er bleibt bewusst frei gewaehlt und
// von allen drei Stimm-IDs verschieden: taucht er in einem der drei Faelle auf, ist eine
// kuratierte Stimme verlorengegangen - genau der Defekt, den Anruf 7 hoerbar machte
// (deutsches Gespraech in einer amerikanischen Stimme, weil DE keinen Eintrag hatte).
const PLATFORM_VOICE_ID = "plattform-stimme-test";

const TENANT_DE = "tenant-herkunft-de";
const TENANT_FR = "tenant-einstellung-fr";
const TENANT_OHNE_SPRACHE = "tenant-ohne-sprache";

// Stimmprofile und ElevenLabs-Stimm-Kennungen stehen hier als LITERALE, nicht als Import
// aus LOCALES/ELEVENLABS_VOICE_ID_BY_PROFILE. Beide Seiten aus derselben Quelle zu ziehen
// koennte ein Auseinanderlaufen nicht sehen (dieselbe Begruendung wie beim Werkzeugnamen
// in test/elevenlabs-agent-werkzeuge.test.js). Die IDs sind bindende Eigentuemer-Daten
// (Owner-Entscheidung 2026-08-18, vom Eigentuemer selbst angehoert), kein
// Konfigurationswert. ALLE DREI Sprachen tragen jetzt eine eigene Stimme - Deutsch fiel
// bis dahin auf die Plattform-Stimme zurueck und damit, wenn die nicht gesetzt war, auf
// die Dashboard-Stimme des Agenten.
const VOICE_PROFILE_DE = "de-female-neural";
const VOICE_PROFILE_FR = "fr-female-neural";
const VOICE_PROFILE_EN = "en-female-neural";
const VOICE_ID_DE = "cqPdIo76zSHFDcSZpFov";
const VOICE_ID_FR = "WeAAwKYcS06VmXw086yZ";
const VOICE_ID_EN = "ZSNL4hPqCnqoMPaI4jGX";

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
    voiceId: VOICE_ID_DE,
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

// Die NAHT, die G2 verlangt - hier VOR dem Bau gepinnt, wie R16 die Naht
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

test("[abgenommen G2] der ElevenLabs-Anrufstart spricht die Sprache des Nutzers - Deutsch mit deutscher Stimme und deutschem Offenlegungssatz fuer einen deutschen Nutzer, Franzoesisch analog, Englisch fuer jeden ohne gesetzte Sprache", async () => {
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
    // Seit 18.08.2026 traegt firstMessage die GANZE Eroeffnung (Offenlegung + Bruecke +
    // Frage, s. call-locale.js providerOpening). Was DIESER Fall misst, ist unveraendert:
    // dass der Offenlegungssatz der SPRACHWAHL folgt - deshalb der Anfang, byte-genau.
    // Dass die Eroeffnung als Ganzes zum Code passt, misst T5 (c)/(e) gegen die Vorlage.
    assert.ok(
      gewaehlt?.firstMessage?.startsWith(disclosureFor(kase.language)),
      `Fall "${kase.name}": der Offenlegungssatz kommt WOERTLICH aus ` +
        "LOCALES.<sprache>.disclosure und steht am ANFANG (Regel 2, Artikel 50 EU AI " +
        `Act) - keine am Anbieter erzeugte Uebersetzung, keine zweite Fassung. Bekommen: "${gewaehlt?.firstMessage}"`,
    );
  }
});

// ---- Vorrang des ANGERUFENEN (17.08.2026) --------------------------------------------
// Die Faelle oben messen alle dieselbe Frage: welche Sprache spricht der AUFTRAGGEBER.
// Fertig-Punkt 10 stellt eine andere: in welcher Sprache muss die Offenlegung ANKOMMEN.
// Beide fallen nur zusammen, solange jemand im eigenen Land anruft.
//
// WARUM DIESER FALL EXISTIERT, gemessen und nicht ausgedacht: der lokale Stand traegt
// tenant.defaultLanguage "fr" (Herkunft FR) und eine US-Nummer ohne eigenen Sprachanker.
// Ein Anruf an eine deutsche Mobilnummer haette danach auf FRANZOESISCH begonnen - nach
// der alten Regel voellig richtig aufgeloest und trotzdem der falsche erste Satz.
//
// DREI RICHTUNGEN, weil "gewinnt immer" genauso falsch waere wie "gewinnt nie":
//   (1) belegbares Land des Angerufenen -> es gewinnt, auch gegen eine gesetzte
//       Spracheinstellung des Auftraggebers;
//   (2) NICHT belegbares Land (+1 teilen 25 NANP-Laender) -> die Auftraggeber-Kette gilt
//       unveraendert weiter.
//
// EIN DRITTER FALL WIRD HIER NICHT GEMESSEN, und das ist eine Messung, keine Luecke:
// "Land belegbar, aber ohne Sprachzuordnung" ist heute NICHT ERREICHBAR. Die Vorwahl-
// Tabelle (CALLING_CODE_FOR_COUNTRY, src/store/defaults.js) und die Sprachkarte
// (LANGUAGE_FOR_COUNTRY, src/i18n/locales.js) fuehren exakt dieselben sechs Laender - am
// 2026-08-17 durchprobiert: +49/+33/+44/+41/+43/+353 loesen auf, +39/+34/+31/+48/+46
// liefern schon kein Land. Ein Testfall dafuer waere blind gruen: er kann nicht
// unterscheiden, ob der Rueckfall richtig gebaut ist. Der Guard in call-locale.js liest
// die Sprachkarte trotzdem direkt statt ueber languageForCountry - er ist fuer den Tag
// gebaut, an dem die Tabellen auseinandergehen (ein neues Land in der Vorwahl-Tabelle
// ohne Sprachzuordnung), und genau dann wird der Fall messbar.
const ZIEL_DE = "+491737252163";
const ZIEL_NANP = "+18643028341";

test("Sprachwahl EL: die Sprache des ANGERUFENEN gewinnt, wenn seine Nummer sie belegt - sonst gilt die Auftraggeber-Kette unveraendert", async () => {
  const resolveLocale = await callLocaleSeam();
  // Der Auftraggeber-Fall, gegen den gemessen wird: Spracheinstellung Franzoesisch. Er
  // ist die staerkste Stufe der alten Kette - wer den Vorrang gegen die SCHWAECHSTE
  // Stufe zeigt, hat nichts gezeigt.
  const kase = CASES.find((fall) => fall.language === "fr");
  const locale = (to) =>
    resolveLocale(kase.stateOf(), {
      tenantId: kase.tenantId,
      numberRecord: null,
      ownerName: OWNER_NAME,
      defaultVoiceId: PLATFORM_VOICE_ID,
      to,
    });

  assert.equal(
    locale(ZIEL_DE).language,
    "de",
    "eine deutsche Rufnummer belegt die Sprache des Angerufenen - sie muss die " +
      "franzoesische Spracheinstellung des Auftraggebers ueberstimmen",
  );
  assert.ok(
    locale(ZIEL_DE).firstMessage.startsWith(disclosureFor("de")),
    "der Offenlegungssatz folgt derselben Wahl und steht am Anfang der Eroeffnung - er " +
      "muss vom Angerufenen VERSTANDEN werden (Artikel 50 EU AI Act)",
  );

  assert.equal(
    locale(ZIEL_NANP).language,
    kase.language,
    "+1 teilen 25 Laender: das Land ist NICHT belegbar, also bleibt es bei der " +
      "Auftraggeber-Kette statt bei einer geratenen Sprache",
  );
  assert.equal(
    locale(undefined).language,
    kase.language,
    "ohne Ziel bleibt alles wie vorher - der Bestandsaufruf ohne 'to' ist unveraendert",
  );
});
