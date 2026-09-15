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
// transliteriert bleiben Strings, die NIE gesprochen werden: summarySystem (LLM-Prompt,
// dessen Output als JSON geparst wird) - siehe test/de-umlaut-orthography.test.js, das
// diese Grenze festhaelt.
// Franzoesische Strings tragen ebenfalls die korrekten Akzente ("resume" != "résumé").
// Die Render-Pfade sind UTF-8 (TeXML <?xml encoding="UTF-8"?>); Umlaute und
// Akzente sind keine XML-Sonderzeichen und passieren die Escaper unveraendert.
// P5 (PLAN-CONVERSATION-QUALITY-V2): die Prompt-Bausteine dieses Bundles (speechClause,
// STYLE_CLAUSES_DE) tragen seit P5 ebenfalls korrekte Umlaute - sie fliessen in den von
// claude.js zusammengesetzten Systemprompt, der nie gesprochen, aber vom Modell gelesen
// wird (Priming-These). summarySystem bleibt ausdruecklich transliteriert (siehe P1-U3
// oben), es ist kein Prompt-Baustein im P5-Sinn.
// KOMMENTARE bleiben ASCII (Repo-Konvention) - nur die Strings aendern sich.
import { DEFAULT_LANGUAGE, DEFAULT_GREETING } from "../store/defaults.js";
import { INBOUND_NOTICES } from "./inbound-notice.js";
import { PROMPT_DE } from "./prompts/de.js";
import { PROMPT_FR } from "./prompts/fr.js";
import { PROMPT_EN } from "./prompts/en.js";
import { MCP_TEXTS } from "./mcp-texts.js";
import { GATE_TEXTS } from "./gate-texts.js";
// GQ-P15 (F4): Ausfall-Gruende + die Faktorei, die daraus den Notification-Body baut.
// Beides lebt in failure-reason-texts.js, weil dort die Token-Grammatik (failureReasonBase)
// konsumiert wird - locales.js bleibt reine Verdrahtung.
import { FAILURE_REASON_TEXTS, makeStatusBody } from "./failure-reason-texts.js";

// Logische Voice-Profile (Strings) als Forward-Referenz fuer den Telephonie-Renderer
// (Phase 3 mappt sie auf provider-spezifische Voice-Namen Polly/Azure). Im Bundle steht
// nur der LOGISCHE Profilname pro Sprache - kein roher Provider-Voice-Name (zwei Provider,
// ein logisches Profil; directives.js VOICE_PROFILE haelt die kanonischen Enum-Werte).
const VOICE_PROFILE_DE = "de-female-neural";
const VOICE_PROFILE_FR = "fr-female-neural";
const VOICE_PROFILE_EN = "en-female-neural";

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

// Der Ausdruck, der IM Offenlegungssatz an die Stelle des Auftraggeber-Namens tritt, wenn
// keiner vorliegt ("Hello, this is an AI assistant calling on behalf of its owner."). Der
// Satz bleibt damit vollstaendig, und die Offenlegung ("hier spricht ein KI-Assistent")
// traegt fuer sich allein (Absolute Regel 2, Artikel 50 EU AI Act: pflichtig ist, dass die
// Gegenstelle von der KI erfaehrt - nicht der Name des Auftraggebers). Eine gesetzliche
// Pflicht haengt nie an einer Variablen ohne Default.
//
// JE SPRACHE ein eigener Ausdruck, IN dieser Sprache: der englische Einschub in einem
// deutschen oder franzoesischen Satz waere ein Sprachbruch mitten in der Pflichtaussage.
// Jeder ist auf den Satzbau seiner Fassung gebaut ("im Auftrag von" + Dativ, "mandaté par"
// + Agens) und benutzt das Wort, das der zweite Satz derselben Offenlegung ohnehin fuehrt
// (Auftraggeber / mandant) - keine neue Vokabel fuer denselben Begriff.
//
// ERREICHBAR ist jeder der drei ueber sein eigenes Bundle (LOCALES.<sprache>.
// disclosureOwnerFallback, s.u.), NICHT ueber drei Importe: der ElevenLabs-Anrufstart
// laesst den Satz vom Agenten des ANBIETERS sprechen (first_message) und setzt nur den
// Namen in dessen Vorlagen-Variable ein - er kommt an disclosure() nicht vorbei und
// braucht den Ausdruck als WERT, und zwar in DER Sprache, die der Anruf aufgeloest hat
// (src/elevenlabs/call-locale.js). Am Bundle statt als Export bleibt er unteilbar an
// seiner Fassung: wer die Sprache waehlt, bekommt den passenden Ausdruck automatisch
// mit, statt ihn getrennt danebenzulegen und dabei die falsche Sprache greifen zu
// koennen. DISCLOSURE_OWNER_FALLBACK_EN bleibt zusaetzlich exportiert - der
// Weltdefault-Ausdruck ist der einzige, den ein Test ohne aufgeloeste Sprache nennen
// kann (test/elevenlabs-anrufstart.test.js).
const DISCLOSURE_OWNER_FALLBACK_DE = "meinem Auftraggeber";
const DISCLOSURE_OWNER_FALLBACK_FR = "mon mandant";
export const DISCLOSURE_OWNER_FALLBACK_EN = "its owner";

