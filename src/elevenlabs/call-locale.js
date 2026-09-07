// ---- Sprache, Stimme und Offenlegung EINES ElevenLabs-Anrufs -------------------------
// Die Naht, die der ElevenLabs-Anrufstart braucht, damit ein deutscher Nutzer einen
// deutsch sprechenden Agenten mit deutscher Stimme und deutschem Offenlegungssatz
// bekommt, ein franzoesischer analog - und JEDER OHNE gesetzte Sprache Englisch. Englisch
// ist der Weltdefault (store/defaults.js DEFAULT_LANGUAGE), nicht die Einheitssprache: ein
// Nutzer aus den USA darf nie etwas Deutsches hoeren, ein Nutzer aus Deutschland nie
// zwangsweise Englisch.
//
// KEINE ZWEITE AUFLOESUNGSREGEL (G5): die Praezedenz kommt UNVERAENDERT aus
// resolveCallLanguage (store/state-ops.js: Spracheinstellung > Nummern-Geo >
// Tenant-Default aus der Herkunft > Weltdefault) - dieselbe Funktion, die der
// Bestandsweg (Telnyx) benutzt und die den Wert an den Call-Datensatz schreibt
// (routes/api-calls.js). Deshalb nimmt diese Naht den STORE-ZUSTAND und den Tenant
// entgegen, NICHT eine fertige Sprache: eine eigene Kette neben resolveCallLanguage waere
// genau der Weg, auf dem die Regel still auseinanderlaeuft.
//
// DER AUFRUFER NENNT DIE GESPRAECHSSPRACHE, NIE DIE OFFENLEGUNGSSPRACHE (F-2,
// 2026-09-06, loest die Regel vom 16.08.2026 ab): place_call fuehrt seit P4a ein
// optionales language-Feld; es entscheidet, in welcher Sprache das GESPRAECH gefuehrt
// wird, und ist am Datensatz aufgeloest (call.language, routes/api-calls.js). In welcher
// Sprache der OFFENLEGUNGSSATZ ankommt, entscheidet weiterhin ausschliesslich der Server
// aus dem Angerufenen - kein Feld, kein Prompt, kein Setting erreicht diese Frage
// (Artikel 50 EU AI Act). Genau deshalb stehen unten ZWEI Funktionen und nicht mehr EIN
// Kurzschluss-ODER: zwei Fragen, die sich eine Zeile teilen, laufen auseinander.
//
// REIN: kein IO, kein config-Import. defaultVoiceId kommt herein statt hier gelesen zu
// werden (DIP, wie bei elevenLabsVoiceIdFor selbst) - Deutsch hat in der Stimmen-Karte
// ABSICHTLICH keinen eigenen Eintrag, seine Stimme IST die global konfigurierte
// Plattform-Stimme.
//
// DE1 (2026-09-04): seit dieser Phase entsteht auf demselben Weg auch der
// Anrufbeantworter-Text (providerVoicemailMessage) - dieselbe Quelle, dieselbe
// Offenlegung zuerst, nur ein anderer Ort am Agenten.
import { LANGUAGE_FOR_COUNTRY, localeFor } from "../i18n/locales.js";
import { countryForE164 } from "../store/defaults.js";
import { resolveCallLanguage } from "../store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../telephony/adapters/telnyx/elevenlabs-voice.js";

// Die Sprache des ANGERUFENEN, aus seiner Rufnummer - oder null, wenn sie sich nicht
// BELEGEN laesst. Fertig-Punkt 10 verlangt die Offenlegung "in der Sprache des
// Angerufenen"; die uebrige Kette (resolveCallLanguage) beantwortet eine andere Frage,
// naemlich die Sprache des AUFTRAGGEBERS - Spracheinstellung, Geo UNSERER Nummer,
// Tenant-Default. Beides faellt nur zusammen, solange jemand im eigenen Land anruft.
//
// NULL IST EINE ANTWORT, keine Panne. countryForE164 liefert fuer +1 bewusst null (25
// NANP-Laender teilen die Vorwahl), und ein Land ohne Eintrag in der Karte ist ebenfalls
// null. Genau deshalb wird HIER die Karte direkt gelesen und nicht languageForCountry
// benutzt: dessen Rueckfall auf den Weltdefault wuerde "Land unbekannt" in ein
// behauptetes "spricht Englisch" verwandeln und die Auftraggeber-Kette ueberstimmen,
// ohne irgendetwas zu wissen.
function calleeLanguage(to) {
  const land = countryForE164(to);
  return (land && LANGUAGE_FOR_COUNTRY[land]) || null;
}

