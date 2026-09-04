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
// AUS DEM DATENSATZ, NICHT VOM AUFRUFER (Eigentuemer-Entscheidung 16.08.2026, Punkt 4):
// beide Werte werden aus Mandant und Angerufenem abgeleitet. Es gibt keinen Parameter,
// ueber den ein MCP-Aufrufer sie setzen koennte - place_call fuehrt bewusst KEIN
// Sprachfeld (LANG-15, mcp-tools.js), und diese Naht liest ausschliesslich den
// gespeicherten Zustand. Sonst haette sich jemand ueber einen Umweg doch einen eigenen
// Agenten gebaut.
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
 *                               agent.first_message steht auf der OWNER-Menge
 *                               (convai.js#OVERRIDE_OWNER_ONLY_LEAF_PATHS) und wird
 *                               ausschliesslich bei call.calleeIsOwner === true gesendet
 *                               (elevenlabs/outbound.js#ownerFirstMessage). Fuer jeden
 *                               anderen Anruf bleibt es verboten und der Wortlaut bleibt
 *                               statischer Anbieter-Text. Diese Naht ist die EINE
 *                               Quelle des Wortlauts, gegen die sich das Preset messen
 *                               laesst (test/elevenlabs-sprachwahl.test.js), damit an ihm
 *                               keine zweite, selbst uebersetzte Fassung entsteht.
 *   disclosureOwnerFallback  -> der Ausdruck, der IN diesem Satz an die Stelle des
 *                               Auftraggeber-Namens tritt, wenn keiner vorliegt - in der
 *                               Sprache des Anrufs, nicht in einer anderen.
 *
 * Die Sprache kommt aus dem aufgeloesten LOCALE (locale.language), nicht aus dem rohen
 * Ergebnis von resolveCallLanguage: eine unbekannte/vertippte Spracheinstellung faellt in
 * localeFor fail-safe auf den Weltdefault: Stimme und Offenlegungssatz sind dann englisch,
 * und der Agent bekaeme mit dem rohen Wert eine Sprache, zu der beides nicht passt.
 *
 * VORRANG DES ANGERUFENEN (17.08.2026): laesst sich seine Sprache aus seiner Rufnummer
 * BELEGEN, gewinnt sie - sonst gilt unveraendert die Auftraggeber-Kette. Die Offenlegung
 * muss von der angerufenen Person VERSTANDEN werden, sonst erfuellt sie ihren Zweck nicht
 * (Artikel 50 EU AI Act, Fertig-Punkt 10). Ohne diesen Vorrang haengt der erste Satz an
 * der Herkunft des AUFTRAGGEBERS: gemessen am lokalen Stand haette ein Anruf an eine
 * deutsche Mobilnummer auf FRANZOESISCH begonnen (tenant.defaultLanguage "fr", weil unsere
 * US-Nummer keinen eigenen Sprachanker traegt) - richtig aufgeloest nach der alten Regel
 * und trotzdem der falsche Satz.
 * KEINE ZWEITE KETTE: der Rueckfall ist wortgleich die alte Aufloesung, nur mit einem
 * neuen, hoeher gewichteten EINGANG davor. Bewusst NUR auf dieser Strecke - resolveCall-
 * Language traegt auch den Inbound-Weg, wo es keinen "Angerufenen" in diesem Sinn gibt.
 *
 * @param {object} state Store-Zustand (store.load())
 * @param {{tenantId: string, numberRecord: object|null, ownerName: string|null,
 *   defaultVoiceId: string, to: string|null}} args
 * @returns {{language: string, voiceId: string, firstMessage: string,
 *   disclosureOwnerFallback: string}}
 */
export function callLocaleFor(state, { tenantId, numberRecord, ownerName, defaultVoiceId, to }) {
  const gewaehlt = calleeLanguage(to) || resolveCallLanguage(state, { tenantId, numberRecord });
  const locale = localeFor(gewaehlt);
  return {
    language: locale.language,
    voiceId: elevenLabsVoiceIdFor(defaultVoiceId, locale.voiceProfile),
    firstMessage: providerOpening(locale, ownerName),
    disclosureOwnerFallback: locale.disclosureOwnerFallback,
  };
}