// EINE Quelle (G5) fuer alle drei Offenlegungs-Lambdas - und der Ort, an dem der Default
// STRUKTURELL bindet (G27, Struktur statt Konvention): kein Aufrufweg kann ihn vergessen,
// weil keiner den Namen anders als durch diese Funktion in den Satz bekommt. Das
// Identitaets-Gate davor (telephony/outbound-gates.js) prueft nur den WAHRHEITSWERT des
// Namens; ein Name aus lauter Leerzeichen passiert es und ergaebe sonst die leere
// Einsetzstelle "...im Auftrag von .". Der WORTLAUT des Satzes bleibt unangetastet, ein
// gesetzter Name faellt unveraendert (nur um Rand-Leerzeichen gekuerzt) an seine Stelle.
function makeDisclosure(satz, ownerFallback) {
  return (ownerName) => {
    const name = typeof ownerName === "string" ? ownerName.trim() : "";
    return satz(name || ownerFallback);
  };
}

// IEX-A2 (O3/O4): der Namenssatz, mit dem der Inbound-Fehlersatz (und ab IEX-A3 die Eroeffnung)
// beginnt. Traegt die KI-Kennzeichnung selbst ("KI"/"AI"/"IA") - auch ohne Namen. Kein
// disclosureOwnerFallback: "von meinem Auftraggeber" passt grammatisch nicht (O4). Als eigene
// Konstanten, nicht aus Katalog-Strings geschnitten. Gesprochene DE-Strings: echte Umlaute.
// Die Namens-Bereinigung spiegelt makeDisclosure bewusst, statt sie zu teilen: A6 laesst den
// Offenlegungs-Code byte-unberuehrt.
const INBOUND_NAME_SATZ_TEXTE = Object.freeze({
  de: Object.freeze({ mitName: (name) => `Hier ist der KI-Assistent von ${name}.`, ohneName: "Hier ist ein KI-Assistent." }),
  en: Object.freeze({ mitName: (name) => `This is ${name}'s AI assistant.`, ohneName: "This is an AI assistant." }),
  fr: Object.freeze({ mitName: (name) => `Ici l'assistant IA de ${name}.`, ohneName: "Ici un assistant IA." }),
});
const INBOUND_FEHLERTEIL = Object.freeze({
  de: "Es ist ein technischer Fehler aufgetreten, bitte rufen Sie später noch einmal an.",
  en: "A technical error has occurred, please call again later.",
  fr: "Une erreur technique est survenue, veuillez rappeler plus tard.",
});

function makeInboundNameSatz({ mitName, ohneName }) {
  return (ownerName) => {
    const name = typeof ownerName === "string" ? ownerName.trim() : "";
    return name ? mitName(name) : ohneName;
  };
}

// O3: Namenssatz + Fehlerteil. Der Anrufer hoert ihn vor dem Auflegen, es folgt kein Gespraech.
function makeInboundFehlersatz(sprache) {
  const nameSatz = makeInboundNameSatz(INBOUND_NAME_SATZ_TEXTE[sprache]);
  return (ownerName) => `${nameSatz(ownerName)} ${INBOUND_FEHLERTEIL[sprache]}`;
}