// P4a (F-2 Punkt 2): die Sprache des GESPRAECHS. Sie steht am Anruf-Datensatz
// (call.language) - dort hat routes/api-calls.js Sprachwunsch und resolveCallLanguage
// bereits zu EINEM Wert gemacht. Der Rueckfall ist DIESELBE Auftraggeber-Kette, keine
// zweite Regel; ein Bestandsaufruf ohne callLanguage verhaelt sich unveraendert.
// WAS HIER NICHT MEHR STEHT: calleeLanguage(to). Bis F-2 gewann die aus der Zielnummer
// abgeleitete Sprache deterministisch - ein portugiesischer Auftrag an eine deutsche
// Nummer war damit nicht ausdrueckbar (W5).
function conversationLanguageOf(state, { tenantId, numberRecord, callLanguage }) {
  return callLanguage || resolveCallLanguage(state, { tenantId, numberRecord });
}

// Die Sprache des OFFENLEGUNGSSATZES - WOERTLICH die Kette, die bis P4a beide Fragen
// beantwortet hat: die belegbare Sprache des Angerufenen, sonst die Auftraggeber-Kette.
// Sie bleibt byte-identisch, damit fuer JEDEN Anruf, den es heute gibt, exakt derselbe
// Satz in exakt derselben Sprache herauskommt (E-2). Neu ist allein, dass die
// GESPRAECHSSPRACHE davon abweichen darf.
function disclosureLanguageOf(state, { tenantId, numberRecord, to }) {
  return calleeLanguage(to) || resolveCallLanguage(state, { tenantId, numberRecord });
}

// Der Anrufgrund reist als Platzhalter des ANBIETERS, nicht als Wert: was hier steht, ist
// der STATISCHE Text am fremden Agenten (first_message bzw. language_preset), und einsetzen
// tut ihn der Anbieter zur Laufzeit aus dynamic_variables (src/elevenlabs/outbound.js).
// Unsere Seite rendert ihn NIE - deshalb bleibt er woertlich stehen.
//
// Thema A (2026-08-19): hier stand bis dahin bridgePhrase("{{objective}}") - der ROHE
// Auftragstext im festen Rahmen, UNGEPRUEFT und UNBEGRENZT. Jetzt reist
// {{opening_line}}: die bei Auftragsannahme erzeugte, fail-closed validierte und
// laengenbegrenzte Grund-Zeile (src/elevenlabs/opening-line.js). PRAEZISE (Auflage
// A5): Auftragstext erreicht die Eroeffnung nur noch GEPRUEFT - laengenbegrenzt,
// klammer-/preis-/umbruchfrei (Rueckfall-Stufe 2, wortgleich Anruf 8) - oder als
// natuerliche erzeugte Formulierung; unbegrenzt-roh nie mehr. Eine SEMANTISCHE
// Pruefung des Auftragsinhalts ist das nicht.
const OPENING_LINE_PLACEHOLDER = "{{opening_line}}";

// Die vollstaendige Eroeffnung EINES Outbound-Anrufs, in dieser Reihenfolge:
//   1. der Offenlegungssatz - WOERTLICH und als ALLERERSTES (Absolute Regel 2,
//      Artikel 50 EU AI Act). Er bleibt unveraendert; hier kommt nur etwas dahinter.
//   2. die Grund-Zeile ({{opening_line}}, s. oben) - EIN fertiger Satz, der sagt,
//      worum es geht.
//      Sie endet weiterhin auf GENAU EINE Frage - der Befund aus Anruf 6 (11 s Stille,
//      weil die Offenlegung allein keinen Anlass zum Reden gibt und ein fremder Agent
//      nach first_message den Zug gar nicht hat) bleibt gedeckt. Die Frage reist seit
//      GQ-E1 aber IM WERT statt im Rahmen: nur dort ist entscheidbar, ob sie noch
//      gebraucht wird oder die Zeile schon selbst fragt (opening-line.js,
//      composedOpeningLine). Hinter der Variablen steht deshalb nichts mehr.
const providerOpening = (locale, ownerName) =>
  [locale.disclosure(ownerName), OPENING_LINE_PLACEHOLDER].join(" ");

