// F1 Geo-Location (Phase 2) - Locale-Bundle: language -> sprachabhaengige Strings.
// DER einzige Ort, an dem Sprach-Strings leben (Strategie docs/strategy/f1-geo-location.md
// §2.3). claude.js (LLM-Schicht) konsumiert System-Prompt-/Offenlegungs-/Summary-Teile
// pro Sprache; der Telephonie-Renderer (Phase 3) konsumiert sttLocale + voiceProfile aus
// DEMSELBEN Bundle (eine Quelle, kein Drift). Der Resolver localeFor() faellt fail-safe
// auf DEFAULT_LANGUAGE (de) zurueck, wenn call.language unbekannt/fehlend ist (R7,
// heutiges Verhalten) - so faerbt kein FR-Pfad den DE-Bestand ab.
//
// Konvention: Deutsche gesprochene/geschriebene Strings bleiben ASCII-transliteriert
// (ue/ae/oe/ss) und byte-identisch zum Bestand (claude.js vorher). Franzoesische Strings
// tragen BEWUSST die korrekten Akzente (UTF-8): franzoesische TTS-Stimmen (Polly/Azure,
// Phase 3) brauchen die Akzente fuer die richtige Aussprache ("resume" != "résumé"). Die
// Render-Pfade sind UTF-8 (TeXML <?xml encoding="UTF-8"?>, Twilio-SDK); Akzente sind keine
// XML-Sonderzeichen und passieren die Escaper unveraendert.
import { DEFAULT_LANGUAGE } from "../store/defaults.js";

// Logische Voice-Profile (Strings) als Forward-Referenz fuer den Telephonie-Renderer
// (Phase 3 mappt sie auf provider-spezifische Voice-Namen Polly/Azure). Im Bundle steht
// nur der LOGISCHE Profilname pro Sprache - kein roher Provider-Voice-Name (zwei Provider,
// ein logisches Profil; directives.js VOICE_PROFILE haelt die kanonischen Enum-Werte).
const VOICE_PROFILE_DE = "de-female-neural";
const VOICE_PROFILE_FR = "fr-female-neural";

// Pro Sprache: alle sprachabhaengigen Bausteine. Funktionen dort, wo ein Name/Anliegen
// interpoliert wird (disclosure/bridgePhrase/summarySystem) - der Aufrufer reicht die
// gebundene Identitaet bzw. das Anliegen herein (keine Identitaets-Logik im Bundle).
export const LOCALES = Object.freeze({
  de: Object.freeze({
    language: "de",
    dateLocale: "de-DE", // Date#toLocaleString-Locale (claude.js fmtDate + now)
    sttLocale: "de-DE", // STT BCP-47 (Phase 3: twilio/telnyx Gather-Render)
    voiceProfile: VOICE_PROFILE_DE, // TTS-Voice-Profil (Phase 3: render TTS)
    // System-Prompt-Sprach-Teil: die Output-Sprach-Regel in Regel 1 (claude.js).
    speechClause: "Nur natuerlich gesprochenes Deutsch.",
    // Outbound-Bruecke (claude.js openingText): nach der Offenlegung gesprochen.
    bridgePhrase: (goal) => `Ich rufe an, weil ${goal}.`,
    // Pflicht-Offenlegung (CLAUDE.md Regel 2): fest verdrahtet, byte-stabil, nur der
    // ownerName ist gebunden (nicht per Call-Parameter waehlbar/abschaltbar).
    disclosure: (ownerName) =>
      `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${ownerName}. Das Gespraech wird fuer meinen Auftraggeber zusammengefasst.`,
    // Zusammenfassungs-Prompt-Sprach-Teil (claude.js summarizeCall). Die JSON-Keys
    // bleiben englisch (sie werden geparst); nur der menschliche Text ist sprachabhaengig.
    summarySystem: (owner) =>
      `Du fasst ein Telefonat des KI-Assistenten von ${owner} zusammen. Antworte NUR mit validem JSON: {"summary": "2-3 Saetze auf Deutsch", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. objective_achieved bezieht sich auf den Auftrag (bei Inbound-Calls: ob das Anliegen des Anrufers geloest wurde). Action Items nur, wenn ${owner} wirklich etwas tun muss (max. 3). Bereits fest gebuchte Termine sind KEIN Action Item.`,
  }),
  fr: Object.freeze({
    language: "fr",
    dateLocale: "fr-FR",
    sttLocale: "fr-FR",
    voiceProfile: VOICE_PROFILE_FR,
    speechClause: "Réponds exclusivement en français parlé et naturel.",
    bridgePhrase: (goal) => `Je vous appelle car ${goal}.`,
    // FR-Offenlegung (R8): feste, kuratierte Variante - byte-stabil und NICHT per
    // Call-Parameter waehlbar/abschaltbar; nur der ownerName ist gebunden (wie DE).
    disclosure: (ownerName) =>
      `Bonjour, ceci est un assistant IA mandaté par ${ownerName}. Cette conversation sera résumée pour mon mandant.`,
    summarySystem: (owner) =>
      `Tu résumes un appel téléphonique de l'assistant IA de ${owner}. Réponds UNIQUEMENT avec du JSON valide : {"summary": "2-3 phrases en français", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. objective_achieved se rapporte à la mission (pour les appels entrants : si la demande de l'appelant a été résolue). N'ajoute des action items que si ${owner} doit réellement faire quelque chose (max. 3). Les rendez-vous déjà fermement réservés ne sont PAS un action item.`,
  }),
});

// Unterstuetzte Sprach-Codes (Bundle-Schluessel) - fuer Tests/Iteration.
export const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(LOCALES));

// Resolver: language (z.B. call.language) -> Locale. Fail-safe Fallback auf
// DEFAULT_LANGUAGE (de) bei unbekannter/fehlender/null Sprache (R7). EINE Stelle, die den
// frueher toten Kanal call.language in ein konkretes Locale aufloest.
export function localeFor(language) {
  return LOCALES[language] || LOCALES[DEFAULT_LANGUAGE];
}
