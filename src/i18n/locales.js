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
import { DEFAULT_LANGUAGE, DEFAULT_GREETING } from "../store/defaults.js";

// Logische Voice-Profile (Strings) als Forward-Referenz fuer den Telephonie-Renderer
// (Phase 3 mappt sie auf provider-spezifische Voice-Namen Polly/Azure). Im Bundle steht
// nur der LOGISCHE Profilname pro Sprache - kein roher Provider-Voice-Name (zwei Provider,
// ein logisches Profil; directives.js VOICE_PROFILE haelt die kanonischen Enum-Werte).
const VOICE_PROFILE_DE = "de-female-neural";
const VOICE_PROFILE_FR = "fr-female-neural";
const VOICE_PROFILE_EN = "en-female-neural";

// F1 Geo-Location (Phase 5) - OpenAI-Realtime-Felder (NUR VOICE_ENGINE=realtime,
// bridge.js). EIGENER Namensraum, GETRENNT von voiceProfile (Telephonie-TTS Polly/
// Azure) und sttLocale (BCP-47 fuer Provider-Gather): die OpenAI-Realtime-API kennt
// eigene Voice-Namen (alloy/shimmer/...) und Whisper will einen ISO-639-Sprachcode
// (de/fr/en), NICHT das BCP-47. Daher zwei NEUE Felder statt Wiederverwendung -
// dieselbe eine Quelle, nur die richtigen Werte fuer den richtigen Konsumenten.
//
// realtimeVoice fuer DE bewusst null: die Bridge faellt dann auf config.realtimeVoice
// (Env REALTIME_VOICE, Default "alloy") zurueck -> DE byte-identisch zum Bestand und
// Env-uebersteuerbar, statt "alloy" doppelt zu verdrahten. FR/EN tragen eine kuratierte
// OpenAI-Voice (R10 fail-closed: unbekannte Voice lehnt der Provider ab -> Live-Smoke-
// Gate, Produktiv-Flags bleiben aus). DE-whisperLocale bewusst null: das Bestands-
// Verhalten war Auto-Detect (keine language); null -> Bridge laesst language weg ->
// byte-identisch. FR/EN setzen den expliziten ISO-Code (R13, Schutz gegen Sprachmix).
const REALTIME_VOICE_FR = "shimmer";
const REALTIME_VOICE_EN = "alloy";