// Der Auftraggeber-Name als PLATZHALTER - fuer die andere Lesart derselben Eroeffnung.
const OWNER_NAME_PLACEHOLDER = "{{owner_name}}";

/**
 * Dieselbe Eroeffnung, aber in der Form, die als STATISCHER TEXT am fremden Agenten steht:
 * beide Werte bleiben Platzhalter, weil der Anbieter beide selbst einsetzt. Das ist der
 * Wortlaut, gegen den sich `agent.first_message` und jedes `language_preset` der Vorlage
 * messen lassen muessen (test/elevenlabs-anrufstart.test.js) - damit am Agenten keine
 * zweite, von Hand geschriebene Fassung entsteht.
 *
 * @param {string} language Sprachcode; unbekannt -> Weltdefault (localeFor, fail-safe)
 * @returns {string}
 */
export function providerOpeningFor(language) {
  return providerOpening(localeFor(language), OWNER_NAME_PLACEHOLDER);
}

/**
 * Die vollstaendige Anrufbeantworter-Nachricht EINES Anrufs, in der Sprache des Anrufs.
 *
 * DIESELBE REIHENFOLGE UND DIESELBE QUELLE wie providerOpening darueber: der
 * Offenlegungssatz WOERTLICH und als ALLERERSTES (Absolute Regel 2, Artikel 50 EU AI
 * Act - er gilt auch fuer eine Nachricht auf dem Anrufbeantworter), dahinter der
 * sprachliche Rest aus demselben Bundle. Es gibt keine zweite Fassung und keine
 * Uebersetzung: was gesprochen wird, steht in src/i18n/locales.js.
 *
 * WARUM DAS UEBERHAUPT HIER ENTSTEHT (Messung 2026-09-04, DE1): am Agenten liegt dieser
 * Text unter built_in_tools.voicemail_detection.params - ein Pfad, den WEDER ein
 * language_preset NOCH eine conversation_config_override im Anbieter-Schema fuehrt.
 * Beide Uebersteuerungswege scheiden damit aus. Der einzige tragfaehige Weg ist die
 * dynamische Variable: der Anbieter loest sie in genau diesem Feld auf (Schema
 * VoicemailDetectionToolConfig.voicemail_message, "Supports dynamic variables"), und
 * live tut er es bereits fuer {{owner_name}}/{{opening_line}}.
 *
 * @param {{locale: object, ownerName: string, openingLine: string}} args
 * @returns {string}
 */
export function providerVoicemailMessage({ locale, ownerName, openingLine }) {
  return [locale.disclosure(ownerName), locale.voicemailBody(openingLine)].join(" ");
}

