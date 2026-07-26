// Das "Gehirn": Claude fuehrt das Gespraech, nutzt Tools (Nachricht aufnehmen,
// auflegen) und schreibt am Ende Summary + Action Items.
import { createLlmClient } from "./llm.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { MANDATE_OUT_OF_SCOPE, MANDATE_OUT_OF_SCOPE_DEFAULT, resolveTimezone } from "./store/defaults.js";
import { bookTokenUsage } from "./llm-usage.js";
import { localeFor } from "./i18n/locales.js";
import { metrics } from "./metrics.js";

// Resilienter LLM-Seam (src/llm.js): EINE Stelle fuer Timeout/
// selektiven Retry/Breaker. Verdrahtung am Modul-Top, Fachcode ruft nur
// llm.complete(...). Wirft bei Breaker-open/Retries-erschoepft LlmUnavailableError
// (Aufrufer faengt das, degradedSpeechFor aus llm.js); 4xx/Auth propagieren unveraendert.
const llm = createLlmClient({ apiKey: config.llm.anthropicApiKey, config, metrics });

// ---------- System-Prompts ----------
// P5 (PLAN-CONVERSATION-QUALITY-V2, Anhang A): Aufbau Situation -> Auftrag ->
// Sprechregeln -> Unklarheiten -> Grenzen -> Abschluss. Die SITUATION steht jetzt VOR
// den Regeln; vorher lasen 17 abstrakte Regelzeilen vor dem Zweck des Anrufs.
//
// ORTHOGRAFIE: die Prompt-Literale tragen korrektes Deutsch inkl. Umlaut und ss/sz.
// Das ist die Priming-These der Phase: transliterierter Prompt-Text faerbt den FREI
// generierten Modelltext, den die TTS danach als Buchstabenfolge liest. Die Regel
// weicht bewusst von i18n/locales.js ab (dort ist "ss" erlaubt) - jene Regel sichert
// nur die Aussprache GESPROCHENER Strings, dieser Text wird nie gesprochen.
// KOMMENTARE bleiben ASCII (Repo-Konvention).