// Pro Sprache: alle sprachabhaengigen Bausteine. Funktionen dort, wo ein Name/Anliegen
// interpoliert wird (disclosure/bridgePhrase/summarySystem) - der Aufrufer reicht die
// gebundene Identitaet bzw. das Anliegen herein (keine Identitaets-Logik im Bundle).
export const LOCALES = Object.freeze({
  de: Object.freeze({
    language: "de",
    dateLocale: "de-DE", // Date#toLocaleString-Locale (claude.js fmtDate + now)
    sttLocale: "de-DE", // STT BCP-47 (Phase 3: twilio/telnyx Gather-Render)
    voiceProfile: VOICE_PROFILE_DE, // TTS-Voice-Profil (Phase 3: render TTS)
    // OpenAI-Realtime (Phase 5, NUR VOICE_ENGINE=realtime). null -> Bridge nutzt
    // config.realtimeVoice bzw. laesst Whisper-language weg (DE byte-identisch).
    realtimeVoice: null,
    whisperLocale: null,
    // Realtime-Opener (Steuertext fuer response.create). disclosure ist der bereits
    // sprachabhaengige Offenlegungssatz (call-gebunden), als Pflichtsatz eingebettet.
    // DE-Texte BYTE-IDENTISCH zum frueheren bridge.js-Inline-Opener.
    realtimeOpener: {
      outbound: (disclosure) =>
        `Beginne das Gespraech JETZT. Dein erster Satz muss exakt lauten: "${disclosure}" Nenne danach kurz dein Anliegen.`,
      inbound:
        "Der Anrufer ist in der Leitung. Begruesse ihn jetzt entsprechend deiner Anweisungen.",
    },
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
    // Statische Server-Texte (F1 Phase 4): reine Strings (keine Identitaets-Bindung).
    // Quelle: zuvor hart in server.js (Reprompt/Fehler/Hangup) bzw. defaults.js
    // (greetingDefault). DE-Werte BYTE-IDENTISCH zum Bestand uebernommen - ein FR/EN-Pfad
    // faerbt DE nicht ab. greetingDefault = DEFAULT_GREETING (eine Quelle, kein Drift).
    llmDegradedSpeech:
      "Entschuldigung, ich kann Ihr Anliegen gerade nicht bearbeiten. Ich melde mich, sobald es wieder moeglich ist. Auf Wiederhoeren.",
    turnErrorSpeech:
      "Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es spaeter erneut.",
    noSpeechReprompt: "Entschuldigung, koennen Sie das bitte wiederholen?",
    budgetExhaustedHangup: "Das Demo-Budget ist aufgebraucht. Auf Wiederhoeren.",
    greetingDefault: DEFAULT_GREETING,
  }),
  fr: Object.freeze({
    language: "fr",
    dateLocale: "fr-FR",
    sttLocale: "fr-FR",
    voiceProfile: VOICE_PROFILE_FR,
    // OpenAI-Realtime FR (Phase 5): kuratierte Voice + expliziter Whisper-ISO-Code.
    realtimeVoice: REALTIME_VOICE_FR,
    whisperLocale: "fr",
    realtimeOpener: {
      outbound: (disclosure) =>
        `Commence la conversation MAINTENANT. Ta première phrase doit être exactement : "${disclosure}" Indique ensuite brièvement l'objet de ton appel.`,
      inbound: "L'appelant est en ligne. Salue-le maintenant conformément à tes instructions.",
    },
    speechClause: "Réponds exclusivement en français parlé et naturel.",
    bridgePhrase: (goal) => `Je vous appelle car ${goal}.`,
    // FR-Offenlegung (R8): feste, kuratierte Variante - byte-stabil und NICHT per
    // Call-Parameter waehlbar/abschaltbar; nur der ownerName ist gebunden (wie DE).
    disclosure: (ownerName) =>
      `Bonjour, ceci est un assistant IA mandaté par ${ownerName}. Cette conversation sera résumée pour mon mandant.`,
    summarySystem: (owner) =>
      `Tu résumes un appel téléphonique de l'assistant IA de ${owner}. Réponds UNIQUEMENT avec du JSON valide : {"summary": "2-3 phrases en français", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. objective_achieved se rapporte à la mission (pour les appels entrants : si la demande de l'appelant a été résolue). N'ajoute des action items que si ${owner} doit réellement faire quelque chose (max. 3). Les rendez-vous déjà fermement réservés ne sont PAS un action item.`,
    // Statische Server-Texte FR (kuratiert, mit Akzenten fuer korrekte TTS-Aussprache).
    llmDegradedSpeech:
      "Désolé, je ne peux pas traiter votre demande pour le moment. Je vous recontacte dès que possible. Au revoir.",
    turnErrorSpeech: "Désolé, un problème technique est survenu. Veuillez réessayer plus tard.",
    noSpeechReprompt: "Désolé, pouvez-vous répéter, s'il vous plaît ?",
    budgetExhaustedHangup: "Le budget de démonstration est épuisé. Au revoir.",
    // FR-Greeting-Default: {owner} wird zur Laufzeit ersetzt (wie DE). Nur fuer FR-Tenants
    // relevant; der Bestands-/Owner-Tenant traegt weiter den DE-Seed (kein Backfill).
    greetingDefault:
      "Bonjour, vous êtes en relation avec l'assistant IA de {owner}. {owner} n'est pas disponible pour le moment. Je peux prendre un message ou convenir d'un rendez-vous. Comment puis-je vous aider ?",
  }),
  // EN-Bundle (F1 Phase 4, Owner-Entscheidung #1: DE+FR+EN). GB/IE -> en. Voice/STT
  // fail-closed (R9/R10): unbekanntes Profil wirft, kein stiller DE/FR-Fallback. Live-
  // Freischaltung (Polly Amy / Azure Sonia) ist Smoke-Gate, Produktiv-Flags bleiben aus.
  en: Object.freeze({
    language: "en",
    dateLocale: "en-GB",
    sttLocale: "en-GB",
    voiceProfile: VOICE_PROFILE_EN,
    // OpenAI-Realtime EN (Phase 5): kuratierte Voice + expliziter Whisper-ISO-Code.
    realtimeVoice: REALTIME_VOICE_EN,
    whisperLocale: "en",
    realtimeOpener: {
      outbound: (disclosure) =>
        `Start the conversation NOW. Your first sentence must be exactly: "${disclosure}" Then briefly state the reason for your call.`,
      inbound: "The caller is on the line. Greet them now according to your instructions.",
    },
    speechClause: "Reply only in natural, spoken English.",
    bridgePhrase: (goal) => `I'm calling because ${goal}.`,
    // EN-Offenlegung (R8): feste, kuratierte Variante - byte-stabil und NICHT per
    // Call-Parameter waehlbar/abschaltbar; nur der ownerName ist gebunden (wie DE/FR).
    disclosure: (ownerName) =>
      `Hello, this is an AI assistant calling on behalf of ${ownerName}. This conversation will be summarised for the person I represent.`,
    summarySystem: (owner) =>
      `You are summarising a phone call made by ${owner}'s AI assistant. Reply ONLY with valid JSON: {"summary": "2-3 sentences in English", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. objective_achieved refers to the objective (for inbound calls: whether the caller's request was resolved). Only add action items if ${owner} really needs to do something (max. 3). Appointments that are already firmly booked are NOT an action item.`,
    llmDegradedSpeech:
      "Sorry, I can't handle your request right now. I'll get back to you as soon as possible. Goodbye.",
    turnErrorSpeech: "Sorry, a technical problem occurred. Please try again later.",
    noSpeechReprompt: "Sorry, could you please repeat that?",
    budgetExhaustedHangup: "The demo budget has been used up. Goodbye.",
    greetingDefault:
      "Hi, this is the AI assistant of {owner}. {owner} can't take the call right now. I can take a message or arrange an appointment. How can I help?",
  }),
});

