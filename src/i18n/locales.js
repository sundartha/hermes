// F1 Geo-Location (Phase 2) - Locale-Bundle: language -> sprachabhaengige Strings.
// DER einzige Ort, an dem Sprach-Strings leben (Strategie docs/strategy/f1-geo-location.md
// §2.3). claude.js (LLM-Schicht) konsumiert System-Prompt-/Offenlegungs-/Summary-Teile
// pro Sprache; der Telephonie-Renderer (Phase 3) konsumiert sttLocale + voiceProfile aus
// DEMSELBEN Bundle (eine Quelle, kein Drift). Der Resolver localeFor() faellt fail-safe
// auf DEFAULT_LANGUAGE (Weltdefault, P10) zurueck, wenn call.language unbekannt/fehlend
// ist (R7) - so faerbt kein FR-Pfad den DE-Bestand ab.
//
// Konvention: Deutsche GESPROCHENE Strings tragen die korrekten Umlaute (UTF-8) - aus
// demselben Grund wie die franzoesischen Akzente: die TTS-Stimme (Azure/Polly) liest
// "Gespraech" als Buchstabenfolge, nicht als deutsches Wort. NICHT zurueck-
// transliterieren. Kein Sonderfall fuer ss/sz: "ss" ist orthografisch gueltig und wird
// korrekt gelesen, "ue/oe/ae" als Umlautersatz ist es nicht. Ausgenommen und bewusst
// transliteriert bleiben Strings, die NIE gesprochen werden: realtimeOpener (Steuertext
// fuer response.create) und summarySystem (LLM-Prompt, dessen Output als JSON geparst
// wird) - siehe test/de-umlaut-orthography.test.js, das diese Grenze festhaelt.
// Franzoesische Strings tragen ebenfalls die korrekten Akzente ("resume" != "résumé").
// Die Render-Pfade sind UTF-8 (TeXML <?xml encoding="UTF-8"?>, Twilio-SDK); Umlaute und
// Akzente sind keine XML-Sonderzeichen und passieren die Escaper unveraendert.
// P5 (PLAN-CONVERSATION-QUALITY-V2): die Prompt-Bausteine dieses Bundles (speechClause,
// STYLE_CLAUSES_DE) tragen seit P5 ebenfalls korrekte Umlaute - sie fliessen in den von
// claude.js zusammengesetzten Systemprompt, der nie gesprochen, aber vom Modell gelesen
// wird (Priming-These). realtimeOpener und summarySystem bleiben ausdruecklich
// transliteriert (siehe P1-U3 oben), sie sind kein Prompt-Baustein im P5-Sinn.
// KOMMENTARE bleiben ASCII (Repo-Konvention) - nur die Strings aendern sich.
import { DEFAULT_LANGUAGE, DEFAULT_GREETING } from "../store/defaults.js";
import { INBOUND_NOTICES } from "./inbound-notice.js";
import { PROMPT_DE } from "./prompts/de.js";
import { PROMPT_FR } from "./prompts/fr.js";
import { PROMPT_EN } from "./prompts/en.js";
import { MCP_TEXTS } from "./mcp-texts.js";
import { GATE_TEXTS } from "./gate-texts.js";

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
// realtimeVoice fuer DE bewusst null: die Bridge faellt dann auf config.voice.realtimeVoice
// (Env REALTIME_VOICE, Default "alloy") zurueck -> DE byte-identisch zum Bestand und
// Env-uebersteuerbar, statt "alloy" doppelt zu verdrahten. FR/EN tragen eine kuratierte
// OpenAI-Voice (R10 fail-closed: unbekannte Voice lehnt der Provider ab -> Live-Smoke-
// Gate, Produktiv-Flags bleiben aus). DE-whisperLocale bewusst null: das Bestands-
// Verhalten war Auto-Detect (keine language); null -> Bridge laesst language weg ->
// byte-identisch. FR/EN setzen den expliziten ISO-Code (R13, Schutz gegen Sprachmix).
const REALTIME_VOICE_FR = "shimmer";
const REALTIME_VOICE_EN = "alloy";