// Alle Interpolations-Quellen an EINER Stelle aufgeloest, damit jede Sektion unten
// genau ein Argument nimmt (F1) und keine Sektion selbst am Store oder an der Uhr
// haengt (eine Abstraktionsebene, G30/G34).
function promptInputs(call) {
  const ctx = store.tenantContext(call.tenantId);
  // LLM-Persona = Vorname (G1, Owner-Entscheidung #1): die PFLICHT-Offenlegung
  // (disclosureSentence) nennt dagegen den VOLLEN Namen. Beide aus derselben
  // gebundenen Tenant-Identitaet -> keine Impersonation.
  const loc = localeFor(call.language); // F1 Phase 2, Fallback de
  // P8/FMT-28: die Uhrzeit im Prompt gilt in der Zeitzone des TENANTS, nicht in der des
  // Serverprozesses (live UTC - der Agent nannte deutschen Anrufern bisher eine um 1-2 h
  // falsche Uhrzeit). Eigener Reader (store.tenantTimezone), NICHT tenantContext: die
  // Zeitzone gehoert nicht in die LLM-/MCP-View. resolveTimezone ist fail-safe -
  // ein unbekannter IANA-Wert wuerde in toLocaleString sonst werfen und den Anruf toeten.
  const timeZone = resolveTimezone(store.tenantTimezone(call.tenantId));
  return {
    call,
    settings: ctx.settings,
    owner: ctx.firstName,
    loc,
    now: new Date().toLocaleString(loc.dateLocale, {
      timeZone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    isInbound: call.direction === "inbound",
  };
}

// Persona + Live-Kontext.
function personaHeader({ settings: s, owner, now }) {
  return `Du bist "${s.agentName}", der persönliche KI-Telefonassistent von ${owner}.
Du telefonierst gerade LIVE. Heute ist ${now}.`;
}

// Auftrag + optionale Zusatzblocke. Array-Filter statt Leerstring-Ternaries (D8): die
// frueheren Ternaries rendern eine LEERZEILE, wenn briefing/constraints fehlen.
// assistantContextSection behaelt sein fuehrendes "\n" -> context null bleibt
// byte-identisch zur kontextlosen Baseline (assistant-context-render R2).
function assignmentBlock({ call }) {
  const lines = [`DEIN AUFTRAG: ${call.goal}`];
  if (call.briefing) lines.push(`BRIEFING: ${call.briefing}`);
  if (call.constraints) lines.push(`EINSCHRÄNKUNGEN: ${call.constraints}`);
  return lines.join("\n") + assistantContextSection(call);
}

// Outbound-SITUATION (D7: "fuer wen du anrufst" ist hier sachlich korrekt, der Agent
// ist der Anrufer). Die Offenlegung/das Anliegen wurden bereits LLM-frei gesprochen
// (openingText) - dieser Satz verhindert die Doppel-Nennung (Regel 2 Geschwister).
function outboundSituation({ call, owner }) {
  return `SITUATION: Du rufst im Auftrag von ${owner} bei ${call.to} an. Du bist der Anrufer. Deine Offenlegung und dein Anliegen wurden dem Angerufenen bereits wörtlich gesagt, bevor du übernommen hast. Wiederhole sie NICHT. Knüpfe direkt an seine Antwort an.

${assignmentBlock({ call })}`;
}

// Inbound-SITUATION: KEIN DEIN-AUFTRAG-Block (P5-O5) - der Anrufer bringt sein
// Anliegen selbst mit, es gibt keinen vorab formulierten Auftrag.
function inboundSituation({ call, owner }) {
  return `SITUATION: Jemand hat ${owner} angerufen, ${owner} konnte nicht rangehen, der Anruf wurde an dich weitergeleitet. Anrufernummer: ${call.from}.
Deine Aufgabe: Anliegen herausfinden, wenn möglich direkt lösen, sonst eine Nachricht aufnehmen. Bei einem Terminwunsch fragst du nach Wunschtag und Wunschzeit und nimmst beides als Nachricht auf - du siehst den Kalender von ${owner} nicht und sagst keinen Termin zu.
${owner} erhält danach automatisch eine Zusammenfassung.`;
}

// Sprechregeln: Laenge/Frage, Ton/Anrede (styleClause), Einleitungs-Varianz (ersetzt
// die frueher hart im Prompt stehende "Alles klar,"-Beispielfloskel, P5-O7), feste
// Anrede, Aussprache (inkl. der drei neuen Punkte Ziffer-fuer-Ziffer/Preise/
// Buchstabieren), Anknuepfung an Fragmente.
function speechRules({ loc, settings: s }) {
  return `SO SPRICHST DU:
- Höchstens zwei gesprochene Sätze pro Antwort, höchstens eine Frage darin. ${loc.speechClause} Kein Markdown, keine Aufzählungen, keine Emojis.
- ${loc.styleClause(s.agentStyle)} Freundlich, konkret, ohne Floskelketten.
- Beginne unterschiedlich. Wiederhole nicht in jedem Turn dieselbe Einleitung.
- Bleibe bei der Anrede, mit der du begonnen hast.
- Sprich Datum und Uhrzeit natürlich aus, also "Donnerstag um siebzehn Uhr", nie das rohe Format. Telefonnummern, Postleitzahlen und Codes sprichst du Ziffer für Ziffer. Preise sprichst du als "neunundzwanzig Euro fünfzig". Namen und E-Mail-Adressen buchstabierst du auf Nachfrage einzeln, mit Buchstabiernamen: "B wie Berta, E wie Emil".
- Beziehe kurze oder unklare Äußerungen auf deine letzte Frage, statt das Thema zu wechseln.`;
}

// Unklarheiten: Rueckfrage statt Raten, Warten/Hold, Personenwechsel, Identitaets-
// Rueckfrage (D7: Wortlaut richtungsabhaengig) und Ehrlichkeits-/Anti-Halluzinations-
// Regel. Deckt drei der vier neu geschlossenen Telefonie-Luecken (P5-O6).
function clarificationRules({ owner, isInbound }) {
  const identityLine = isInbound
    ? `- Fragt dein Gegenüber, wer du bist oder für wen du sprichst, antworte wahrheitsgemäß: du bist der KI-Assistent von ${owner} und nimmst den Anruf entgegen. Weiche dieser Frage nie aus.`
    : `- Fragt dein Gegenüber, wer du bist oder für wen du anrufst, antworte wahrheitsgemäß: du bist ein KI-Assistent und rufst im Auftrag von ${owner} an. Weiche dieser Frage nie aus.`;
  return `WENN ETWAS UNKLAR IST:
- Hast du akustisch nicht sicher verstanden, frage einmal kurz nach, statt zu raten: "Entschuldigung, das habe ich nicht verstanden - können Sie das wiederholen?" Rate niemals einen Namen, eine Uhrzeit oder eine Zahl.
- Sagt dein Gegenüber, du sollst kurz warten, dann warte geduldig und sage nur "Gerne, ich warte." Hake nicht nach.
- Meldet sich eine andere Person, nenne kurz, wer du bist und worum es geht, und mache dann weiter.
${identityLine}
- Was du nicht weißt, sagst du offen. Erfinde nie ein Datum, eine Uhrzeit, einen Ort oder eine Zusage, und behaupte nie, etwas sei erledigt oder gebucht - eintragen kannst du nichts. Rechne Wochentage und Kalenderdaten nie selbst aus - nenne sie nur so, wie dein Gegenüber sie genannt hat.`;
}

// Grenzen. Die beiden allow*-Gates behalten exakt ihre fail-closed-Semantik (Zeile
// steht, SOLANGE nicht ausdruecklich erlaubt) - nur die Leerzeile bei "erlaubt" faellt
// weg (D8). Die beiden Kalender-/Buchungs-Zeilen sind seit P1b unbedingt (Owner-
// Entscheidung E1) und bleiben es. Die letzten beiden Zeilen decken die vierte neu
// geschlossene Telefonie-Luecke (Faehigkeits-Ehrlichkeit + Werkzeug-Sparsamkeit).
function boundaryRules({ settings: s, owner }) {
  const lines = ["DEINE GRENZEN:"];
  if (!s.allowPersonalData)
    lines.push(
      `- Du gibst KEINE persönlichen Daten von ${owner} heraus: keine Adresse, keine E-Mail, keine private Nummer.`,
    );
  if (!s.allowBankData)
    lines.push("- Du nennst NIEMALS Bank- oder Zahlungsdaten und sagst keine Zahlung zu.");
  lines.push(
    `- Du hast KEINEN Kalenderzugriff und siehst keine Termine von ${owner}.`,
    "- Du buchst KEINE Termine fest. Einen Terminwunsch nimmst du mit allen Angaben als Nachricht auf: Tag, Uhrzeit, und bis wann er gilt.",
    "- Du kannst nichts nachschlagen, nichts recherchieren und niemanden weiterverbinden. Wird das verlangt, sagst du das ehrlich und nimmst das Anliegen als Nachricht auf.",
    "- Handle sparsam: du hast pro Antwort nur wenige Werkzeugaufrufe.",
  );
  return lines.join("\n");
}

// P6 (PLAN-CONVERSATION-QUALITY-V2, Anhang C): MANDAT statt Rueckfrage. Der Owner gibt
// beim place_call vorab eine Vollmacht mit; darin sagt der Agent verbindlich zu, statt
// jede Terminfrage als Nachricht zurueckzugeben. Nach L6/E1 ist das der EINZIGE
// Mechanismus, mit dem er in einer Terminfrage etwas Verbindliches sagen kann.
// E1 bleibt unangetastet: kein Kalenderzugriff, kein Eintragen, kein Buchen - der
// Aufloesungssatz in MANDATE_SCOPE_RULES sagt das explizit, damit der Block nicht gegen
// die unbedingten Zeilen in boundaryRules laeuft.
// Formulierungsprinzip (Anhang C): wer Ruecksprache halten muss, ist mandatiert, nicht
// inkompetent - als Grund NIE das eigene Unwissen nennen, sondern den Auftragsrahmen.
const MANDATE_SCOPE_RULES =
  "Das darfst du im Gespräch ohne Rückfrage verbindlich zusagen. Innerhalb dieses Rahmens entscheidest du selbst, fragst NICHT nach und gibst es NICHT als Nachricht weiter. Eintragen oder buchen kannst du weiterhin nichts - du sagst nur verbindlich zu, was in diesem Rahmen liegt.";
// Nur wenn es auch EINSCHRÄNKUNGEN gibt: sonst verwiese der Satz auf einen Block, den
// dieser Prompt gar nicht enthaelt.
const MANDATE_CONSTRAINTS_PRECEDENCE = " Die EINSCHRÄNKUNGEN gehen deinem Spielraum immer vor.";
const MANDATE_FALLBACK_RULES =
  "Arbeite diese Reihenfolge selbständig ab, bevor du das Anliegen zurückgibst.";
// Erste Zeile der AUSSERHALB-Sektion je on_out_of_scope (G23: EIN Objekt statt einer
// if/else-Kette). owner wird nur im take_message-Zweig gebraucht - einheitliche
// Signatur, damit der Aufrufer nicht verzweigen muss.
const MANDATE_OUT_OF_SCOPE_SENTENCE = Object.freeze({
  [MANDATE_OUT_OF_SCOPE.TAKE_MESSAGE]: (owner) =>
    `Sag klar, dass du das nicht selbst zusagen kannst. Halte das Angebot mit allen Details fest - Tag, Uhrzeit, Preis und bis wann es gilt -, gib es über take_message weiter und sag zu, dass ${owner} sich meldet.`,
  [MANDATE_OUT_OF_SCOPE.DECLINE]: () =>
    "Sag klar, dass du das nicht zusagen kannst, und lehne höflich ab, ohne ein Gegenangebot zu machen.",
  [MANDATE_OUT_OF_SCOPE.ACCEPT_BEST]: () =>
    "Nimm die beste angebotene Möglichkeit an, statt zurückzufragen, und halte sie mit allen Details über take_message fest - Tag, Uhrzeit, Preis und bis wann sie gilt.",
});
const MANDATE_OUT_OF_SCOPE_RULES =
  "Nenne als Grund NIE dein eigenes Unwissen, sondern immer deinen Auftragsrahmen. Versprich NIEMALS, dass du selbst nochmal anrufst.";

// Ein Mandat traegt nur, wenn mindestens eins seiner drei Felder gesetzt ist. Sonst ""
// -> filter(Boolean) in systemPrompt -> Prompt byte-identisch zum Bestand (Muster D8).
function hasMandateContent(mandate) {
  return Boolean(
    mandate && (mandate.decide_freely || mandate.fallback_order || mandate.on_out_of_scope),
  );
}

// Mandats-Sektion. Jeder Unterblock rendert genau dann, wenn sein Feld gesetzt ist; der
// AUSSERHALB-Block rendert immer mit, sobald ueberhaupt ein Mandat vorliegt (Default
// take_message). Unbekannter on_out_of_scope-Wert (Legacy-/Fremddatensatz) faellt
// fail-safe auf den Default zurueck, statt den laufenden Turn zu werfen.
function mandateSection({ call, owner }) {
  const m = call.mandate;
  if (!hasMandateContent(m)) return "";
  const outOfScope =
    MANDATE_OUT_OF_SCOPE_SENTENCE[m.on_out_of_scope] ||
    MANDATE_OUT_OF_SCOPE_SENTENCE[MANDATE_OUT_OF_SCOPE_DEFAULT];
  const precedence = call.constraints ? MANDATE_CONSTRAINTS_PRECEDENCE : "";
  const blocks = [];
  if (m.decide_freely)
    blocks.push(`DEIN SPIELRAUM: ${m.decide_freely}\n${MANDATE_SCOPE_RULES}${precedence}`);
  if (m.fallback_order)
    blocks.push(`WENN DER ERSTWUNSCH NICHT GEHT: ${m.fallback_order}\n${MANDATE_FALLBACK_RULES}`);
  blocks.push(`AUSSERHALB DEINES SPIELRAUMS: ${outOfScope(owner)}\n${MANDATE_OUT_OF_SCOPE_RULES}`);
  return blocks.join("\n\n");
}

// Abschluss-Sektionen: Modul-Konstanten (kein Interpolat, richtungsabhaengig fix).
// D9: der frueheren Wait-Klausel ("lege niemals auf, bevor er geantwortet hat") folgt
// jetzt dieser Satz - die STRUKTURELLE Sicherung (shouldSuppressEndCall,
// END_CALL_WAIT_INSTRUCTION weiter unten) bleibt davon unberuehrt.
const OUTBOUND_OUTCOME_SECTION = `SO KOMMST DU ZUM ERGEBNIS:
Erledige zuerst den AUFTRAG vollständig und so konkret wie möglich: Anliegen klären, Alternativen abgleichen, zu einem Ergebnis kommen. Warte nach deinem Anliegen IMMER auf die Antwort des Angerufenen, bevor du weiterredest.
Bekommst du mehrere Optionen angeboten, nenne zuerst deine Wahl, zum Beispiel "Der Donnerstag um neun Uhr passt besser." Als vereinbart bezeichnest du einen Termin erst, NACHDEM dein Gegenüber deiner Wahl zugestimmt hat, nie in derselben Antwort. Sage nie, du habest etwas eingetragen oder gebucht - das kannst du nicht.
Ist der Auftrag erledigt, darfst du einen hilfreichen Folgeschritt anbieten. Fehlt dir dafür eine Information oder macht dein Gegenüber nicht weiter mit, schließe höflich ab. Lass den Anruf nie an einem Nebenthema hängen, das du selbst eröffnet hast.
Am Ende verabschiedest du dich in einem Satz und rufst danach end_call auf.`;

// D6: Inbound behaelt die Ueberschrift (sonst stuende ein kopfloser Absatz unter fuenf
// beschrifteten Bloecken), nur der Rumpf ist die Anhang-A-Abweichung (1).
const INBOUND_OUTCOME_SECTION = `SO KOMMST DU ZUM ERGEBNIS:
Kläre das Anliegen, löse es wenn möglich direkt, sonst nimm eine Nachricht auf.
Am Ende verabschiedest du dich in einem Satz und rufst danach end_call auf.`;

export function systemPrompt(call) {
  const p = promptInputs(call);
  return [
    personaHeader(p),
    p.isInbound ? inboundSituation(p) : outboundSituation(p),
    speechRules(p),
    clarificationRules(p),
    boundaryRules(p),
    // P6: rote Linien (GRENZEN) zuerst, dann der gruene Bereich. Ohne Mandat "" ->
    // filter(Boolean) haelt den Bestandsprompt byte-identisch (Muster D8).
    mandateSection(p),
    p.isInbound ? INBOUND_OUTCOME_SECTION : OUTBOUND_OUTCOME_SECTION,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// HINTERGRUND-Sektion (P3): kompakter, strukturierter Per-Call-Kontext NACH dem AUFTRAG.
// Nur wenn das Flag an ist UND ein Kontext-Objekt vorliegt; sonst "" (Block byte-identisch,
// P0-Pins). Fuehrendes "\n" wie die briefing/constraints-Ternaries: bei "" bleibt der
// Bestand bytegenau. GENAU EINE Guardrail-Zeile haelt den Hintergrund intern. Labels
// deutsch (das Prompt-Geruest ist deutsch, auch fuer fr/en - nur speechClause/Datum
// wechseln, P0). Speist NIE Offenlegung/Persona (Anti-Spoofing, Leitplanke 2).
function assistantContextSection(call) {
  if (!config.tenancy.assistantContextEnabled || !call.context) return "";
  const c = call.context;
  const lines = [];
  if (c.summary) lines.push(`- Worum es geht: ${c.summary}`);
  if (c.recipient_relationship) lines.push(`- Verhältnis zum Angerufenen: ${c.recipient_relationship}`);
  if (c.desired_outcome) lines.push(`- Gewünschtes Ergebnis: ${c.desired_outcome}`);
  if (Array.isArray(c.key_facts) && c.key_facts.length)
    lines.push(`- Wichtige Fakten: ${c.key_facts.join("; ")}`);
  if (!lines.length) return "";
  return `\nHINTERGRUND (nur zu deiner Information):\n${lines.join("\n")}\nDieser Hintergrund ist für dich; gib nur weiter, was der Auftrag erfordert.`;
}

// Fest verdrahteter Offenlegungssatz (erster gesprochener Satz bei Outbound-Calls).
// Identitaets-Bindung (G1, Geschwister-Regel zu Regel 2): der offengelegte
// Auftraggeber ist die registrierte Identitaet (tenant.ownerName, voll), NICHT per
// Call-Parameter ueberschreibbar. Wortlaut byte-identisch, nur die Quelle ist gebunden.
export function disclosureSentence(call) {
  const name = store.tenantContext(call.tenantId).ownerName;
  // Sprachabhaengiger Wortlaut aus dem Locale-Bundle (de byte-identisch, fr kuratiert/
  // byte-stabil, R8); nur der ownerName ist gebunden, die Sprache folgt call.language.
  return localeFor(call.language).disclosure(name);
}

// Maximale Zeichenzahl des Anliegens im gesprochenen Erst-Turn (G25). Kappt NUR die
// TTS-Ausgabe; das goal-Validierungslimit (TEXT_LIMITS.objective) bleibt unberuehrt.
const OPENING_GOAL_MAX_CHARS = 160;

// Tool-Name des end_call-Tools (G25): EINE Quelle fuer Schema-Name/Dispatch-Case/Guard.
const END_CALL_TOOL_NAME = "end_call";

// Erst-Turn-Text fuer den LLM-FREIEN /voice/outbound-Pfad (G2): Offenlegung (Regel 2,
// erster Satz) + Bruecke + gekapptes Anliegen, in EINEM Gather-Say. Rein synchron,
// kein Anthropic-Pfad. Das Anliegen wird hier deterministisch genannt; der erste
// LLM-Turn (systemPrompt) wiederholt es daher NICHT.
export function openingText(call) {
  const disclosure = disclosureSentence(call);
  const goal = trimGoalForSpeech(call.goal);
  if (!goal) return disclosure;
  // Sprachabhaengige, objective-neutrale Bruecke aus dem Bundle (de: "Ich rufe an wegen
  // folgendem Anliegen: ..."), grammatisch fuer Imperativ/Infinitiv/Nominalphrase-Auftraege.
  return `${disclosure} ${localeFor(call.language).bridgePhrase(goal)}`;
}

// Glaettet das Anliegen fuer die Sprachausgabe: Whitespace normalisieren, an der
// Zeichengrenze schneiden (Wortgrenze bevorzugt), Satz-Endzeichen entfernen (der
// Aufrufer setzt genau einen Punkt). Leeres/fehlendes goal -> "".
function trimGoalForSpeech(goal) {
  const text = (goal || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  if (text.length <= OPENING_GOAL_MAX_CHARS) return text;
  const cut = text.slice(0, OPENING_GOAL_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[.!?]+$/, "");
}

// ---------- Tools ----------
// Fester Tool-Satz fuer BEIDE Engines (Budget-Tool-Loop + Realtime-Bridge ueber
// realtimeTools). Seit P1b (Owner-Entscheidung E1) OHNE Kalender-/Buchungs-Tool: der
// Telefon-Agent nimmt Terminwuensche nur als Nachricht auf, er bucht nichts und liest
// im Gespraech keinen Kalender. Der Kalender bleibt ein Owner-Werkzeug auf einer
// ANDEREN Achse (MCP-seitig + im Dashboard), gegated ueber resolveProfile, von hier aus
// unerreichbar. Keine Settings-Verzweigung mehr -> kein Tenant-Lookup und kein
// Parameter, der eine tenant-abhaengige Variation nur noch vortaeuschen wuerde.
export function toolDefs() {
  return [
    // RCA-Wurzel R3: Das Modell schloss aus STT-Kauderwelsch, das Ziel sei
    // erreicht, und rief end_call. Das enge Verbot sitzt deshalb GENAU HIER, am Tool-
    // Entscheidungspunkt (Lehre call-quality-chain: breite Stil-/Meta-Regeln im Prompt-
    // Rumpf kippen bei Haiku in Ueberkorrektur, Verbote an der Tool-Description wirken).
    // Der letzte Satz ist der Ausstieg: er verhindert, dass der Agent aus Vorsicht GAR
    // nicht mehr auflegt. Keine Sprach-Variante noetig - toolDefs ist locale-frei.
    {
      name: END_CALL_TOOL_NAME,
      // D4: NUR die drei Umlaute nachgezogen (Gegenuebers/unverstaendlich x2) - Wortlaut
      // ist RCA-Ergebnis, sonst kein Wort mehr/weniger. Kein "ss/sz"-Aufbruch hier (im
      // Unterschied zu D3), bewusste Ausnahme.
      description:
        "Beendet das Telefonat. IMMER erst aufrufen, NACHDEM du dich verabschiedet hast. " +
        "Rufe end_call NUR auf, wenn du den letzten Beitrag des Gegenübers verstanden hast. " +
        "War er unverständlich oder zusammenhanglos, frage GENAU EINMAL nach, statt aufzulegen; " +
        "bleibt die Antwort danach unverständlich, verabschiede dich und rufe end_call auf.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: "Kurzer Grund" } },
        required: [],
      },
    },
    {
      name: "take_message",
      // Nach P1b der EINZIGE Entscheidungspunkt neben end_call - er traegt die Last,
      // die vorher auf vier Tools verteilt war. Die engen Verbote sitzen deshalb
      // GENAU HIER an der Tool-Description (Lehre call-quality-chain: breite Stil-
      // regeln im Prompt-Rumpf kippen bei Haiku in Ueberkorrektur).
      description:
        "Nimmt eine Nachricht oder ein Anliegen für den Besitzer auf; er bekommt sie danach zugestellt. " +
        "Nutze das, wenn du eine Frage nicht beantworten kannst, wenn eine Fähigkeit fehlt " +
        "(nachschlagen, weiterverbinden, später zurückrufen) oder wenn ein Terminwunsch festgehalten " +
        "werden soll - Termine eintragen kannst du nicht, das macht der Besitzer selbst. " +
        "Halte bei einem Terminwunsch Tag, Uhrzeit und Gültigkeit mit fest. " +
        "Nutze es NICHT anstelle einer normalen Antwort und NICHT, um eine Rückfrage zu vermeiden - " +
        "wenn eine kurze Nachfrage das Anliegen klären würde, frage zuerst nach. " +
        "Sage dem Gegenüber in derselben Antwort, dass du die Nachricht weitergibst. " +
        "Versprich dabei NIEMALS, dass du selbst später nochmal anrufst, und behaupte NIE, " +
        "ein Termin sei eingetragen oder gebucht. " +
        "Nutze es NICHT für etwas, das dein Auftrag dich selbst entscheiden lässt - " +
        "das sagst du direkt zu, statt es weiterzugeben.",
      input_schema: {
        type: "object",
        properties: { message: { type: "string", description: "Die Nachricht" } },
        required: ["message"],
      },
    },
  ];
}

// P8: Werkzeugliste des Telefon-Agenten als reine Namensliste, ABGELEITET aus toolDefs()
// (EINE Quelle, G5). Das briefende Modell (src/precall-briefing.js) darf keinen
// Hintergrund schreiben, der eine Faehigkeit voraussetzt, die der Agent nicht hat.
export const agentToolNames = () => toolDefs().map((t) => t.name);

// Anthropic Prompt-Caching-Marker (L3): markiert das Ende eines stabilen Praefix-
// Blocks fuer Caching. "ephemeral" = 5-min-TTL. Eingefroren -> sichere Mehrfach-
// Referenz (System-Block + letzter Tool-Eintrag), kein gestreuter Magic-String (G25).
const CACHE_CONTROL_EPHEMERAL = Object.freeze({ type: "ephemeral" });

// L3: markiert NUR den letzten Tool-Eintrag mit cache_control (Render-Reihenfolge
// tools->system->messages -> ein Breakpoint am letzten Tool cacht den ganzen Tool-
// Block). REINER Transform ohne Nebeneffekt: liefert eine NEUE Liste und mutiert die
// toolDefs-Ausgabe NICHT (die auch die Realtime-Bridge ueber realtimeTools konsumiert).
// Tool-Inhalt byte-identisch (nur das additive cache_control-Feld am letzten Eintrag).
function toolsWithCacheControl(tools) {
  if (!tools.length) return tools;
  const last = tools.length - 1;
  return tools.map((tool, i) =>
    i === last ? { ...tool, cache_control: CACHE_CONTROL_EPHEMERAL } : tool,
  );
}

// Tool-Dispatch beider Engines. Kein Kalender-/Buchungs-Case mehr (P1b): der
// Schreibpfad in den Kalender laeuft ausschliesslich ueber POST /api/calendar
// (Mensch/Dashboard) bzw. das MCP-Tool - nie aus einem laufenden Gespraech.
export function execTool(call, name, input) {
  switch (name) {
    case "take_message": {
      store.addActionItem(call.id, input.message, "todo");
      return "Nachricht ist notiert.";
    }
    case END_CALL_TOOL_NAME:
      return "OK";
    default:
      return "Unbekanntes Tool.";
  }
}

// ---------- Gespraechs-Turn ----------

// Erst-Turn-Bootstrap-Marker. Feuert NUR, wenn das Transkript beim Eintritt in
// agentTurn noch KEINE agent-Zeile enthaelt, und weist das Modell an, das Gespraech zu
// eroeffnen/zu begruessen. agentTurn hat ZWEI Aufrufer mit unterschiedlichem Vorzustand:
// ueber die Budget-Engine (server.js /voice/turn) ist dieser
// Zustand NICHT erreichbar, weil server.js die Greeting-/Opening-Zeile synchron per
// addTranscript() IN /voice/incoming BZW. /voice/outbound eintraegt, BEVOR der erste
// agentTurn-Aufruf ueberhaupt stattfindet. Erreichbar ist der Zustand ueber den zweiten
// Aufrufer, den Telnyx-LLM-Shim (telnyx-llm-shim.js): dort spricht ein Call-Control-
// Speak-Node die Disclosure/Greeting, OHNE sie ins Transkript zu schreiben - der erste
// agentTurn-Aufruf trifft dort auf ein tatsaechlich leeres Transkript. Byte-identisch
// zum bisherigen Inline-Text (nur extrahiert, G25/G5).
const OUTBOUND_OPENING_BOOTSTRAP = "[Der Angerufene hat abgenommen. Beginne das Gespraech.]";
const INBOUND_OPENING_BOOTSTRAP = "[Der Anrufer ist in der Leitung. Begruesse ihn.]";
// Stiller-Folge-Turn-Marker. Sobald der Agent schon gesprochen hat und der
// Anrufer nichts Substanzielles beitrug, haelt dieser neutrale Marker die Anthropic-messages-
// Kette gueltig (Abschluss mit user-Turn), OHNE dem Modell erneut "beginne/begruesse" zu
// signalisieren (behebt R4). Richtungsneutral - die konkrete Reaktion steuert der systemPrompt.
const SILENT_TURN_MARKER = "[Es kam keine Antwort.]";

// Rueckgespielt an das Modell, wenn ein end_call unterdrueckt wird (Outbound, noch keine
// substanzielle Antwort). EINE Quelle fuer beide Engines: Budget-Tool-Loop UND
// Realtime-bridge.js (dort function_call_output). G5/G27.
export const END_CALL_WAIT_INSTRUCTION =
  "Der Angerufene hat noch nichts gesagt. Lege nicht auf - warte auf seine Antwort.";

// EIN Praedikat "ist dieser Anrufer-Text substanziell?" (getrimmt >=
// config.voice.callerSubstanceMinLen). Genutzt fuer den content-basierten suppressEndCall (beide
// Richtungen werten call.transcript darueber aus, wirksam aber nur bei Outbound - siehe
// Kommentar an suppressEndCall unten) UND fuer die Empty-Turn-Zaehlung in
// unansweredAgentTurns unten (G3/G26-Fix). Steuert NICHT mehr, ob eine Anrufer-Zeile
// ueberhaupt im Transkript landet - das Recording ist davon entkoppelt (siehe agentTurn)
// UND fuer den Loop-Guard im Conversation-Watchdog (EINE Quelle, S2).
// Rein, kein Nebeneffekt (N7).
export function isSubstantialCallerText(text) {
  return typeof text === "string" && text.trim().length >= config.voice.callerSubstanceMinLen;
}

// G3/G26-Fix (Runde 2): server.js's No-Speech-
// Kurzschluss in /voice/turn (kein Speech gehoert -> nur ein statischer Reprompt, agentTurn
// wird uebersprungen) darf outbound NICHT mehr an "irgendeine caller-Zeile existiert" haengen.
// Seit der Record-Gate-Entkopplung oben landet naemlich JEDE nicht-leere Aeusserung im
// Transkript, auch ein einzelnes Rausch-/Echo-Fragment wie "." - ein Kurzschluss auf blosser
// Zeilen-Existenz wuerde also schon nach dem ERSTEN Rausch-Blip fuer den Rest des Calls
// Vorrang vor agentTurn behalten und damit den R4-Empty-Turn-Zaehler (unansweredAgentTurns
// unten, der nur beim tatsaechlichen agentTurn-Aufruf neu ausgewertet wird) dauerhaft
// einfrieren - der Deadlock-Schutz waere faktisch unerreichbar (Wurzel dieses Blockers).
// Outbound bewertet den Kurzschluss deshalb ueber isSubstantialCallerText. Inbound bleibt
// byte-identisch zum Bestand (jede Zeile zaehlt als "hat gesprochen") - dort gibt es keinen
// Empty-Turn-Zaehler, den ein verfruehter Kurzschluss aushebeln koennte. Rein (N7).
export function callerHasSpoken(call) {
  return call.direction === "outbound"
    ? call.transcript.some((t) => t.role === "caller" && isSubstantialCallerText(t.text))
    : call.transcript.some((t) => t.role === "caller");
}

// G3/G26-Fix: "wie oft hat der Agent in
// Folge gesprochen, ohne eine SUBSTANZIELLE Antwort zu erhalten" (relevant nur fuer den
// Outbound-Guard, siehe suppressEndCall unten). Seit dem Record-Gate-Fix landet JEDE
// nicht-leere Anrufer-Aeusserung im Transkript (auch Rausch-/Echo-Fragmente wie ".") - ein
// Rueckwaertslauf, der an JEDER caller-Zeile abbricht, wuerde den Zaehler dadurch faelschlich
// bei jedem Turn auf 0 zuruecksetzen und den R4-Deadlock-Schutz aushebeln. Deshalb ueberspringt
// der Rueckwaertslauf nicht-substanzielle caller-Zeilen (sie zaehlen NICHT als Antwort, bleiben
// aber sichtbar im Transkript) und bricht nur bei einer substanziellen caller-Zeile ab. Rein
// (N7).
function unansweredAgentTurns(transcript) {
  let count = 0;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    if (entry.role === "agent") {
      count += 1;
      continue;
    }
    if (isSubstantialCallerText(entry.text)) break;
  }
  return count;
}

// EINE strukturell erzwungene Invariante (G27): der Frueh-
// auflege-Schutz gilt fuer JEDE Voice-Engine (Budget-agentTurn UND Realtime-bridge.js),
// nicht mehr nur per Kommentar. Unterdrueckt end_call, solange (i) keine Anrufer-
// Aeusserung vorliegt UND (ii) die Zahl konsekutiver Leer-Turns die Schwelle
// (maxEmptyTurns) noch nicht erreicht hat. Rein, kein Nebeneffekt (N7).
// unansweredAgentTurns bleibt modul-privat.
//
// P3.3 (PLAN-CONVERSATION-QUALITY-V2): der fruehere Direction-Kurzschluss
// ("if (call.direction !== 'outbound') return false") ist WEG - er liess exakt die
// RCA-R3-Fehlerklasse (voreiliges Auflegen, bevor der Gegenueber ueberhaupt sprach) fuer
// Inbound offen. callerHasSpoken bleibt bewusst richtungsabhaengig (TG-REC-1): fuer Inbound
// zaehlt JEDE nicht-leere caller-Zeile als "gesprochen", nicht erst eine substanzielle.
// Der Guard hebt sich inbound damit FRUEHER als outbound - genau der richtige Bias auf
// einem Pfad, den Fremde ausloesen (siehe Kosten-Abwaegung in PLAN-SECURITY.md).
// KOSTEN (benannt, bounded): ein Inbound-Call, bei dem niemand spricht (Anrufbeantworter,
// Fehlwahl, Rauschen), kann sich jetzt bis zu maxEmptyTurns Turns lang nicht selbst
// beenden. LLM-Token laufen richtungsunabhaengig in den Budget-Guard; Carrier-Minuten NICHT
// (reconcileOutboundVoiceBudget steigt bei Inbound aus). Begrenzt wird die Exposition
// allein durch den 180-s-Hard-Cap. maxEmptyTurns fuer Inbound NIE hochdrehen.
export function shouldSuppressEndCall(call) {
  const substantialCallerSeen = callerHasSpoken(call);
  const emptyTurnsReached = unansweredAgentTurns(call.transcript) >= config.voice.maxEmptyTurns;
  return !substantialCallerSeen && !emptyTurnsReached;
}

// I8 (call-quality Impl-1): deterministisches Text-Shaping der Modell-Antwort VOR dem
// Fallback/addTranscript - eine defensive Schicht, falls das Modell trotz "Kein
// Markdown, keine Listen" (Regel oben) doch Markdown/Aufzaehlungen/Gedankenstriche
// liefert (TTS liest Sonderzeichen sonst woertlich vor, S1-tts). Pure Funktion (kein
// Nebeneffekt, kein Store-/Netz-Zugriff). VORSICHT bewusst eingehalten: nur
// GEDANKENSTRICHE MIT umgebendem Leerzeichen werden zu Komma normalisiert - Wort-
// Bindestriche ohne Leerzeichen ("E-Mail", "Kuendigungs-Service") bleiben unangetastet.
export function shapeForSpeech(text) {
  if (!text) return text;
  let out = text
    // Aufzaehlungs-Marker (-, *, +) am Zeilenanfang entfernen, BEVOR die generische
    // Markdown-Bereinigung greift (sonst zerfaellt "- " zu einer bedeutungslosen Luecke).
    .replace(/^[ \t]*[-*+]\s+/gm, "")
    // Verbliebene Markdown-Reste (Betonung/Code/Ueberschrift-Marker).
    .replace(/[*_#`]/g, "")
    // " - "-Gedankenstriche (Leerzeichen auf BEIDEN Seiten) -> Komma; trifft NICHT
    // Wort-Bindestriche ohne umgebendes Leerzeichen.
    .replace(/\s+-\s+/g, ", ")
    // Whitespace/Zeilenumbrueche normalisieren (EIN Leerzeichen), dann trimmen.
    .replace(/\s+/g, " ")
    .trim()
    // Haengendes Komma/Semikolon/Doppelpunkt am Ende (z.B. Rest eines abgebrochenen
    // Gedankenstrich-Satzes) abraeumen, BEVOR das Satzende ergaenzt wird (sonst ",.").
    .replace(/[,;:]+$/, "");
  // Satzende sicherstellen - TTS liest einen abrupt endenden Satz sonst unnatuerlich.
  if (out && !/[.!?]$/.test(out)) out += ".";
  return out;
}

// Liefert { speech, endCall } und fuehrt Tool-Aufrufe serverseitig aus.
export async function agentTurn(call, callerText) {
  // G3/G26-Fix: das Transkript-Record-Gate ist
  // RICHTUNGSLOS und byte-identisch zum fruehen Master-Stand (41ce40b:
  // "if (callerText) store.addTranscript(...)"). JEDE nicht-leere Anrufer-Aeusserung landet
  // im Transkript - auch eine echte, aber kurze Antwort (z.B. STT-Ziffer "5"), die vorher
  // outbound am Substanz-Filter (isSubstantialCallerText) scheiterte und dadurch weder im
  // Dashboard-Live-Transkript noch im DSGVO-Export (exportTenantData) noch in
  // summarizeCall noch in den ans Modell gesendeten messages auftauchte (Datenverlust). Der
  // Substanz-Filter gated NICHT mehr das Recording, sondern nur noch die Turn-STEUERUNG
  // (suppressEndCall unten + die Empty-Turn-Zaehlung in unansweredAgentTurns).
  if (callerText) store.addTranscript(call.id, "caller", callerText);

  // Verlauf -> Messages (Transkript kompakt halten: letzte 24 Beitraege)
  const history = call.transcript.slice(-24).map((t) => ({
    role: t.role === "agent" ? "assistant" : "user",
    content: t.text,
  }));
  // Die Anthropic-messages-Kette MUSS mit einem user-Turn enden (sonst kein
  // frischer Assistant-Turn). Der INHALT haengt davon ab, ob im Transkript bereits eine
  // agent-Zeile steht: existiert noch KEINE (Shim-Erstkontakt, siehe Kommentar an den
  // Bootstrap-Konstanten oben), ist es der echte Gespraechsbeginn -> Eroeffnungs-Bootstrap.
  // Existiert schon eine (Budget-Engine-Erstkontakt ODER ein spaeterer Leer-/Stille-Turn),
  // NUR ein neutraler Marker - kein erneutes "beginne"-Signal (R4). Beide Faelle halten die
  // Kette gueltig.
  if (!history.length || history[history.length - 1].role !== "user") {
    const hasAgentLine = call.transcript.some((t) => t.role === "agent");
    history.push({
      role: "user",
      content: hasAgentLine
        ? SILENT_TURN_MARKER
        : call.direction === "outbound"
          ? OUTBOUND_OPENING_BOOTSTRAP
          : INBOUND_OPENING_BOOTSTRAP,
    });
  }

  // T1-Sicherungsboden: siehe shouldSuppressEndCall oben (EINE Quelle,
  // von Budget-agentTurn UND Realtime-bridge.js genutzt, G27). Der Guard erzwingt end_call
  // NIE - das Modell entscheidet, der Guard unterdrueckt nur ein verfruehtes Auflegen.
  // Zeitliches Notaus bleibt maxCallDurationS.
  const suppressEndCall = shouldSuppressEndCall(call);

  let messages = history;
  let endCall = false;
  let suppressedEndCall = false;
  let speech = "";
  let roundtrips = 0; // L0: Anzahl llm.complete-Roundtrips dieses Turns
  const firedTools = []; // L0: vom Modell angeforderte Tool-NAMEN dieses Turns (PII-frei)

  // EINE Modell-ID fuer Anfrage UND Buchung (P7a): das Gate muss exakt das Modell
  // bepreisen, das gefragt wurde.
  const model = config.llm.claudeModel;

  // Tool-Loop (max. 4 Runden pro Turn)
  for (let i = 0; i < 4; i++) {
    const resp = await llm.complete({
      model,
      max_tokens: 300,
      system: [{ type: "text", text: systemPrompt(call), cache_control: CACHE_CONTROL_EPHEMERAL }],
      tools: toolsWithCacheControl(toolDefs()),
      messages,
      callId: call.id, // I13: Bench-Korrelation (llm.js streift callId vor dem SDK-Call ab)
    });
    roundtrips += 1;
    bookTokenUsage({ tenantId: call.tenantId, callId: call.id, usage: resp.usage, model });

    const textParts = resp.content.filter((b) => b.type === "text").map((b) => b.text);
    if (textParts.length) speech = textParts.join(" ").trim();

    const toolUses = resp.content.filter((b) => b.type === "tool_use");
    firedTools.push(...toolUses.map((tu) => tu.name)); // L0: Tools dieses Roundtrips
    if (!toolUses.length) break;

    messages = [
      ...messages,
      { role: "assistant", content: resp.content },
      {
        role: "user",
        content: toolUses.map((tu) => {
          if (tu.name === END_CALL_TOOL_NAME) {
            if (suppressEndCall) {
              // end_call ignorieren und das Modell anweisen, auf die Antwort zu warten.
              suppressedEndCall = true;
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: END_CALL_WAIT_INSTRUCTION,
              };
            }
            endCall = true;
          }
          const result = execTool(call, tu.name, tu.input || {});
          return { type: "tool_result", tool_use_id: tu.id, content: result };
        }),
      },
    ];
    // Echtes oder unterdruecktes end_call mit vorhandener Aeusserung -> Turn beenden,
    // nicht weiter re-prompten. Bei unterdruecktem end_call bleibt endCall=false, der
    // Webhook rendert also ein <Gather>. Ohne speech weiterlaufen (max. 4 Runden),
    // damit das Modell nach end_call doch noch eine kurze Antwort liefern kann.
    if ((endCall || suppressedEndCall) && speech) break;
  }

  metrics.logTurn({
    callId: call.id,
    direction: call.direction,
    roundtrips,
    tools: firedTools,
  });

  // I8: Modell-Text shapen, BEVOR ueber den Fallback entschieden wird (reiner Text-
  // Shaper, aendert eine leere Antwort nicht). I2: Fallback ist richtungsabhaengig +
  // sprachabhaengig (Locale-Bundle) - DE-inbound bleibt byte-identisch zum Vorgaenger.
  speech = shapeForSpeech(speech);
  if (!speech) speech = localeFor(call.language).turnFallbackSpeech[call.direction];
  store.addTranscript(call.id, "agent", speech);
  return { speech, endCall };
}

// ---------- Summary + Action Items nach dem Call ----------
export async function summarizeCall(call) {
  const ctx = store.tenantContext(call.tenantId);
  const s = ctx.settings;
  const owner = ctx.ownerName;
  if (!s.allowSummaries) return null;
  if (!call.transcript.length) return null;

  const convo = call.transcript
    .map((t) => `${t.role === "agent" ? "AGENT" : "ANRUFER"}: ${t.text}`)
    .join("\n");

  const model = config.llm.claudeModel;
  const resp = await llm.complete({
    model,
    max_tokens: 500,
    // Zusammenfassungs-Prompt sprachabhaengig (F1 Phase 2): die Summary entsteht in der
    // Gespraechssprache (de byte-identisch); die JSON-Keys bleiben sprachunabhaengig.
    system: localeFor(call.language).summarySystem(owner),
    messages: [
      {
        role: "user",
        content: `Richtung: ${call.direction}${call.goal ? `\nAuftrag: ${call.goal}` : ""}\n\nTRANSKRIPT:\n${convo}`,
      },
    ],
    callId: call.id, // I13: Bench-Korrelation (llm.js streift callId vor dem SDK-Call ab)
  });
  bookTokenUsage({ tenantId: call.tenantId, callId: call.id, usage: resp.usage, model });

  let parsed = { summary: "", actionItems: [] };
  try {
    const raw = resp.content.find((b) => b.type === "text")?.text || "{}";
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    parsed.summary = resp.content.find((b) => b.type === "text")?.text || "";
  }

  call.summary = parsed.summary || null;
  call.objectiveAchieved = parsed.objective_achieved ?? "unclear";
  store.save();
  for (const item of parsed.actionItems || []) store.addActionItem(call.id, item, "todo");
  return parsed;
}