// Unterstuetzte Sprach-Codes (Bundle-Schluessel) - fuer Tests/Iteration.
export const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(LOCALES));

// F1 Geo-Location (Phase 6) - Land -> Default-Sprache. DIE eine Quelle, die ein bei der
// Registrierung aufgeloestes/gewaehltes ISO-3166-1-alpha-2-Land auf eine Gespraechs-
// sprache (Bundle-Schluessel) abbildet. Lebt an der i18n-Quelle (nicht in state-ops, das
// config-frei bleibt) und nutzt das vorhandene Sprach-Set (DE/FR/EN). Generisch: eine
// weitere Sprache = ein weiterer Eintrag (Owner #1). Unbekanntes Land -> DEFAULT_LANGUAGE
// (de), NIE Crash (R7) - so faerbt kein unbekanntes Land den DE-Bestand ab.
export const LANGUAGE_FOR_COUNTRY = Object.freeze({
  DE: "de",
  AT: "de",
  CH: "de",
  FR: "fr",
  GB: "en",
  IE: "en",
});

// Land (ISO-2, case-insensitiv) -> Default-Sprache. Fehlend/leer/unbekannt -> de.
export function languageForCountry(country) {
  return LANGUAGE_FOR_COUNTRY[String(country || "").toUpperCase()] || DEFAULT_LANGUAGE;
}

// Resolver: language (z.B. call.language) -> Locale. Fail-safe Fallback auf
// DEFAULT_LANGUAGE (de) bei unbekannter/fehlender/null Sprache (R7). EINE Stelle, die den
// frueher toten Kanal call.language in ein konkretes Locale aufloest.
export function localeFor(language) {
  return LOCALES[language] || LOCALES[DEFAULT_LANGUAGE];
}