// ---- Persona-Stil-Katalog (P2, PLAN-PERSONAL-ASSISTANT.md) ----
// Kuratiertes NON-PII-Enum (Owner-Entscheidung 6.1): GENAU ZWEI IDs, kein "kurz-direkt".
// DIE eine Quelle der gueltigen Stil-IDs - updateSettings (state-ops) validiert fail-closed
// gegen diese Liste, damit Freitext/Impersonation NICHT ins agentStyle-Feld gelangt
// (Leitplanke 6/H4, Pre-Mortem 1/2). null (Default) ist KEINE ID -> neutrales Bestands-
// verhalten (Siezen). styleClause faerbt AUSSCHLIESSLICH Ton + Anrede; Laenge (1-2 Saetze),
// hoechstens eine Frage und end_call bleiben FIX (sie liegen ausserhalb des Katalogs).
export const PERSONA_STYLE_IDS = Object.freeze(["warm-persoenlich", "formell-professionell"]);

// Neutral-Anrede = die frueher hart in claude.js stehende Siez-Anweisung, jetzt PRO
// SPRACHE (P11: das Prompt-Geruest ist nicht mehr in jeder Sprache deutsch). DE bleibt
// byte-identisch zum Bestand. styleClause(null|unbekannt) faellt auf die jeweilige
// Sprach-Klausel zurueck -> agentStyle=null byte-identisch je Sprache.
const NEUTRAL_ADDRESS_CLAUSE_DE = "Sieze fremde Anrufer.";
const NEUTRAL_ADDRESS_CLAUSE_FR = "Vouvoie les interlocuteurs que tu ne connais pas.";
const NEUTRAL_ADDRESS_CLAUSE_EN = "Address unfamiliar callers politely.";

// Pro Sprache: Stil-ID -> kuratierte Klausel (Ton + Anrede). Modul-Konstanten analog
// VOICE_PROFILE_* (Forward-Referenz fuer die Locale-Objekte). FR/EN sind kuratiert/
// byte-stabil (R8). Ein fehlender Key faellt in styleClause auf NEUTRAL zurueck; der
// Vollstaendigkeits-Test (persona-style.test.js) faengt Drift gegen PERSONA_STYLE_IDS.
const STYLE_CLAUSES_DE = Object.freeze({
  "warm-persoenlich": "Triff einen warmen, persönlichen Ton und duze den Anrufer.",
  "formell-professionell": "Triff einen formellen, sachlichen Ton und sieze den Anrufer.",
});
const STYLE_CLAUSES_FR = Object.freeze({
  "warm-persoenlich": "Adopte un ton chaleureux et personnel et tutoie ton interlocuteur.",
  "formell-professionell": "Adopte un ton formel et neutre et vouvoie ton interlocuteur.",
});
const STYLE_CLAUSES_EN = Object.freeze({
  "warm-persoenlich": "Use a warm, personal tone and address the other person informally.",
  "formell-professionell": "Use a formal, neutral tone and address the other person politely.",
});