/**
 * Sprache, Stimme und Offenlegungssatz EINES Anrufs, abgeleitet aus dem gespeicherten
 * Zustand. Vier Rueckgabewerte, jeder mit genau einem Abnehmer im Anrufstart
 * (src/elevenlabs/outbound.js):
 *   language                 -> conversation_config_override.agent.language
 *   voiceId                  -> conversation_config_override.tts.voice_id (leer, wenn
 *                               keine Plattform-Stimme konfiguriert ist - dann bleibt die
 *                               am Agenten gewaehlte Stimme stehen, s. dort)
 *   firstMessage             -> die GANZE Eroeffnung, die der Agent des Anbieters als
 *                               ALLERERSTES spricht - beginnend mit dem Offenlegungssatz
 *                               (Absolute Regel 2, Artikel 50 EU AI Act), s.
 *                               providerOpening oben.
 *                               Er ist Agenten-Konfiguration, kein Anruf-Parameter: der
 *                               Traeger je Sprache ist das language_preset am Agenten.
 *                               SEIT OC-P2 mit GENAU EINER Ausnahme:
 *                               agent.first_message steht auf der OWNER-Menge, seit P4a
 *                               erweitert um die Abweichungs-Lage (convai.js
 *                               #OVERRIDE_FIRST_MESSAGE_LEAF_PATHS) und wird
 *                               ausschliesslich bei call.calleeIsOwner === true ODER bei
 *                               abweichender Gespraechs-/Offenlegungssprache gesendet
 *                               (elevenlabs/outbound.js#perCallFirstMessage). Fuer jeden
 *                               anderen Anruf bleibt es verboten und der Wortlaut bleibt
 *                               statischer Anbieter-Text. Diese Naht ist die EINE
 *                               Quelle des Wortlauts, gegen die sich das Preset messen
 *                               laesst (test/elevenlabs-sprachwahl.test.js), damit an ihm
 *                               keine zweite, selbst uebersetzte Fassung entsteht.
 *   disclosureOwnerFallback  -> der Ausdruck, der IN diesem Satz an die Stelle des
 *                               Auftraggeber-Namens tritt, wenn keiner vorliegt - in der
 *                               OFFENLEGUNGSsprache, nicht in der Gespraechssprache.
 *
 * Die Sprachen kommen aus den aufgeloesten LOCALES (locale.language), nicht aus dem
 * rohen Ergebnis der Ketten: eine unbekannte/vertippte Spracheinstellung faellt in
 * localeFor fail-safe auf den Weltdefault: Stimme und Offenlegungssatz sind dann englisch,
 * und der Agent bekaeme mit dem rohen Wert eine Sprache, zu der beides nicht passt.
 *
 * VORRANG DES ANGERUFENEN gilt fuer die OFFENLEGUNG (17.08.2026, seit P4a auf
 * disclosureLanguageOf konzentriert): laesst sich seine Sprache aus seiner Rufnummer
 * BELEGEN, gewinnt sie fuer den Pflichtsatz - sonst gilt unveraendert die
 * Auftraggeber-Kette. Die Offenlegung muss von der angerufenen Person VERSTANDEN werden,
 * sonst erfuellt sie ihren Zweck nicht (Artikel 50 EU AI Act, Fertig-Punkt 10). Die
 * GESPRAECHSSPRACHE (conversationLanguageOf) folgt seit P4a stattdessen dem Sprachwunsch
 * des Auftraggebers, sonst derselben Auftraggeber-Kette (F-2 Punkt 2).
 * KEINE ZWEITE KETTE: resolveCallLanguage traegt beide Funktionen als gemeinsamen
 * Rueckfall - bewusst NUR auf dieser Strecke, resolveCallLanguage selbst traegt auch den
 * Inbound-Weg, wo es keinen "Angerufenen" in diesem Sinn gibt.
 *
 * @param {object} state Store-Zustand (store.load())
 * @param {{tenantId: string, numberRecord: object|null, ownerName: string|null,
 *   defaultVoiceId: string, to: string|null, callLanguage?: string|null}} args
 * @returns {{language: string, disclosureLanguage: string, voiceId: string,
 *   firstMessage: string, disclosureOwnerFallback: string}}
 */
export function callLocaleFor(
  state,
  { tenantId, numberRecord, ownerName, defaultVoiceId, to, callLanguage },
) {
  const gespraech = localeFor(conversationLanguageOf(state, { tenantId, numberRecord, callLanguage }));
  const offenlegung = localeFor(disclosureLanguageOf(state, { tenantId, numberRecord, to }));
  return {
    language: gespraech.language,
    disclosureLanguage: offenlegung.language,
    // Die Stimme folgt dem GESPRAECH: sie spricht die restlichen Minuten, nicht den
    // ersten Satz. Die Stimmen sind mehrsprachig, die Sprache des Pflichtsatzes ist es
    // nicht - deshalb faellt die Trennung genau hier und nicht bei der Stimme.
    voiceId: elevenLabsVoiceIdFor(defaultVoiceId, gespraech.voiceProfile),
    // Die Eroeffnung beginnt IMMER mit dem Pflichtsatz in der Sprache des ANGERUFENEN
    // (E-1/E-2) - unveraendert zum Bestand, auch wenn das Gespraech danach eine andere
    // Sprache spricht.
    firstMessage: providerOpening(offenlegung, ownerName),
    // Der Ausdruck tritt IN diesen Satz an die Stelle des Namens - also dieselbe Sprache
    // wie der Satz, nie die des Gespraechs.
    disclosureOwnerFallback: offenlegung.disclosureOwnerFallback,
  };
}
