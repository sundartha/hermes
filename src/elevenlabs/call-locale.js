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

/**
 * Sprache, Stimme und Offenlegungssatz EINES Anrufs, abgeleitet aus dem gespeicherten
 * Zustand. Vier Rueckgabewerte, jeder mit genau einem Abnehmer im Anrufstart
 * (src/elevenlabs/outbound.js):
 *   language                 -> conversation_config_override.agent.language
 *   voiceId                  -> conversation_config_override.tts.voice_id (leer, wenn
 *                               keine Plattform-Stimme konfiguriert ist - dann bleibt die
 *                               am Agenten gewaehlte Stimme stehen, s. dort)
 *   firstMessage             -> der Satz, den der Agent des Anbieters als ALLERERSTES
 *                               sprechen muss (Absolute Regel 2, Artikel 50 EU AI Act).
 *                               Er ist Agenten-Konfiguration, kein Anruf-Parameter:
 *                               agent.first_message steht NICHT auf der weissen Liste
 *                               (convai.js) und darf es nicht - der Traeger je Sprache ist
 *                               das language_preset am Agenten. Diese Naht ist die EINE
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
    firstMessage: locale.disclosure(ownerName),
    disclosureOwnerFallback: locale.disclosureOwnerFallback,
  };
}