// EINE Quelle (G5) fuer die drei styleClause-Lookups: Stil-Id -> Klausel, unbekannt/null
// -> die sprachspezifische Neutral-Klausel (P11). Faktorei statt drei woertlich
// gleicher Lambdas; der Anti-Injection-Pfad (nur bekannte Keys ODER NEUTRAL) bleibt exakt.
function makeStyleClause(clauses, neutralClause) {
  return (styleId) => clauses[styleId] || neutralClause;
}

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
    // config.voice.realtimeVoice bzw. laesst Whisper-language weg (DE byte-identisch).
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
    speechClause: "Nur natürlich gesprochenes Deutsch.",
    // Persona-Stil (P2): Stil-ID -> Ton-/Anrede-Klausel, ersetzt die fixe Siez-Anweisung
    // an Ort und Stelle (claude.js, gleiche Zeile). Unbekannt/null -> NEUTRAL (Siezen) =>
    // agentStyle=null byte-identisch. KEIN Freitext erreicht je den Prompt (nur Katalog-
    // Werte oder NEUTRAL) -> Anti-Injection (Pre-Mortem 1), staerker als der typeof-Pfad.
    styleClause: makeStyleClause(STYLE_CLAUSES_DE, NEUTRAL_ADDRESS_CLAUSE_DE),
    // Outbound-Bruecke (claude.js openingText): nach der Offenlegung gesprochen.
    // Ich-Satz-Passthrough (Runde 2, S-B): ein bereits sprechbarer Ich-Satz (neue
    // place_call-objective-Description) wird woertlich gesprochen - keine Bruecke.
    // Sonst objective-neutrale Bruecke (C2), grammatisch sicher fuer Imperativ/
    // Infinitiv/Nominalphrase-Auftraege; "wegen folgendem Anliegen" war Amtsdeutsch.
    bridgePhrase: (goal) =>
      /^ich\b/i.test(goal) ? `${goal}.` : `Es geht um Folgendes: ${goal}.`,
    // Pflicht-Offenlegung (CLAUDE.md Regel 2): fest verdrahtet, byte-stabil, nur der
    // ownerName ist gebunden (nicht per Call-Parameter waehlbar/abschaltbar).
    disclosure: (ownerName) =>
      `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${ownerName}. Das Gespräch wird für meinen Auftraggeber zusammengefasst.`,
    // Zusammenfassungs-Prompt-Sprach-Teil (claude.js summarizeCall). Die JSON-Keys
    // bleiben englisch (sie werden geparst); nur der menschliche Text ist sprachabhaengig.
    summarySystem: (owner) =>
      `Du fasst ein Telefonat des KI-Assistenten von ${owner} zusammen. Antworte NUR mit validem JSON: {"summary": "2-3 Saetze auf Deutsch", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. Nenne in der summary konkrete Ergebnisse (vereinbartes Datum/Uhrzeit, Preis, Name der Kontaktperson), sofern im Transkript vorhanden, statt allgemeiner Umschreibungen. objective_achieved bewertet AUSSCHLIESSLICH den unter "Auftrag" genannten urspruenglichen Auftrag (bei Inbound-Calls: ob das Anliegen des Anrufers geloest wurde). Vom Assistenten oder Angerufenen selbst eroeffnete Nebenthemen (z.B. ein angebotener oder abgebrochener Termin-Folgeschritt) sind fuer diese Bewertung IRRELEVANT. true = der Auftrag wurde genug beantwortet, auch wenn der Anruf mitten in einem Folgeschritt endete; false = der Auftrag wurde klar nicht erreicht; "unclear" = aus dem Auftrag heraus echt nicht beurteilbar. Action Items nur, wenn ${owner} wirklich etwas tun muss (max. 3). Bereits fest gebuchte Termine sind KEIN Action Item.`,
    // Statische Server-Texte (F1 Phase 4): reine Strings (keine Identitaets-Bindung).
    // Quelle: zuvor hart in server.js (Reprompt/Fehler/Hangup) bzw. defaults.js
    // (greetingDefault). DE-Werte tragen seit P1 korrekte Umlaute - ein FR/EN-Pfad
    // faerbt DE nicht ab. greetingDefault = DEFAULT_GREETING (eine Quelle, kein Drift).
    llmDegradedSpeech:
      "Entschuldigung, ich kann Ihr Anliegen gerade nicht bearbeiten. Ich melde mich, sobald es wieder möglich ist. Auf Wiederhören.",
    turnErrorSpeech:
      "Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es später erneut.",
    noSpeechReprompt: "Können Sie das bitte wiederholen?",
    // P3.2: zweite Stufe der No-Speech-Staffel (nach dem zweiten leeren Gather) - deutlicher
    // als die knappe Rueckfrage, aber noch keine Beendigung.
    noSpeechRepromptAgain: "Ich höre Sie leider immer noch nicht. Sind Sie noch in der Leitung?",
    // P3.2: dritte Stufe - wuerdevoller Ausstieg statt Endlosschleife bis zum stillen Cap.
    noSpeechFarewell:
      "Ich kann Sie leider nicht hören. Ich versuche es später noch einmal. Auf Wiederhören.",
    // P3.1: deterministischer Abschluss-Satz kurz vor dem harten Max-Dauer-Cap. KEIN
    // LLM-Text - er muss auch dann kommen, wenn das Modell gerade klemmt.
    capFarewellSpeech:
      "Ich muss das Gespräch jetzt leider beenden. Vielen Dank für Ihre Zeit. Auf Wiederhören.",
    budgetExhaustedHangup: "Das Demo-Budget ist aufgebraucht. Auf Wiederhören.",
    greetingDefault: DEFAULT_GREETING,
    // Inbound-Pflichtsatz (GAP-14/O7): fest verdrahtet, durch kein Setting abschaltbar.
    // GETRENNT von disclosure() (Outbound, Regel 2) - beide Achsen bleiben unabhaengig.
    inboundNotice: INBOUND_NOTICES.de,
    // MCP-Textkanal (P12): Rollen-Praefixe + Fehlertexte der MCP-Tool-Schicht. Aus
    // i18n/mcp-texts.js, weil sie NIE gesprochen werden (DE bleibt transliteriert,
    // s. dort) - eingehaengt, damit localeFor() der EINE Resolver bleibt (G5).
    mcp: MCP_TEXTS.de,
    // Outbound-Gate-Ablehnungstexte (P15/T2): NUR die Anzeige. Der Ablehnungsgrund
    // (grund/status/Audit) bleibt sprachfrei in telephony/outbound-gates.js.
    gates: GATE_TEXTS.de,
    // Kuratierte Zusatz-Vorlagen NEBEN greetingDefault (Self-Service-Dropdown, kein
    // Freitext). Der Pflichtsatz wird beim Katalogbau vorangestellt, nicht hier doppelt
    // gepflegt (G5). DE-Wortlaut byte-identisch zu den frueheren GREETING_TEMPLATES[1..2].
    greetingVariants: Object.freeze([
      "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht fuer {owner} auf. Wie kann ich helfen?",
      "Hallo! Der KI-Assistent von {owner} hier. Wie kann ich Ihnen weiterhelfen?",
    ]),
    // I2 (call-quality Impl-1): Turn-Fallback-Satz (claude.js agentTurn), falls das
    // Modell in allen 4 Tool-Loop-Runden KEINEN Text liefert. Vorher hart deutsch +
    // richtungsverkehrt (die Inbound-Formulierung "vielen Dank fuer Ihren Anruf" ging
    // faelschlich auch bei Outbound-Calls raus). JETZT richtungsabhaengig UND
    // sprachabhaengig. DE-inbound weiter gepinnt, seit P1 mit korrekten Umlauten (siehe
    // personal-assistant-characterization/turn-fallback-locale-Tests).
    turnFallbackSpeech: {
      inbound: "Alles klar, vielen Dank für Ihren Anruf. Auf Wiederhören!",
      outbound: "Alles klar, vielen Dank für Ihre Zeit. Auf Wiederhören!",
    },
    // P11: Modell-Text (Systemprompt-Geruest, Tool-Beschreibungen, Steuer-Marker) - s.
    // i18n/prompts/. Wird nie gesprochen. bridge.js-Suffix liegt in prompt.realtimeSpeechStyle
    // (nicht hier doppelt).
    prompt: PROMPT_DE,
    // Nutzer-sichtbare Post-Call-Texte (Notification + Summary-SMS), NIE gesprochen (WEB-14).
    postCall: Object.freeze({
      cancelledTitle: "Anruf abgebrochen",
      failedTitle: "Anruf nicht zustande gekommen",
      statusBody: (target, status) => `${target} (Status: ${status})`,
      summaryTitle: "Neue Call Summary",
      subjectOutbound: (to) => `Anruf bei ${to}`,
      subjectInbound: (from) => `Anruf von ${from}`,
      actionItemsHeading: "Action Items:",
    }),
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
    styleClause: makeStyleClause(STYLE_CLAUSES_FR, NEUTRAL_ADDRESS_CLAUSE_FR),
    // Ich-Satz-Passthrough wie DE (je/j'); sonst kuratierte, natuerlichere Bruecke.
    bridgePhrase: (goal) =>
      /^(je\b|j')/i.test(goal) ? `${goal}.` : `Voici l'objet de mon appel : ${goal}.`,
    // FR-Offenlegung (R8): feste, kuratierte Variante - byte-stabil und NICHT per
    // Call-Parameter waehlbar/abschaltbar; nur der ownerName ist gebunden (wie DE).
    disclosure: (ownerName) =>
      `Bonjour, ceci est un assistant IA mandaté par ${ownerName}. Cette conversation sera résumée pour mon mandant.`,
    summarySystem: (owner) =>
      `Tu résumes un appel téléphonique de l'assistant IA de ${owner}. Réponds UNIQUEMENT avec du JSON valide : {"summary": "2-3 phrases en français", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. Mentionne dans le résumé des résultats concrets (date/heure convenue, prix, nom de la personne de contact), si le transcript les contient, plutôt que des formulations générales. objective_achieved évalue EXCLUSIVEMENT la mission initiale (pour les appels entrants : si la demande de l'appelant a été résolue). Les sujets annexes ouverts par l'assistant ou l'interlocuteur lui-même (par ex. une prise de rendez-vous proposée ou interrompue) sont SANS PERTINENCE pour cette évaluation. true = la mission a été suffisamment traitée, même si l'appel s'est terminé au milieu d'une étape de suivi ; false = la mission n'a clairement pas été atteinte ; "unclear" = réellement impossible à juger à partir de la mission. N'ajoute des action items que si ${owner} doit réellement faire quelque chose (max. 3). Les rendez-vous déjà fermement réservés ne sont PAS un action item.`,
    // Statische Server-Texte FR (kuratiert, mit Akzenten fuer korrekte TTS-Aussprache).
    llmDegradedSpeech:
      "Désolé, je ne peux pas traiter votre demande pour le moment. Je vous recontacte dès que possible. Au revoir.",
    turnErrorSpeech: "Désolé, un problème technique est survenu. Veuillez réessayer plus tard.",
    noSpeechReprompt: "Pouvez-vous répéter ?",
    noSpeechRepromptAgain: "Je ne vous entends toujours pas. Êtes-vous encore en ligne ?",
    noSpeechFarewell:
      "Je ne vous entends malheureusement pas. Je réessaierai plus tard. Au revoir.",
    capFarewellSpeech:
      "Je dois malheureusement terminer l'appel maintenant. Merci pour votre temps. Au revoir.",
    budgetExhaustedHangup: "Le budget de démonstration est épuisé. Au revoir.",
    // FR-Greeting-Default: {owner} wird zur Laufzeit ersetzt (wie DE). Nur fuer FR-Tenants
    // relevant; der Bestands-/Owner-Tenant traegt weiter den DE-Seed (kein Backfill).
    // P3/WEB-04: das Terminversprechen ("convenir d'un rendez-vous") ist raus - seit P1b/E1
    // hat der Agent kein Buchungs-Tool mehr, ein waehlbarer Text darf das nicht mehr zusagen.
    greetingDefault:
      "Bonjour, vous êtes en relation avec l'assistant IA de {owner}. {owner} n'est pas disponible pour le moment. Je peux prendre un message pour {owner}. Comment puis-je vous aider ?",
    // Inbound-Pflichtsatz (GAP-14/O7), s. DE. Kuratierte Zusatz-Vorlagen (WEB-04): der
    // Pflichtsatz wird beim Katalogbau vorangestellt (G5, s. self-service.js buildTemplates).
    inboundNotice: INBOUND_NOTICES.fr,
    // MCP-Textkanal (P12), s. DE.
    mcp: MCP_TEXTS.fr,
    // Outbound-Gate-Ablehnungstexte (P15/T2), s. DE.
    gates: GATE_TEXTS.fr,
    greetingVariants: Object.freeze([
      "Bonjour, vous êtes bien en ligne avec l'assistant IA de {owner}. Je prends note de votre message pour {owner}. Comment puis-je vous aider ?",
      "Bonjour ! Ici l'assistant IA de {owner}. Comment puis-je vous aider ?",
    ]),
    // I2: FR-Fallback (kuratiert, R8) - Anrede-neutral formuliert (kein tu/vous-Zwang),
    // richtungsabhaengig wie DE/EN.
    turnFallbackSpeech: {
      inbound: "Très bien, merci pour votre appel. Au revoir !",
      outbound: "Très bien, merci pour votre temps. Au revoir !",
    },
    prompt: PROMPT_FR,
    postCall: Object.freeze({
      cancelledTitle: "Appel annulé",
      failedTitle: "Appel non abouti",
      statusBody: (target, status) => `${target} (statut : ${status})`,
      summaryTitle: "Nouveau résumé d'appel",
      subjectOutbound: (to) => `Appel vers ${to}`,
      subjectInbound: (from) => `Appel de ${from}`,
      actionItemsHeading: "Actions à mener :",
    }),
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
    styleClause: makeStyleClause(STYLE_CLAUSES_EN, NEUTRAL_ADDRESS_CLAUSE_EN),
    // Ich-Satz-Passthrough wie DE (I/I'm/I'd); sonst natuerlichere Bruecke.
    bridgePhrase: (goal) =>
      /^i\b/i.test(goal) ? `${goal}.` : `Here's what I'm calling about: ${goal}.`,
    // EN-Offenlegung (R8): feste, kuratierte Variante - byte-stabil und NICHT per
    // Call-Parameter waehlbar/abschaltbar; nur der ownerName ist gebunden (wie DE/FR).
    disclosure: (ownerName) =>
      `Hello, this is an AI assistant calling on behalf of ${ownerName}. This conversation will be summarised for the person I represent.`,
    summarySystem: (owner) =>
      `You are summarising a phone call made by ${owner}'s AI assistant. Reply ONLY with valid JSON: {"summary": "2-3 sentences in English", "actionItems": ["..."], "objective_achieved": true|false|"unclear"}. State concrete outcomes in the summary (agreed date/time, price, contact person's name) if present in the transcript, instead of vague descriptions. objective_achieved judges ONLY the original objective (for inbound calls: whether the caller's request was resolved). Side topics opened by the assistant or the other party themselves (e.g. an offered or abandoned appointment follow-up) are IRRELEVANT to this judgement. true = the objective was answered well enough, even if the call ended in the middle of a follow-up step; false = the objective was clearly not achieved; "unclear" = genuinely impossible to judge from the objective. Only add action items if ${owner} really needs to do something (max. 3). Appointments that are already firmly booked are NOT an action item.`,
    llmDegradedSpeech:
      "Sorry, I can't handle your request right now. I'll get back to you as soon as possible. Goodbye.",
    turnErrorSpeech: "Sorry, a technical problem occurred. Please try again later.",
    noSpeechReprompt: "Could you repeat that?",
    noSpeechRepromptAgain: "I still can't hear you. Are you still there?",
    noSpeechFarewell: "I'm afraid I can't hear you. I'll try again later. Goodbye.",
    capFarewellSpeech: "I have to end the call now. Thank you for your time. Goodbye.",
    budgetExhaustedHangup: "The demo budget has been used up. Goodbye.",
    // P3/WEB-04: das Terminversprechen ("arrange an appointment") ist raus - seit P1b/E1
    // hat der Agent kein Buchungs-Tool mehr, ein waehlbarer Text darf das nicht mehr zusagen.
    greetingDefault:
      "Hi, this is the AI assistant of {owner}. {owner} can't take the call right now. I can take a message for {owner}. How can I help?",
    // Inbound-Pflichtsatz (GAP-14/O7), s. DE. Kuratierte Zusatz-Vorlagen (WEB-04): der
    // Pflichtsatz wird beim Katalogbau vorangestellt (G5, s. self-service.js buildTemplates).
    inboundNotice: INBOUND_NOTICES.en,
    // MCP-Textkanal (P12), s. DE.
    mcp: MCP_TEXTS.en,
    // Outbound-Gate-Ablehnungstexte (P15/T2), s. DE.
    gates: GATE_TEXTS.en,
    greetingVariants: Object.freeze([
      "Hello, you're through to {owner}'s AI assistant. I'll take a message for {owner}. How can I help?",
      "Hi there! This is {owner}'s AI assistant. How can I help you?",
    ]),
    // I2: EN-Fallback (kuratiert, R8), richtungsabhaengig wie DE/FR.
    turnFallbackSpeech: {
      inbound: "Alright, thank you for calling. Goodbye!",
      outbound: "Alright, thank you for your time. Goodbye!",
    },
    prompt: PROMPT_EN,
    postCall: Object.freeze({
      cancelledTitle: "Call cancelled",
      failedTitle: "Call did not connect",
      statusBody: (target, status) => `${target} (status: ${status})`,
      summaryTitle: "New call summary",
      subjectOutbound: (to) => `Call to ${to}`,
      subjectInbound: (from) => `Call from ${from}`,
      actionItemsHeading: "Action items:",
    }),
  }),
});