// Pro Sprache: alle sprachabhaengigen Bausteine. Funktionen dort, wo ein Name/Anliegen
// interpoliert wird (disclosure/bridgePhrase/summarySystem) - der Aufrufer reicht die
// gebundene Identitaet bzw. das Anliegen herein (keine Identitaets-Logik im Bundle).
export const LOCALES = Object.freeze({
  de: Object.freeze({
    language: "de",
    dateLocale: "de-DE", // Date#toLocaleString-Locale (claude.js fmtDate + now)
    sttLocale: "de-DE", // STT BCP-47 (Phase 3: Telnyx-Gather-Render)
    voiceProfile: VOICE_PROFILE_DE, // TTS-Voice-Profil (Phase 3: render TTS)
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
    // Der Satz, der die Eroeffnung zur GESPRAECHSEROEFFNUNG macht. Keine Interpolation:
    // er darf an keinem Anruf-Wert haengen.
    //
    // ER FRAGT NACH DER SACHE, NICHT NACH ERLAUBNIS (Eigentuemer-Befund nach Anruf 7,
    // 18.08.2026). Vorher stand hier "Haben Sie dafuer kurz Zeit?" - eine Ja/Nein-Frage,
    // und sie kostete am gemessenen Anruf einen VOLLEN Rundgang: der Angerufene sagte bei
    // 19 s "Ja, hab ich", woraufhin der Agent bei 22 s das Anliegen ein zweites Mal
    // vortrug. Rund 20 s fuer null Inhalt. Eine offene Frage laesst die Gegenseite sofort
    // zur Sache antworten - im selben Zug, in dem sie sonst nur "ja" gesagt haette.
    //
    // SEIT GQ-E1 OHNE ANREDE-PRONOMEN (Befund call_mt0ddduxuzgl): der Satz steht hinter
    // einer Zeile, deren Anrede aus dem AUFTRAG kommt - der duzte, die feste Frage
    // siezte. Ein Baustein ohne Anrede kann mit keiner Anrede brechen; das ist die
    // einzige Loesung ohne Heuristik und sie traegt auf allen Stufen der Treppe
    // (Stufe 3 kennt den Auftragstext gar nicht). Waechter: GQ-E1-04.
    openingQuestion: "Wie sieht es damit aus?",
    // Thema A (2026-08-19): letzte Stufe der Eroeffnungs-Treppe (src/elevenlabs/
    // opening-line.js) - greift NUR, wenn weder die erzeugte Zeile noch der Auftrag
    // selbst die Pruefung bestehen. EIN kurzer Satz, keine Interpolation, korrekte
    // Umlaute (gesprochener DE-String). Ebenfalls ohne Anrede-Pronomen, s.
    // openingQuestion (GQ-E1-04).
    openingReasonFallback: "Ich rufe an, um ein kurzes Anliegen zu klären.",
    // Pflicht-Offenlegung (CLAUDE.md Regel 2): fest verdrahtet, byte-stabil, nur der
    // ownerName ist gebunden (nicht per Call-Parameter waehlbar/abschaltbar). Fehlt der
    // Name, tritt der DE-Ausdruck ein (makeDisclosure) - der Satz bleibt vollstaendig.
    disclosure: makeDisclosure(
      (ownerName) =>
        `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${ownerName}. Das Gespräch wird für meinen Auftraggeber zusammengefasst.`,
      DISCLOSURE_OWNER_FALLBACK_DE,
    ),
    // Derselbe Ausdruck, den disclosure() oben bei fehlendem Namen selbst einsetzt -
    // hier zusaetzlich als blosser WERT, fuer den einen Weg, der den Satz gar nicht
    // rendert, sondern nur den Namen in die Vorlage eines fremden Agenten reicht
    // (s. den Kommentar an DISCLOSURE_OWNER_FALLBACK_* oben). Kein zweiter Wortlaut:
    // beide Stellen lesen dieselbe Konstante.
    disclosureOwnerFallback: DISCLOSURE_OWNER_FALLBACK_DE,
    // DE1: die zweite gesprochene Art.-50-Stelle - der Anrufbeantworter-Text. Was hier
    // steht, ist AUSSCHLIESSLICH das, was HINTER dem Offenlegungssatz kommt: der Grund
    // der Nachricht, die Grund-Zeile des Auftrags und der Abschied. Der Satz selbst wird
    // NICHT hier wiederholt (disclosure ist die eine Quelle, G5) - er wird in
    // src/elevenlabs/call-locale.js davorgesetzt und bleibt damit strukturell der
    // ALLERERSTE (Absolute Regel 2). Gesprochener Text, deshalb echte Umlaute.
    voicemailBody: (openingLine) =>
      `Ich hinterlasse diese Nachricht, weil niemand abgehoben hat. ${openingLine} Ich versuche es später noch einmal. Auf Wiederhören.`,
    // OC-P2 (PLAN-OWNER-CALL 1.4): die Eroeffnung fuer den EINEN Fall, in dem der lange
    // Offenlegungssatz entfaellt - das Ziel ist die eigene hinterlegte Nummer des
    // anrufenden Tenants (call.calleeIsOwner, src/callee-is-owner.js). GESPROCHENER
    // Satz, deshalb echte Umlaute, wo welche vorkommen (hier keine - das ist kein
    // Versehen, s. test/callee-is-owner-elevenlabs.test.js).
    //
    // DAS WORT "KI" IST TRAGEND UND DARF NIE WEGFALLEN. Das Praedikat beweist eine
    // Aussage ueber die NUMMER - dass das Ziel die hinterlegte Nummer des Tenants ist.
    // Es beweist NICHT, dass die PERSON am Apparat der Auftraggeber ist:
    // normalizePrivateNumber kennt keine Mobilfunk-Beschraenkung und keinen
    // Geraetebezug (store/state-ops.js:2127-2136), ein Festnetz- oder
    // Gemeinschaftsanschluss ist also zulaessig. Hebt dort jemand anderes ab, muss
    // schon der erste Satz sagen, dass eine Maschine spricht - "Assistent" allein
    // leistet das nicht (Artikel 50 EU AI Act). Wer die Begruessung kuerzt, kuerzt
    // diese Zusage.
    //
    // DIREKTE ANREDE, Du-Form, Vorname: der Auftraggeber spricht mit seinem eigenen
    // Assistenten. KEINE Selbst-Vorstellung als "Assistent von <Name>" - das waere die
    // dritte Person ueber den Zuhoerer. KEIN Hinweis auf eine Zusammenfassung "fuer
    // meinen Auftraggeber" - der Auftraggeber IST der Zuhoerer. KURZ: die Eroeffnung
    // ist am Agenten gegen Unterbrechung gesperrt
    // (disable_first_message_interruptions), jedes ueberfluessige Wort ist eine
    // Sekunde, in der der Owner nicht dazwischenreden kann.
    //
    // KEIN NAMENS-RUECKFALL, mit Absicht: fehlt der Vorname, wird gar keine
    // Uebersteuerung gebaut (elevenlabs/outbound.js#ownerFirstMessage) und der
    // statische Offenlegungs-Rahmen spricht - fail-closed.
    ownerOpening: (firstName) => `Hallo ${firstName}, hier ist dein KI-Assistent.`,
    // Zusammenfassungs-Prompt-Sprach-Teil (claude.js summarizeCall). Die JSON-Keys
    // bleiben englisch (sie werden geparst); nur der menschliche Text ist sprachabhaengig.
    summarySystem: (owner) =>
      `Du fasst ein Telefonat des KI-Assistenten von ${owner} zusammen. Antworte NUR mit validem JSON: {"summary": "2-3 Saetze auf Deutsch", "actionItems": ["..."], "objective_achieved": true|false|"unclear", "outcome": "1 Satz", "commitments": ["..."], "counterparty_commitments": ["..."], "open_points": ["..."], "next_step": "..."|null, "facts": ["..."]}. Nenne in der summary konkrete Ergebnisse (vereinbartes Datum/Uhrzeit, Preis, Name der Kontaktperson), sofern im Transkript vorhanden, statt allgemeiner Umschreibungen. objective_achieved bewertet AUSSCHLIESSLICH den unter "Auftrag" genannten urspruenglichen Auftrag (bei Inbound-Calls: ob das Anliegen des Anrufers geloest wurde). Vom Assistenten oder Angerufenen selbst eroeffnete Nebenthemen (z.B. ein angebotener oder abgebrochener Termin-Folgeschritt) sind fuer diese Bewertung IRRELEVANT. true = der Auftrag wurde genug beantwortet, auch wenn der Anruf mitten in einem Folgeschritt endete; false = der Auftrag wurde klar nicht erreicht; "unclear" = aus dem Auftrag heraus echt nicht beurteilbar. Action Items nur, wenn ${owner} wirklich etwas tun muss (max. 3). Bereits fest gebuchte Termine sind KEIN Action Item. Ergebnis-Karte: outcome ist EIN Satz mit dem konkreten Ergebnis (vereinbartes Datum/Uhrzeit, Preis, Name) oder - wenn nichts erreicht wurde - woran es lag. commitments sind Zusagen, die der Assistent im Namen von ${owner} gemacht hat; counterparty_commitments sind Zusagen der Gegenstelle. open_points sind Fragen, die offen blieben. next_step ist der EINE naechste Schritt fuer ${owner}, sonst null. facts sind dauerhaft nuetzliche Angaben ueber die Gegenstelle (Oeffnungszeiten, Ansprechpartner, Preise). Jede Liste hoechstens 3 Eintraege, jeder Eintrag hoechstens 200 Zeichen. Erfinde nichts: fehlt eine Angabe im Transkript, bleibt die Liste leer bzw. das Feld null.`,
    // AL-P11 (O5): NUR angehaengt, wenn EVIDENCE_RETENTION_DAYS > 0 (claude.js entscheidet,
    // das Bundle bleibt config-frei). Getrennt vom Basis-Prompt, damit der Prompt bei
    // abgeschalteter Zitat-Erhebung KEINE Zitat-Aufforderung traegt.
    summaryEvidenceClause:
      ' Ergaenze ausserdem "evidence": hoechstens 2 kurze, WOERTLICHE Zitate aus dem Transkript, die das Ergebnis belegen. Nur woertlich Gesagtes, nichts Zusammengefasstes.',
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
    // IEX-A2 (O3): der feste Fehlersatz einer gescheiterten Uebergabe an den EL-Agenten.
    inboundFehlersatz: makeInboundFehlersatz("de"),
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
      "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht für {owner} auf. Wie kann ich helfen?",
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
    // AL-P14: deterministischer Ueberbrueckungssatz, wenn die Rueckfrage rausgeht. LLM-FREI
    // (er muss auch kommen, wenn das Modell klemmt) und bewusst als Frage formuliert: der
    // Folge-Turn entsteht nur, wenn der Angerufene etwas sagt. Enthaelt bewusst KEIN " - "
    // (shapeForSpeech wuerde es zu Komma normalisieren und den Wortlaut brechen).
    consultFillerSpeech: "Einen kleinen Moment, ich prüfe das kurz. Sind Sie noch dran?",
    // AL-P14: hoechstens EIN Halte-Satz je Rueckfrage (danach greift der Mandats-Fallback).
    consultHoldSpeech: "Einen Moment noch, bitte. Ich bin gleich für Sie da.",
    // P11: Modell-Text (Systemprompt-Geruest, Tool-Beschreibungen, Steuer-Marker) - s.
    // i18n/prompts/. Wird nie gesprochen.
    prompt: PROMPT_DE,
    // Nutzer-sichtbare Post-Call-Texte (Notification + Summary-SMS), NIE gesprochen (WEB-14).
    postCall: Object.freeze({
      cancelledTitle: "Anruf abgebrochen",
      failedTitle: "Anruf nicht zustande gekommen",
      // GQ-P15 (F4): dritter Parameter ist der bereits gefilterte Grund-Token (optional).
      // Ohne Grund BYTE-IDENTISCH zum Bestand `${target} (Status: ${status})`.
      statusBody: makeStatusBody("Status:", FAILURE_REASON_TEXTS.de),
      summaryTitle: "Neue Call Summary",
      subjectOutbound: (to) => `Anruf bei ${to}`,
      subjectInbound: (from) => `Anruf von ${from}`,
      actionItemsHeading: "Action Items:",
      // F2-Mail: Labels der Call-Summary-Mail (Zeitpunkt/Dauer-Zeile). NIE gesprochen
      // (Muster der uebrigen postCall-Strings).
      mailTimeLabel: "Zeitpunkt:",
      mailDurationLabel: "Dauer:",
      // OUTBOUND-E3a: der zweite Absatz der EINEN Nutzer-Mail bei not-placed (Schuld liegt
      // bei uns/dem Anbieter). NIE gesprochen (Muster der uebrigen postCall-Strings) - DE
      // deshalb in der ASCII-Transliteration des Bestands, FR mit Akzenten, EN kuratiert.
      notPlacedMailHint:
        "Der Fehler lag auf unserer Seite, nicht bei dir. Wir kuemmern uns darum; du kannst es spaeter erneut versuchen.",
      // F2-Newsletter-Recipients: Abmelde-Link-Zeile am Ende JEDER Summary-Mail an eine
      // Zusatzadresse (Owner-Auftrag). Die Konto-Mail traegt diese Zeile NICHT (kein
      // unsubToken fuer den Konto-Pfad, s. mail-summary.js).
      unsubscribeLinkLabel: "Abmelden:",
    }),
    // F2-Newsletter-Recipients: Bestaetigungs-Mail (Double-Opt-in) + die vier oeffentlichen
    // Seiten-Texte (GET /newsletter/confirm, /newsletter/unsubscribe). NIE gesprochen (Muster
    // postCall). ownerName/confirmUrl werden vom Aufrufer gebunden (keine Identitaets-Logik
    // im Bundle, Muster disclosure/bridgePhrase).
    newsletter: Object.freeze({
      confirmMailSubject: "Bestätigung: Anruf-Zusammenfassungen erhalten",
      confirmMailText: (ownerName, confirmUrl) =>
        `Hallo,\n\n${ownerName} hat diese E-Mail-Adresse eingetragen, um Anruf-Zusammenfassungen ` +
        `von Hermes zu erhalten. Bitte bestätige die Anmeldung über diesen Link:\n\n${confirmUrl}\n\n` +
        "Der Link ist 48 Stunden gültig. Wenn du das nicht warst, musst du nichts tun - " +
        "ohne Bestätigung wird die Adresse nicht verwendet.",
      confirmedPageTitle: "E-Mail bestätigt",
      confirmedPageBody: "Du erhältst ab jetzt Anruf-Zusammenfassungen.",
      invalidPageTitle: "Link ungültig",
      invalidPageBody: "Dieser Bestätigungslink ist ungültig oder abgelaufen.",
      unsubscribedPageTitle: "Abgemeldet",
      unsubscribedPageBody: "Du erhältst keine weiteren Anruf-Zusammenfassungen mehr.",
    }),
  }),
  fr: Object.freeze({
    language: "fr",
    dateLocale: "fr-FR",
    sttLocale: "fr-FR",
    voiceProfile: VOICE_PROFILE_FR,
    speechClause: "Réponds exclusivement en français parlé et naturel.",
    styleClause: makeStyleClause(STYLE_CLAUSES_FR, NEUTRAL_ADDRESS_CLAUSE_FR),
    // Ich-Satz-Passthrough wie DE (je/j'); sonst kuratierte, natuerlichere Bruecke.
    bridgePhrase: (goal) =>
      /^(je\b|j')/i.test(goal) ? `${goal}.` : `Voici l'objet de mon appel : ${goal}.`,
    // s. DE (openingQuestion).
    openingQuestion: "Qu'en est-il ?",
    // s. DE (openingReasonFallback) - kuratiert, mit Akzenten.
    openingReasonFallback: "J'appelle pour régler une petite demande.",
    // FR-Offenlegung (R8): feste, kuratierte Variante - byte-stabil und NICHT per
    // Call-Parameter waehlbar/abschaltbar; nur der ownerName ist gebunden (wie DE).
    // Fehlt der Name, tritt der FR-Ausdruck ein (makeDisclosure).
    disclosure: makeDisclosure(
      (ownerName) =>
        `Bonjour, ceci est un assistant IA mandaté par ${ownerName}. Cette conversation sera résumée pour mon mandant.`,
      DISCLOSURE_OWNER_FALLBACK_FR,
    ),
    // s. DE (derselbe Ausdruck wie in disclosure(), zusaetzlich als Wert).
    disclosureOwnerFallback: DISCLOSURE_OWNER_FALLBACK_FR,
    // s. DE (voicemailBody).
    voicemailBody: (openingLine) =>
      `Je laisse ce message parce que personne n'a décroché. ${openingLine} Je réessaierai plus tard. Au revoir.`,
    // s. DE (ownerOpening) - "IA" traegt hier dieselbe Last wie "KI" dort.
    ownerOpening: (firstName) => `Bonjour ${firstName}, c'est ton assistant IA.`,
    summarySystem: (owner) =>
      `Tu résumes un appel téléphonique de l'assistant IA de ${owner}. Réponds UNIQUEMENT avec du JSON valide : {"summary": "2-3 phrases en français", "actionItems": ["..."], "objective_achieved": true|false|"unclear", "outcome": "1 phrase", "commitments": ["..."], "counterparty_commitments": ["..."], "open_points": ["..."], "next_step": "..."|null, "facts": ["..."]}. Mentionne dans le résumé des résultats concrets (date/heure convenue, prix, nom de la personne de contact), si le transcript les contient, plutôt que des formulations générales. objective_achieved évalue EXCLUSIVEMENT la mission initiale (pour les appels entrants : si la demande de l'appelant a été résolue). Les sujets annexes ouverts par l'assistant ou l'interlocuteur lui-même (par ex. une prise de rendez-vous proposée ou interrompue) sont SANS PERTINENCE pour cette évaluation. true = la mission a été suffisamment traitée, même si l'appel s'est terminé au milieu d'une étape de suivi ; false = la mission n'a clairement pas été atteinte ; "unclear" = réellement impossible à juger à partir de la mission. N'ajoute des action items que si ${owner} doit réellement faire quelque chose (max. 3). Les rendez-vous déjà fermement réservés ne sont PAS un action item. Fiche de résultat : outcome est UNE phrase avec le résultat concret (date/heure convenue, prix, nom) ou - si rien n'a été obtenu - la raison. commitments sont les engagements pris par l'assistant au nom de ${owner} ; counterparty_commitments sont les engagements de l'interlocuteur. open_points sont les questions restées ouvertes. next_step est LA prochaine étape pour ${owner}, sinon null. facts sont des informations durablement utiles sur l'interlocuteur (horaires, contact, prix). Chaque liste contient au maximum 3 éléments, chaque élément au maximum 200 caractères. N'invente rien : si une information manque dans le transcript, la liste reste vide ou le champ reste null.`,
    // AL-P11 (O5): s. DE - uniquement ajouté si EVIDENCE_RETENTION_DAYS > 0.
    summaryEvidenceClause:
      ' Ajoute aussi "evidence" : au maximum 2 courtes citations LITTÉRALES du transcript qui étayent le résultat. Uniquement des propos littéraux, rien de résumé.',
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
    // IEX-A2 (O3): der feste Fehlersatz einer gescheiterten Uebergabe an den EL-Agenten.
    inboundFehlersatz: makeInboundFehlersatz("fr"),
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
    // AL-P14: Ueberbrueckungs-/Halte-Satz, s. DE (kuratiert, R8).
    consultFillerSpeech: "Un petit instant, je vérifie cela. Vous êtes toujours là ?",
    consultHoldSpeech: "Encore un instant, s'il vous plaît. Je reviens tout de suite.",
    prompt: PROMPT_FR,
    postCall: Object.freeze({
      cancelledTitle: "Appel annulé",
      failedTitle: "Appel non abouti",
      statusBody: makeStatusBody("statut :", FAILURE_REASON_TEXTS.fr),
      summaryTitle: "Nouveau résumé d'appel",
      subjectOutbound: (to) => `Appel vers ${to}`,
      subjectInbound: (from) => `Appel de ${from}`,
      actionItemsHeading: "Actions à mener :",
      // F2-Mail: Labels der Call-Summary-Mail, s. DE.
      mailTimeLabel: "Heure :",
      mailDurationLabel: "Durée :",
      notPlacedMailHint:
        "L'erreur vient de chez nous, pas de vous. Nous nous en occupons ; vous pouvez réessayer plus tard.",
      // F2-Newsletter-Recipients: Abmelde-Link-Zeile, s. DE.
      unsubscribeLinkLabel: "Se désabonner :",
    }),
    // F2-Newsletter-Recipients: s. DE.
    newsletter: Object.freeze({
      confirmMailSubject: "Confirmation : recevoir les résumés d'appel",
      confirmMailText: (ownerName, confirmUrl) =>
        `Bonjour,\n\n${ownerName} a inscrit cette adresse e-mail pour recevoir les résumés ` +
        `d'appel de Hermes. Merci de confirmer votre inscription via ce lien :\n\n${confirmUrl}\n\n` +
        "Ce lien est valable 48 heures. Si ce n'était pas vous, vous n'avez rien à faire - " +
        "sans confirmation, l'adresse ne sera pas utilisée.",
      confirmedPageTitle: "E-mail confirmé",
      confirmedPageBody: "Vous recevrez désormais les résumés d'appel.",
      invalidPageTitle: "Lien invalide",
      invalidPageBody: "Ce lien de confirmation est invalide ou expiré.",
      unsubscribedPageTitle: "Désabonné",
      unsubscribedPageBody: "Vous ne recevrez plus de résumés d'appel.",
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
    speechClause: "Reply only in natural, spoken English.",
    styleClause: makeStyleClause(STYLE_CLAUSES_EN, NEUTRAL_ADDRESS_CLAUSE_EN),
    // Ich-Satz-Passthrough wie DE (I/I'm/I'd); sonst natuerlichere Bruecke.
    bridgePhrase: (goal) =>
      /^i\b/i.test(goal) ? `${goal}.` : `Here's what I'm calling about: ${goal}.`,
    // s. DE (openingQuestion).
    openingQuestion: "How does that look on your side?",
    // s. DE (openingReasonFallback).
    openingReasonFallback: "I am calling to sort out a small matter with you.",
    // EN-Offenlegung (R8): feste, kuratierte Variante - byte-stabil und NICHT per
    // Call-Parameter waehlbar/abschaltbar; nur der ownerName ist gebunden (wie DE/FR).
    // Fehlt der Name, tritt DISCLOSURE_OWNER_FALLBACK_EN ein (makeDisclosure) - denselben
    // Ausdruck setzt der ElevenLabs-Anrufstart in seine Vorlagen-Variable, wenn der Anruf
    // auf Englisch aufgeloest hat; loest er auf Deutsch/Franzoesisch auf, nimmt er den
    // Ausdruck DIESER Sprache (src/elevenlabs/call-locale.js).
    disclosure: makeDisclosure(
      (ownerName) =>
        `Hello, this is an AI assistant calling on behalf of ${ownerName}. This conversation will be summarised for the person I represent.`,
      DISCLOSURE_OWNER_FALLBACK_EN,
    ),
    // s. DE (derselbe Ausdruck wie in disclosure(), zusaetzlich als Wert).
    disclosureOwnerFallback: DISCLOSURE_OWNER_FALLBACK_EN,
    // s. DE (voicemailBody). WOERTLICH der Rest des heutigen Live-Texts am Agenten
    // (Stand 2026-09-04, per GET gemessen) - fuer Englisch aendert sich am gesprochenen
    // Wort NICHTS, nur der Ort, an dem es steht.
    voicemailBody: (openingLine) =>
      `I am leaving this message because nobody picked up. ${openingLine} I will try again later. Goodbye.`,
    // s. DE (ownerOpening) - "AI" traegt hier dieselbe Last wie "KI" dort.
    ownerOpening: (firstName) => `Hi ${firstName}, it's your AI assistant.`,
    summarySystem: (owner) =>
      `You are summarising a phone call made by ${owner}'s AI assistant. Reply ONLY with valid JSON: {"summary": "2-3 sentences in English", "actionItems": ["..."], "objective_achieved": true|false|"unclear", "outcome": "1 sentence", "commitments": ["..."], "counterparty_commitments": ["..."], "open_points": ["..."], "next_step": "..."|null, "facts": ["..."]}. State concrete outcomes in the summary (agreed date/time, price, contact person's name) if present in the transcript, instead of vague descriptions. objective_achieved judges ONLY the original objective (for inbound calls: whether the caller's request was resolved). Side topics opened by the assistant or the other party themselves (e.g. an offered or abandoned appointment follow-up) are IRRELEVANT to this judgement. true = the objective was answered well enough, even if the call ended in the middle of a follow-up step; false = the objective was clearly not achieved; "unclear" = genuinely impossible to judge from the objective. Only add action items if ${owner} really needs to do something (max. 3). Appointments that are already firmly booked are NOT an action item. Result card: outcome is ONE sentence with the concrete result (agreed date/time, price, name) or - if nothing was achieved - the reason why. commitments are promises the assistant made on behalf of ${owner}; counterparty_commitments are promises made by the other party. open_points are questions that stayed open. next_step is THE one next step for ${owner}, otherwise null. facts are durably useful details about the other party (opening hours, contact person, prices). Each list holds at most 3 entries, each entry at most 200 characters. Invent nothing: if a detail is missing from the transcript, the list stays empty or the field stays null.`,
    // AL-P11 (O5): s. DE - only appended when EVIDENCE_RETENTION_DAYS > 0.
    summaryEvidenceClause:
      ' Also add "evidence": at most 2 short, VERBATIM quotes from the transcript that support the outcome. Only verbatim wording, nothing summarised.',
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
    // IEX-A2 (O3): der feste Fehlersatz einer gescheiterten Uebergabe an den EL-Agenten.
    inboundFehlersatz: makeInboundFehlersatz("en"),
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
    // AL-P14: Ueberbrueckungs-/Halte-Satz, s. DE (kuratiert, R8).
    consultFillerSpeech: "One moment, I'm just checking that. Are you still there?",
    consultHoldSpeech: "Just one more moment, please. I'll be right with you.",
    prompt: PROMPT_EN,
    postCall: Object.freeze({
      cancelledTitle: "Call cancelled",
      failedTitle: "Call did not connect",
      statusBody: makeStatusBody("status:", FAILURE_REASON_TEXTS.en),
      summaryTitle: "New call summary",
      subjectOutbound: (to) => `Call to ${to}`,
      subjectInbound: (from) => `Call from ${from}`,
      actionItemsHeading: "Action items:",
      // F2-Mail: Labels der Call-Summary-Mail, s. DE.
      mailTimeLabel: "Time:",
      mailDurationLabel: "Duration:",
      notPlacedMailHint:
        "The problem was on our side, not yours. We are looking into it; you can try again later.",
      // F2-Newsletter-Recipients: Abmelde-Link-Zeile, s. DE.
      unsubscribeLinkLabel: "Unsubscribe:",
    }),
    // F2-Newsletter-Recipients: s. DE.
    newsletter: Object.freeze({
      confirmMailSubject: "Confirm: receive call summaries",
      confirmMailText: (ownerName, confirmUrl) =>
        `Hello,\n\n${ownerName} added this email address to receive call summaries from ` +
        `Hermes. Please confirm the signup via this link:\n\n${confirmUrl}\n\n` +
        "This link is valid for 48 hours. If this wasn't you, you don't need to do anything - " +
        "without confirmation, the address will not be used.",
      confirmedPageTitle: "Email confirmed",
      confirmedPageBody: "You will now receive call summaries.",
      invalidPageTitle: "Link invalid",
      invalidPageBody: "This confirmation link is invalid or has expired.",
      unsubscribedPageTitle: "Unsubscribed",
      unsubscribedPageBody: "You will no longer receive call summaries.",
    }),
  }),
});

// Unterstuetzte Sprach-Codes (Bundle-Schluessel) - fuer Tests/Iteration.
export const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(LOCALES));

// P4a: der Sprachwunsch EINES Auftrags, kanonisiert - oder null. NULL IST EINE ANTWORT:
// ob "kein Wunsch" (Feld weggelassen) oder "unbekannter Code" (400) gemeint ist,
// entscheidet der Aufrufer, nicht diese Funktion. Gross-/Kleinschreibung ist KEIN
// Nutzerfehler, sondern eine Schreibweise (dieselbe Haltung wie
// resolveOptionalEnumOverride fuer die Spracheinstellung, LANG-19); ein Regionszusatz
// ("de-DE", "pt-BR") ist dagegen eine eigene Behauptung und wird NICHT still gekuerzt.
export function supportedLanguageOf(wert) {
  if (typeof wert !== "string") return null;
  const code = wert.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.find((unterstuetzt) => unterstuetzt === code) ?? null;
}

// Der namensunabhaengige ANFANG des Offenlegungssatzes einer Sprache - alles vor dem
// Auftraggeber-Namen. Er ist der Massstab, an dem der Anrufstart-Waechter
// (elevenlabs/convai.js) eine pro Anruf gebaute Eroeffnung misst, OHNE den Namen zu
// kennen: der Name sind Tenant-Daten, der Pflichtsatz ist es nicht. EINE Ableitung fuer
// beide Leser (G5) - opening-line.js#DISCLOSURE_CORES setzt darauf auf.
const DISCLOSURE_NAME_SENTINEL = "\u0000";
export function disclosurePrefixFor(language) {
  return localeFor(language).disclosure(DISCLOSURE_NAME_SENTINEL).split(DISCLOSURE_NAME_SENTINEL)[0];
}

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