// Unterstuetzte Sprach-Codes (Bundle-Schluessel) - fuer Tests/Iteration.
export const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(LOCALES));

// F1 Geo-Location (Phase 6) - Land -> Default-Sprache. DIE eine Quelle, die ein bei der
// Registrierung aufgeloestes/gewaehltes ISO-3166-1-alpha-2-Land auf eine Gespraechs-
// sprache (Bundle-Schluessel) abbildet. Lebt an der i18n-Quelle (nicht in state-ops, das
// config-frei bleibt) und nutzt das vorhandene Sprach-Set (DE/FR/EN). Generisch: eine
// weitere Sprache = ein weiterer Eintrag (Owner #1). Unbekanntes Land -> DEFAULT_LANGUAGE
// (Weltdefault, P10), NIE Crash (R7) - so faerbt kein unbekanntes Land den DE-Bestand ab.
export const LANGUAGE_FOR_COUNTRY = Object.freeze({
  DE: "de",
  AT: "de",
  CH: "de",
  FR: "fr",
  GB: "en",
  IE: "en",
});

// Land (ISO-2, case-insensitiv) -> Default-Sprache. Fehlend/leer/unbekannt -> Weltdefault.
export function languageForCountry(country) {
  return LANGUAGE_FOR_COUNTRY[String(country || "").toUpperCase()] || DEFAULT_LANGUAGE;
}

// Resolver: language (z.B. call.language) -> Locale. Fail-safe Fallback auf
// DEFAULT_LANGUAGE (Weltdefault, P10) bei unbekannter/fehlender/null Sprache (R7). EINE
// Stelle, die den frueher toten Kanal call.language in ein konkretes Locale aufloest.
export function localeFor(language) {
  return LOCALES[language] || LOCALES[DEFAULT_LANGUAGE];
}
