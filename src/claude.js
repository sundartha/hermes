// Das "Gehirn": Claude fuehrt das Gespraech, nutzt Tools (Nachricht aufnehmen,
// auflegen) und schreibt am Ende Summary + Action Items.
import { attemptReachedProvider, createLlmClient } from "./llm.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { CONSULT_WAIT, MANDATE_OUT_OF_SCOPE_DEFAULT, resolveTimezone } from "./store/defaults.js";
import { bookTokenUsage, estimatedAbortUsage } from "./llm-usage.js";
import { makeSentenceChunker } from "./speech-chunker.js";
import { makeThinkingSignal } from "./thinking-signal.js";
import { shapeForSpeech } from "./speech-shape.js";
import { localeFor } from "./i18n/locales.js";
import { metrics } from "./metrics.js";
import { MAX_TOOL_ROUNDS_PER_TURN, roundFitsDeadline, turnLoopDeadlineMs } from "./turn-budget.js";
import { blockingBudgetAxis } from "./budget-gate.js";
import { evidenceRetentionEnabled, normalizeCallResult } from "./call-result.js";
import { budgetedMemoryLines } from "./call-memory.js";
import { clampAtWordBoundary } from "./utils/text.js";
import {
  GET_CONSULT_TOOL_NAME,
  advanceConsultWait,
  consultAvailableFor,
  decideConsultRequest,
} from "./consult/in-call.js";

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
    // AL-P12: Beziehungsgedaechtnis als aufgeloeste Eingabe wie alles andere hier - keine
    // Sektion haengt selbst am Store (F1/G34). Der Tenant-Gate sitzt in
    // store.counterpartyMemory (fail-closed); ohne Freigabe kostet der Aufruf einen
    // Boolean-Vergleich, keinen Scan.
    memory: counterpartyMemoryFor(call),
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

// Die Gegenstelle eines Calls ist NUR bei Outbound `call.to`; bei Inbound ist `to` die
// EIGENE Nummer des Tenants - sie als Gegenstellen-Schluessel zu lesen wuerde dem Agenten
// die Notizen ueber sich selbst vorlegen. Der Gedaechtnis-Block rendert ohnehin nur im
// Outbound-Zweig (er haengt am AUFTRAG-Block); diese Zeile macht die Regel strukturell
// statt implizit. Rein bis auf den Store-Lesezugriff.
function counterpartyMemoryFor(call) {
  if (call.direction !== "outbound") return [];
  return store.counterpartyMemory(call.tenantId, call.to);
}

// Persona + Live-Kontext. Text kommt aus dem Sprach-Baustein (loc.prompt, P11) - hier
// bleibt nur die Weiterreichung, keine Verzweigungslogik (G5/S2).
function personaHeader(p) {
  return p.loc.prompt.persona(p);
}

// Auftrag + optionale Zusatzblocke. Array-Filter statt Leerstring-Ternaries (D8): die
// frueheren Ternaries rendern eine LEERZEILE, wenn briefing/constraints fehlen.
// assistantContextSection behaelt sein fuehrendes "\n" -> context null bleibt
// byte-identisch zur kontextlosen Baseline (assistant-context-render R2). Die Labels
// (goalLabel/briefingLabel/constraintsLabel) kommen aus dem Sprach-Baustein (P11).
// callMemorySection folgt derselben Regel wie assistantContextSection - fuehrendes "\n",
// leerer String ohne Inhalt, damit der Bestandsprompt byte-identisch bleibt.
function assignmentBlock(p) {
  const { call, loc } = p;
  const t = loc.prompt;
  const lines = [`${t.goalLabel} ${call.goal}`];
  if (call.briefing) lines.push(`${t.briefingLabel} ${call.briefing}`);
  if (call.constraints) lines.push(`${t.constraintsLabel} ${call.constraints}`);
  return lines.join("\n") + assistantContextSection(p) + callMemorySection(p);
}

// Outbound-SITUATION (D7: "fuer wen du anrufst" ist hier sachlich korrekt, der Agent
// ist der Anrufer). Die Offenlegung/das Anliegen wurden bereits LLM-frei gesprochen
// (openingText) - dieser Satz verhindert die Doppel-Nennung (Regel 2 Geschwister). Der
// SITUATION-Satz selbst kommt aus dem Sprach-Baustein; die Zusammensetzung mit dem
// Auftragsblock bleibt hier (P11 D1: der Sprach-Baustein kennt assignmentBlock nicht).
function outboundSituation(p) {
  return `${p.loc.prompt.situationOutbound(p)}\n\n${assignmentBlock(p)}`;
}

// Inbound-SITUATION: KEIN DEIN-AUFTRAG-Block (P5-O5) - der Anrufer bringt sein
// Anliegen selbst mit, es gibt keinen vorab formulierten Auftrag.
function inboundSituation(p) {
  return p.loc.prompt.situationInbound(p);
}

// Sprechregeln: Laenge/Frage, Ton/Anrede (styleClause), Einleitungs-Varianz (ersetzt
// die frueher hart im Prompt stehende "Alles klar,"-Beispielfloskel, P5-O7), feste
// Anrede, Aussprache (inkl. der drei neuen Punkte Ziffer-fuer-Ziffer/Preise/
// Buchstabieren), Anknuepfung an Fragmente. Text kommt aus dem Sprach-Baustein (P11).
function speechRules(p) {
  return p.loc.prompt.speechRules(p);
}

// Unklarheiten: Rueckfrage statt Raten, Warten/Hold, Personenwechsel, Identitaets-
// Rueckfrage (D7: Wortlaut richtungsabhaengig) und Ehrlichkeits-/Anti-Halluzinations-
// Regel. Deckt drei der vier neu geschlossenen Telefonie-Luecken (P5-O6). Text kommt
// aus dem Sprach-Baustein (P11).
function clarificationRules(p) {
  return p.loc.prompt.clarificationRules(p);
}

// Grenzen. Die beiden allow*-Gates behalten exakt ihre fail-closed-Semantik (Zeile
// steht, SOLANGE nicht ausdruecklich erlaubt) - nur die Leerzeile bei "erlaubt" faellt
// weg (D8). Die beiden Kalender-/Buchungs-Zeilen sind seit P1b unbedingt (Owner-
// Entscheidung E1) und bleiben es. Die letzten beiden Zeilen decken die vierte neu
// geschlossene Telefonie-Luecke (Faehigkeits-Ehrlichkeit + Werkzeug-Sparsamkeit). Die
// Verzweigung bleibt hier (EINE Quelle, P11 D1) - nur die Zeilen kommen aus dem
// Sprach-Baustein.
function boundaryRules({ loc, settings: s, owner }) {
  const b = loc.prompt.boundaries;
  const lines = [b.heading];
  if (!s.allowPersonalData) lines.push(b.personalData(owner));
  if (!s.allowBankData) lines.push(b.bankData);
  lines.push(b.noCalendar(owner), b.noBooking, b.noLookup, b.toolThrift);
  return lines.join("\n");
}

// P6 (PLAN-CONVERSATION-QUALITY-V2, Anhang C): MANDAT statt Rueckfrage. Der Owner gibt
// beim place_call vorab eine Vollmacht mit; darin sagt der Agent verbindlich zu, statt
// jede Terminfrage als Nachricht zurueckzugeben. Nach L6/E1 ist das der EINZIGE
// Mechanismus, mit dem er in einer Terminfrage etwas Verbindliches sagen kann.
// E1 bleibt unangetastet: kein Kalenderzugriff, kein Eintragen, kein Buchen - der
// Aufloesungssatz in mp.scopeRules sagt das explizit, damit der Block nicht gegen die
// unbedingten Zeilen in boundaryRules laeuft. P11: die Texte kommen aus dem
// Sprach-Baustein (loc.prompt.mandate), die Verzweigung bleibt hier (G5/S2).

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
// fail-safe auf den Default zurueck, statt den laufenden Turn zu werfen. Texte kommen
// aus dem Sprach-Baustein (loc.prompt.mandate, P11).
function mandateSection({ call, owner, loc }) {
  const m = call.mandate;
  if (!hasMandateContent(m)) return "";
  const mp = loc.prompt.mandate;
  const outOfScope = mp.outOfScopeSentence[m.on_out_of_scope] || mp.outOfScopeSentence[MANDATE_OUT_OF_SCOPE_DEFAULT];
  const precedence = call.constraints ? mp.constraintsPrecedence : "";
  const blocks = [];
  if (m.decide_freely) blocks.push(`${mp.scopeLabel} ${m.decide_freely}\n${mp.scopeRules}${precedence}`);
  if (m.fallback_order) blocks.push(`${mp.fallbackLabel} ${m.fallback_order}\n${mp.fallbackRules}`);
  blocks.push(`${mp.outOfScopeLabel} ${outOfScope(owner)}\n${mp.outOfScopeRules}`);
  return blocks.join("\n\n");
}

// AL-P7b (Weg A): die Regel fuer den Ueberbrueckungssatz. Flag aus -> "" -> filter(Boolean)
// in systemPrompt haelt den Bestandsprompt byte-identisch (Muster mandateSection/D8). Die
// Sprachbindung traegt der Prompt-Sprachvertrag (loc.prompt.thinkingSignal) - auf Weg A ist
// das Locale-Buendel der gesprochenen Saetze NICHT die Quelle des Fuellers.
function thinkingSignalRules(p) {
  return config.voice.thinkingSignalEnabled ? p.loc.prompt.thinkingSignal : "";
}

export function systemPrompt(call) {
  const p = promptInputs(call);
  return [
    personaHeader(p),
    p.isInbound ? inboundSituation(p) : outboundSituation(p),
    speechRules(p),
    clarificationRules(p),
    boundaryRules(p),
    // AL-P7b: steht direkt hinter den GRENZEN, weil es eine Regel ueber das Verhalten AM
    // Werkzeugaufruf ist (Nachbar von toolThrift). Flag aus -> "" -> Prompt byte-identisch.
    thinkingSignalRules(p),
    // P6: rote Linien (GRENZEN) zuerst, dann der gruene Bereich. Ohne Mandat "" ->
    // filter(Boolean) haelt den Bestandsprompt byte-identisch (Muster D8).
    mandateSection(p),
    p.isInbound ? p.loc.prompt.outcomeInbound : p.loc.prompt.outcomeOutbound,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// HINTERGRUND-Sektion (P3): kompakter, strukturierter Per-Call-Kontext NACH dem AUFTRAG.
// Nur wenn das Flag an ist UND ein Kontext-Objekt vorliegt; sonst "" (Block byte-identisch,
// P0-Pins). Fuehrendes "\n" wie die briefing/constraints-Ternaries: bei "" bleibt der
// Bestand bytegenau. GENAU EINE Guardrail-Zeile haelt den Hintergrund intern. Labels
// kommen aus dem Sprach-Baustein (loc.prompt.background, P11). Speist NIE Offenlegung/
// Persona (Anti-Spoofing, Leitplanke 2).
function assistantContextSection({ call, loc }) {
  if (!config.tenancy.assistantContextEnabled || !call.context) return "";
  const c = call.context;
  const b = loc.prompt.background;
  const lines = [];
  if (c.summary) lines.push(`${b.summary}${c.summary}`);
  if (c.recipient_relationship) lines.push(`${b.relationship}${c.recipient_relationship}`);
  if (c.desired_outcome) lines.push(`${b.outcome}${c.desired_outcome}`);
  if (Array.isArray(c.key_facts) && c.key_facts.length) lines.push(`${b.facts}${c.key_facts.join("; ")}`);
  if (!lines.length) return "";
  return `\n${b.heading}\n${lines.join("\n")}\n${b.guardrail}`;
}

// WAS-BISHER-GESCHAH-Sektion (AL-P12): die Ergebnisse/Fakten der letzten Anrufe an
// dieselbe Nummer. Strukturell an drei Bedingungen gebunden, von denen KEINE hier liegt:
// Richtung (nur outboundSituation rendert diesen Block), Tenant-Freigabe
// (store.counterpartyMemory) und Budget (budgetedMemoryLines). Hier bleibt nur die
// Zusammensetzung - dieselbe Form wie assistantContextSection: fuehrendes "\n", ""
// wenn nichts zu sagen ist, damit der Bestandsprompt byte-identisch bleibt.
// Die Guardrail-Zeile ist der Injektions-Riegel: der Inhalt stammt aus fremder Rede und
// ist ausdruecklich Information, keine Anweisung.
function callMemorySection({ memory, loc }) {
  const lines = budgetedMemoryLines(memory);
  if (!lines.length) return "";
  const m = loc.prompt.memory;
  return `\n${m.heading}\n${lines.map((line) => `${m.entryPrefix}${line}`).join("\n")}\n${m.guardrail}`;
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
// AL-P5 (PLAN-ASSISTANT-LEAP.md, Phase 5): 160 -> 75. Das ununterbrechbare Fenster am
// Anfang ist die Sekunde, in der Menschen auflegen. Es besteht aus Offenlegung (DE 129
// Zeichen, unveraenderlich - Regel 2/O2) + Bruecke (22) + diesem Anliegen: 160 ergab bis
// 314 Zeichen (~16-18 s bei den in AL-P1 gemessenen 17,3-20,3 Zeichen/s), 75 ergibt
// hoechstens 229 (~11-13 s). URSPRUENGLICH stand hier 70, mit der Begruendung "bei 60
// verlieren reale Auftraege ihr Verb, bei 70 nicht". Das war falsch: gegen den in
// test/al-p5-opening.test.js gepinnten Auftrag "Naechsten freien Termin fuer einen
// Herrenhaarschnitt bei Petra vereinbaren" (74 Zeichen) verliert auch die Kappe 70 das
// Verb ("vereinbaren"). 75 ist die kleinste Kappe, bei der alle im Test gepinnten
// Grenzfaelle - Bruecken-Auftraege UND der Ich-/Je-/I-Passthrough-Zweig aus
// bridgePhrase (Ich-Saetze werden woertlich gesprochen, MCP-Kontrakt in mcp-tools.js) -
// ihr zweck-tragendes Verb/Objekt behalten (test/al-p5-opening.test.js AL-P5-1). Klingt
// der Erst-Turn live trotzdem unvollstaendig, wird DIESE Zahl angehoben - nie die
// Nicht-Wiederholen-Anweisung in situationOutbound (die traegt den RCA-Fix R5/stab-p8).
const OPENING_GOAL_MAX_CHARS = 75;

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
  return clampAtWordBoundary(text, OPENING_GOAL_MAX_CHARS).replace(/[.!?]+$/, "");
}

// ---------- Tools ----------
// Tool-Name des take_message-Tools (G25, P11): der Name wird jetzt an drei Stellen
// gebraucht (Schema, Dispatch, Test) - EINE Quelle statt eines zweiten Literals.
const TAKE_MESSAGE_TOOL_NAME = "take_message";

// AL-P4: die zwei Werkzeug-KLASSEN des Tool-Loops (G25, EINE Quelle).
// nur-Seiteneffekt = das tool_result traegt KEINE Information, auf die das Modell noch
// antworten muesste (end_call -> "OK", take_message -> "Nachricht ist notiert."). Genau
// dann darf der Loop nach diesem Roundtrip enden, sobald bereits Text vorliegt - der
// zweite llm.complete-Roundtrip war reine Latenz.
// informationsliefernd = alles NICHT Gelistete. get_consult (AL-P14) gehoert bewusst
// NICHT in diese Liste: es beendet den Turn selbst und darf den Ausstieg der Runde
// nicht ueber die Seiteneffekt-Regel steuern.
// Die Liste ist bewusst eine NAMENS-Liste und kein Feld an den toolDefs-Objekten: die
// gehen 1:1 an Anthropic (agentTurn) UND an die Realtime-API (bridge.js realtimeTools),
// ein Zusatzfeld waere dort ein unbekanntes Schema-Feld.
// Fail-safe-Richtung: ein UNBEKANNTER Name gilt als informationsliefernd -> der Loop
// laeuft weiter wie im Bestand.
const SIDE_EFFECT_ONLY_TOOL_NAMES = Object.freeze(
  new Set([END_CALL_TOOL_NAME, TAKE_MESSAGE_TOOL_NAME]),
);

// Rein (N7), ohne Store-/Netz-Zugriff. Exportiert, weil die Klassifikation der eigentliche
// Gegenstand dieser Phase ist und direkt pinnbar sein muss.
export function isSideEffectOnlyTool(name) {
  return SIDE_EFFECT_ONLY_TOOL_NAMES.has(name);
}

// Fester Tool-Satz fuer BEIDE Engines (Budget-Tool-Loop + Realtime-Bridge ueber
// realtimeTools). Seit P1b (Owner-Entscheidung E1) OHNE Kalender-/Buchungs-Tool: der
// Telefon-Agent nimmt Terminwuensche nur als Nachricht auf, er bucht nichts und liest
// im Gespraech keinen Kalender. Der Kalender bleibt ein Owner-Werkzeug auf einer
// ANDEREN Achse (MCP-seitig + im Dashboard), gegated ueber resolveProfile, von hier aus
// unerreichbar. Keine Settings-Verzweigung mehr -> kein Tenant-Lookup und kein
// Parameter, der eine tenant-abhaengige Variation nur noch vortaeuschen wuerde.
// P11: die Beschreibungen sind sprachabhaengig (loc.prompt.tools), die Tool-NAMEN
// bleiben sprachinvariant (agentToolNames-Test, D4) - nur die Descriptions wandern.
export function toolDefs(language) {
  const t = localeFor(language).prompt.tools;
  return [
    // RCA-Wurzel R3: Das Modell schloss aus STT-Kauderwelsch, das Ziel sei
    // erreicht, und rief end_call. Das enge Verbot sitzt deshalb GENAU HIER, am Tool-
    // Entscheidungspunkt (Lehre call-quality-chain: breite Stil-/Meta-Regeln im Prompt-
    // Rumpf kippen bei Haiku in Ueberkorrektur, Verbote an der Tool-Description wirken).
    // Der letzte Satz ist der Ausstieg: er verhindert, dass der Agent aus Vorsicht GAR
    // nicht mehr auflegt.
    {
      name: END_CALL_TOOL_NAME,
      description: t.endCallDescription,
      input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: t.endCallReasonParam } },
        required: [],
      },
    },
    {
      name: TAKE_MESSAGE_TOOL_NAME,
      // Nach P1b der EINZIGE Entscheidungspunkt neben end_call - er traegt die Last,
      // die vorher auf vier Tools verteilt war. Die engen Verbote sitzen deshalb
      // GENAU HIER an der Tool-Description (Lehre call-quality-chain: breite Stil-
      // regeln im Prompt-Rumpf kippen bei Haiku in Ueberkorrektur).
      description: t.takeMessageDescription,
      input_schema: {
        type: "object",
        properties: { message: { type: "string", description: t.takeMessageParam } },
        required: ["message"],
      },
    },
  ];
}

// AL-P14: der Notausgang. Die engen Verbote sitzen GENAU HIER an der Tool-Description
// (Lehre call-quality-chain: breite Prompt-Regeln kippen bei Haiku in Ueberkorrektur).
// Der Paraphrase-Zwang steht im Prompt UND wird serverseitig durchgesetzt - der Prompt
// allein ist keine Durchsetzung.
function getConsultToolDef(language) {
  const t = localeFor(language).prompt.tools;
  return {
    name: GET_CONSULT_TOOL_NAME,
    description: t.getConsultDescription,
    input_schema: {
      type: "object",
      properties: { question: { type: "string", description: t.getConsultQuestionParam } },
      required: ["question"],
    },
  };
}

// Werkzeugsatz DIESES Turns. toolDefs bleibt der feste Satz beider Engines (die
// Realtime-Bridge und agentToolNames lesen weiter dort); nur der Budget-/Shim-Turn
// bekommt den Notausgang dazu, und nur wenn er in diesem Call auch bedient werden kann.
// KOSTEN-HINWEIS: der cache_control-Breakpoint sitzt am LETZTEN Tool - taucht das
// Werkzeug mitten im Call auf oder verschwindet es, faellt der Tool-Block-Cache genau
// einmal. Bewusst in Kauf genommen; die Alternative waere ein dauerhaft angebotenes
// Werkzeug ohne Empfaenger.
function agentTools(call) {
  if (!consultAvailableFor(call)) return toolDefs(call.language);
  return [...toolDefs(call.language), getConsultToolDef(call.language)];
}

// P8: Werkzeugliste des Telefon-Agenten als reine Namensliste, ABGELEITET aus toolDefs()
// (EINE Quelle, G5). Das briefende Modell (src/precall-briefing.js) darf keinen
// Hintergrund schreiben, der eine Faehigkeit voraussetzt, die der Agent nicht hat.
// Ohne Sprach-Argument, weil die NAMEN sprachinvariant sind (D4) - der Weltdefault-
// Schalter faerbt hier also nicht ab.
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
// (Mensch/Dashboard) bzw. das MCP-Tool - nie aus einem laufenden Gespraech. P11: die
// tool_result-Texte sind sprachabhaengig (loc.prompt.turnControl), call.language ist an
// der Dispatch-Site immer vorhanden (beide Engines reichen den vollen call durch).
export function execTool(call, name, input) {
  const tc = localeFor(call.language).prompt.turnControl;
  switch (name) {
    case TAKE_MESSAGE_TOOL_NAME: {
      store.addActionItem(call.id, input.message, "todo");
      return tc.takeMessageResult;
    }
    case END_CALL_TOOL_NAME:
      return "OK";
    default:
      return tc.unknownTool;
  }
}

// ---------- Gespraechs-Turn ----------

// Erst-Turn-Bootstrap-Marker/Stiller-Folge-Turn-Marker: P11 - Texte kommen jetzt aus
// dem Sprach-Baustein (loc.prompt.turnControl), s. agentTurn unten. Feuert NUR, wenn
// das Transkript beim Eintritt in agentTurn noch KEINE agent-Zeile enthaelt, und weist
// das Modell an, das Gespraech zu eroeffnen/zu begruessen. agentTurn hat ZWEI Aufrufer
// mit unterschiedlichem Vorzustand: ueber die Budget-Engine (server.js /voice/turn) ist
// dieser Zustand NICHT erreichbar, weil server.js die Greeting-/Opening-Zeile synchron
// per addTranscript() IN /voice/incoming BZW. /voice/outbound eintraegt, BEVOR der erste
// agentTurn-Aufruf ueberhaupt stattfindet. Erreichbar ist der Zustand ueber den zweiten
// Aufrufer, den Telnyx-LLM-Shim (telnyx-llm-shim.js): dort spricht ein Call-Control-
// Speak-Node die Disclosure/Greeting, OHNE sie ins Transkript zu schreiben - der erste
// agentTurn-Aufruf trifft dort auf ein tatsaechlich leeres Transkript. Der Stiller-
// Folge-Turn-Marker haelt die Anthropic-messages-Kette gueltig (Abschluss mit
// user-Turn), sobald der Agent schon gesprochen hat und der Anrufer nichts
// Substanzielles beitrug, OHNE dem Modell erneut "beginne/begruesse" zu signalisieren
// (behebt R4). Richtungsneutral - die konkrete Reaktion steuert der systemPrompt.

// Rueckgespielt an das Modell, wenn ein end_call unterdrueckt wird (Outbound, noch keine
// substanzielle Antwort). EINE Quelle fuer beide Engines: Budget-Tool-Loop UND
// Realtime-bridge.js (dort function_call_output). G5/G27. P11: sprachabhaengig - der
// Export wechselt von einer Konstante zu einer Funktion, weil die Sprache jetzt am
// call haengt (beide Engines reichen call durch).
export function endCallWaitInstruction(call) {
  return localeFor(call.language).prompt.turnControl.endCallWait;
}

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

// Der Shaper lebt seit AL-P7 in src/speech-shape.js (geteilter Kern mit dem chunk-
// sicheren Zwilling des Token-Streams, G5). Der Re-Export haelt die Bestands-Importpfade
// gueltig (bridge.js, Tests) - EINE Implementierung, kein zweiter Shaper.
export { shapeForSpeech };

// AL-P6: Grund-Token eines vorzeitig beendeten Tool-Loops. Die GELD-Gruende kommen aus
// budget-gate.js (BUDGET_AXIS - dieselben Token wie im Shim-Log); hier steht nur die
// ZEIT-Achse. null = der Loop lief regulaer zu Ende.
export const TURN_STOP_DEADLINE = "deadline";

// Die EINE Frage vor JEDER Schleifenrunde: darf sie noch gefahren werden? Liefert den
// maschinenlesbaren Grund oder null. Zwei Achsen mit bewusst UNTERSCHIEDLICHER Reichweite:
//   - GELD (Regel 1) gilt ab der ERSTEN Runde. bookTokenUsage laeuft in JEDER Runde;
//     geprueft wurde bisher nur EINMAL vor dem Turn (Shim Schritt 6) bzw. gar nicht
//     (/voice/turn). Ein erschoepfter Cap darf keinen einzigen Token mehr kosten.
//   - ZEIT erst ab der ZWEITEN Runde: die erste laeuft immer, sonst koennte eine zu knapp
//     konfigurierte Frist den Agenten stumm schalten (fail-safe Richtung Bestand). Eine
//     solche Konfiguration meldet der Boot-Waechter (warnTurnOutlivesDeadAir).
// Nicht injizierbar (Regel 1): ein Gate, das ein Aufrufer per No-op abschalten darf, ist
// keines. Injizierbar ist allein die REAKTION beim Aufrufer.
function roundStopReason({ call, roundIndex, elapsedMs, deadlineMs }) {
  const axis = blockingBudgetAxis({ store, billing: config.billing, tenantId: call.tenantId });
  if (axis) return axis;
  if (roundIndex === 0) return null;
  const fits = roundFitsDeadline({ elapsedMs, deadlineMs, requestTimeoutMs: config.llm.llmRequestTimeoutMs });
  return fits ? null : TURN_STOP_DEADLINE;
}

// UNCONDITIONAL (metrics.logTurn steht hinter METRICS_ENABLED und war live stumm) und
// PII-frei: server-generierte callId, Grund-Token, Zaehler - nie Text, nie Nummern.
// grund= folgt dem Bestandsmuster der Gate-Logs (outbound-gates.js) und macht den
// Zeit-Abbruch vom Geld-Abbruch maschinenlesbar unterscheidbar.
function logTurnStop({ callId, grund, roundtrips }) {
  console.warn(`[turn] abbruch grund=${grund} call=${callId} runden=${roundtrips}`);
}

// AL-P6/AL-P7: Ausgabe-Deckel EINER Modellrunde (G25). Wird an zwei Stellen gebraucht:
// an der Anfrage und als pessimistischer Ersatzwert, wenn ein Stream abreisst.
const TURN_MAX_TOKENS = 300;

// Zeichenumfang des VOLLSTAENDIG gebauten Prompts einer Runde - die eine Groesse, aus der
// sich ein abgerissener Aufruf noch deterministisch schaetzen laesst. Rein (N7).
function promptCharsOf({ system, tools, messages }) {
  return (
    JSON.stringify(system).length + JSON.stringify(tools).length + JSON.stringify(messages).length
  );
}

// AL-P7: der Satz-Abnehmer DIESER Runde - oder null, wenn nicht gestreamt werden darf.
// Drei Bedingungen, jede fail-closed:
//   1. Es gibt ueberhaupt einen Abnehmer (nur der Shim-Pfad liefert einen; die
//      Budget-Engine rendert ein fertiges TeXML-Dokument und kann nichts inkrementell).
//   2. Der Werkzeugsatz der Runde besteht AUSSCHLIESSLICH aus Seiteneffekt-Werkzeugen.
//      Nur dann ist der Text dieser Runde nachweislich der Text des Turns: jede andere
//      Werkzeugklasse kann ihn verwerfen (die naechste Runde ueberschreibt speech) oder
//      ersetzen (get_consult setzt den Ueberbrueckungssatz) - gesprochen ist gesprochen.
//      Ein kuenftiges, unbekanntes Werkzeug schaltet das Streamen damit von selbst ab (G27).
//   3. Die Frist des Turns traegt noch einen vollen Versuch (derselbe Massstab wie
//      roundStopReason ab der zweiten Runde, G5) - sonst laeuft der Bestandspfad.
function streamSinkFor({ onSpeechChunk, tools, elapsedMs, deadlineMs }) {
  if (!onSpeechChunk) return null;
  if (!tools.every((t) => isSideEffectOnlyTool(t.name))) return null;
  if (!roundFitsDeadline({ elapsedMs, deadlineMs, requestTimeoutMs: config.llm.llmRequestTimeoutMs }))
    return null;
  return makeSentenceChunker({ onChunk: onSpeechChunk });
}

// Genau EIN Modell-Aufruf einer Schleifenrunde - samt der EINEN Verbrauchsbuchung dieses
// Aufrufs (Regel 1). Nebeneffekte im Namen (N7).
//
// KOSTEN-REGEL DIESER PHASE: je llm-Aufruf faellt GENAU EIN bookTokenUsage. Im Gutfall mit
// dem echten usage der Antwort; reisst ein GESTREAMTER Aufruf ab, mit einem
// deterministischen, pessimistischen Ersatzwert (Input aus der bekannten Prompt-Laenge,
// Output fail-closed auf TURN_MAX_TOKENS). Nie 0, nie "kein Beleg", nie zwei Belege. Die
// Ueberbuchung im Abrissfall ist bewusst akzeptiert - dieselbe Fehlerrichtung wie
// priceForModel -> mostExpensivePrice.
//
// WARUM HIER bookTokenUsage (beide Achsen) und NICHT bookEstimatedTokenUsage wie beim
// Briefing (AL-P9): dort hat der Kunde nie ein Ergebnis gesehen, ein Beleg waere ein
// Phantom. Hier ist ein Teil des Textes bereits gesprochen worden - die Leistung ist
// erbracht, und die Abnahme dieser Phase verlangt genau EIN usage_event je Runde, im
// Gutfall wie im Abrissfall.
//
// Der Nicht-Stream-Zweig ist byte-identisch zum Bestand (kein Buchen bei Fehlern) - das
// ist die Zusage "Flag aus = Bestand".
async function completeRound({ call, params, stream }) {
  const bookReal = (usage) =>
    bookTokenUsage({ tenantId: call.tenantId, callId: call.id, usage, model: params.model });
  if (!stream) {
    const resp = await llm.complete(params);
    bookReal(resp.usage);
    return resp;
  }
  const promptChars = promptCharsOf(params);
  try {
    const resp = await llm.completeStream({
      ...params,
      sink: stream.sink,
      streamBudgetMs: stream.budgetMs,
    });
    bookReal(resp.usage);
    return resp;
  } catch (err) {
    // Der Anbieter hat gerechnet, wenn der Versuch auf der Leitung war ODER wenn schon ein
    // Fragment ankam (z.B. ein Schreibfehler des Abnehmers - kein LLM-Fehlertyp).
    if (attemptReachedProvider(err) || stream.sink.receivedText())
      bookReal(estimatedAbortUsage({ promptChars, maxTokens: TURN_MAX_TOKENS }));
    throw err;
  }
}

// Liefert { speech, endCall } und fuehrt Tool-Aufrufe serverseitig aus.
// AL-P7: onSpeechChunk ist der optionale Satz-Abnehmer des Streaming-Pfads. Ohne ihn ist
// dieser Turn byte-identisch zum Bestand (die Budget-Engine in routes/voice.js reicht
// keinen durch). Drittes Argument als OBJEKT, damit spaetere Abnehmer keine weitere
// Positions-Stelle brauchen (F1).
export async function agentTurn(call, callerText, { onSpeechChunk } = {}) {
  // G3/G26-Fix: das Transkript-Record-Gate ist
  // RICHTUNGSLOS und byte-identisch zum fruehen Master-Stand (41ce40b:
  // "if (callerText) store.addTranscript(...)"). JEDE nicht-leere Anrufer-Aeusserung landet
  // im Transkript - auch eine echte, aber kurze Antwort (z.B. STT-Ziffer "5"), die vorher
  // outbound am Substanz-Filter (isSubstantialCallerText) scheiterte und dadurch weder im
  // Dashboard-Live-Transkript noch im DSGVO-Export (exportTenantData) noch in
  // summarizeCall noch in den ans Modell gesendeten messages auftauchte (Datenverlust). Der
  // Substanz-Filter gated NICHT mehr das Recording, sondern nur noch die Turn-STEUERUNG
  // (suppressEndCall unten + die Empty-Turn-Zaehlung in unansweredAgentTurns).
  if (callerText) {
    store.addTranscript(call.id, "caller", callerText);
    // AL-P1 (Abbruch-Achse): derselbe Riegel wie das Transkript-Recording - genau dann,
    // wenn der Anrufer wirklich etwas gesagt hat. Purge-fest (purgeTranscript leert nur
    // transcript). BEWUSSTE GRENZE: der Realtime-Pfad (bridge.js) laeuft nicht durch
    // agentTurn und zaehlt nicht mit - er ist nicht der live laufende Pfad (O1).
    store.countCallerTurn(call.id);
  }

  // AL-P14: der EINE Zustandsschritt der laufenden Rueckfrage, VOR jeder Modellrunde und
  // NACH dem Transkript-Recording (eine Anrufer-Zeile darf nie verloren gehen). HOLD
  // spricht den deterministischen Halte-Satz statt einer Modellantwort; TIMED_OUT ist
  // einmalig und traegt den Mandats-Fallback in die Message-Kette.
  const consultWait = advanceConsultWait(call);
  const holdSpeech =
    consultWait === CONSULT_WAIT.HOLD ? localeFor(call.language).consultHoldSpeech : "";

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
    const tc = localeFor(call.language).prompt.turnControl;
    history.push({
      role: "user",
      content: hasAgentLine
        ? tc.silentTurn
        : call.direction === "outbound"
          ? tc.openingBootstrap.outbound
          : tc.openingBootstrap.inbound,
    });
  }

  // AL-P14 (Mandats-Fallback): auf die Rueckfrage kam nichts. Der Hinweis ist
  // server-eigener, eckig geklammerter Steuertext - dieselbe Klasse wie silentTurn, KEIN
  // fremder Text (die ANTWORT wandert weiterhin ausschliesslich ueber key_facts in den
  // HINTERGRUND-Block, Gate 5). Der Block darueber garantiert, dass die letzte Message
  // ein user-Turn ist; der Marker haengt sich an genau ihn. Er erscheint genau EINMAL -
  // der Einmal-Riegel ist die Zustandsumschaltung im Store, nicht eine Zaehlung hier.
  if (consultWait === CONSULT_WAIT.TIMED_OUT) {
    const tc = localeFor(call.language).prompt.turnControl;
    const last = history[history.length - 1];
    last.content = `${last.content}\n${tc.consultTimeout}`;
  }

  // T1-Sicherungsboden: siehe shouldSuppressEndCall oben (EINE Quelle,
  // von Budget-agentTurn UND Realtime-bridge.js genutzt, G27). Der Guard erzwingt end_call
  // NIE - das Modell entscheidet, der Guard unterdrueckt nur ein verfruehtes Auflegen.
  // Zeitliches Notaus bleibt die guthaben-abgeleitete Notbremse am Call (KS-P3).
  const suppressEndCall = shouldSuppressEndCall(call);

  let messages = history;
  let endCall = false;
  let suppressedEndCall = false;
  let speech = "";
  // AL-P7b: die EINE Frage, die der Aufrufer nach dem Turn stellt - steht der AKTUELLE Wert
  // von speech bereits auf der Leitung? Seit dem Denk-Signal ist "es wurde etwas gestreamt"
  // NICHT mehr dieselbe Aussage (die Ueberbrueckung ist gestreamt, die Antwort nicht). Die
  // Invariante wird an JEDER speech-Zuweisung mitgefuehrt.
  let speechStreamed = false;
  // AL-P7b: der Ueberbrueckungssatz dieses Turns - hoechstens EINER. Ohne Abnehmer
  // (Budget-Engine) oder mit ausgeschaltetem Flag ein No-op -> Bestandsverhalten.
  const thinkingSignal = makeThinkingSignal({
    onSpeechChunk,
    enabled: config.voice.thinkingSignalEnabled,
  });
  let roundtrips = 0; // L0: Anzahl llm.complete-Roundtrips dieses Turns
  const firedTools = []; // L0: vom Modell angeforderte Tool-NAMEN dieses Turns (PII-frei)

  // EINE Modell-ID fuer Anfrage UND Buchung (P7a): das Gate muss exakt das Modell
  // bepreisen, das gefragt wurde.
  const model = config.llm.claudeModel;

  // AL-P6: Start und Frist stehen VOR der Schleife - eine Frist, die sich in der Schleife
  // neu berechnet, waere keine.
  const loopStartedAt = Date.now();
  const deadlineMs = turnLoopDeadlineMs(config.voice.elevenLabsPlayTts.synthTimeoutMs);
  let stopReason = null;

  // Tool-Loop (max. MAX_TOOL_ROUNDS_PER_TURN Runden pro Turn)
  for (let i = 0; i < MAX_TOOL_ROUNDS_PER_TURN; i++) {
    stopReason = roundStopReason({
      call,
      roundIndex: i,
      elapsedMs: Date.now() - loopStartedAt,
      deadlineMs,
    });
    if (stopReason) break;

    // AL-P14: laeuft eine Rueckfrage, spricht dieser Turn den deterministischen
    // Halte-Satz - LLM-FREI, aber NACH dem Geld-Gate der Runde (Regel 1: der Halte-Turn
    // ueberspringt die Modellrunde, nicht die Pruefung). Bricht immer in Runde 0 ab.
    if (holdSpeech) {
      speech = holdSpeech;
      // speechStreamed bleibt false: der Halte-Satz ist LLM-frei und ging nie ueber den Draht.
      break;
    }

    const tools = toolsWithCacheControl(agentTools(call));
    const elapsedMs = Date.now() - loopStartedAt;
    const sink = streamSinkFor({ onSpeechChunk, tools, elapsedMs, deadlineMs });
    const params = {
      model,
      max_tokens: TURN_MAX_TOKENS,
      system: [{ type: "text", text: systemPrompt(call), cache_control: CACHE_CONTROL_EPHEMERAL }],
      tools,
      messages,
      callId: call.id, // I13: Bench-Korrelation (llm.js streift callId vor dem SDK-Call ab)
    };
    const resp = await completeRound({
      call,
      params,
      stream: sink && { sink, budgetMs: deadlineMs - elapsedMs },
    });
    roundtrips += 1;
    // AL-P7: der Rest des Puffers geht als letzter Chunk raus. Zulaessig ohne weitere
    // Pruefung, weil streamSinkFor nur Runden armiert, deren Text nachweislich der Text
    // des Turns ist (siehe dort). Lieferte die Runde gar keinen Text, ist das ein No-op.
    if (sink) sink.flushRemainder();

    const textParts = resp.content.filter((b) => b.type === "text").map((b) => b.text);
    if (textParts.length) {
      speech = textParts.join(" ").trim();
      // AL-P7b: nur eine armierte Runde (streamSinkFor, AL-P7) hat ihren Text bereits
      // satzweise gesprochen. Eine unarmierte Runde ueberschreibt einen frueher gesetzten
      // true-Wert korrekt mit false - ihr Text steht noch aus.
      speechStreamed = Boolean(sink);
    }

    const toolUses = resp.content.filter((b) => b.type === "tool_use");
    firedTools.push(...toolUses.map((tu) => tu.name)); // L0: Tools dieses Roundtrips
    if (!toolUses.length) break;

    // AL-P14: die Rueckfrage ist das EINZIGE Werkzeug, das den Turn selbst beendet -
    // deshalb wird sie VOR dem generischen Tool-Mapping ausgewertet. Angenommen: kein
    // zweiter llm.complete, gesprochen wird der deterministische Ueberbrueckungssatz.
    // Abgelehnt: ein deterministisches tool_result, das Kontingent bleibt unberuehrt,
    // der Loop laeuft weiter wie bei jedem informationsliefernden Werkzeug.
    const consult = decideConsultRequest(call, toolUses);
    if (consult?.accepted) {
      speech = consult.speech;
      // AL-P7b: der Consult-Fueller ist ein NEUER, ungesprochener Text - auch wenn eine
      // fruehere Runde bereits eine Ueberbrueckung gesprochen hat.
      speechStreamed = false;
      break;
    }

    // AL-P7b: die end_call-Entscheidung haengt an den ANGEFORDERTEN Werkzeugen, nicht an
    // deren Ausfuehrung - sie steht deshalb VOR dem tool_result-Mapping. Werte, Reihenfolge
    // und Klebrigkeit ueber Runden hinweg sind unveraendert; gewonnen ist, dass schon VOR
    // execTool feststeht, ob der Loop weiterlaeuft. Genau das braucht das Denk-Signal:
    // sobald ein Werkzeug selbst wartet (AL-P10b look_up), waere eine Ueberbrueckung NACH
    // der Ausfuehrung zu spaet. Nebenbei tut das Mapping jetzt nur noch eine Sache (G30).
    if (toolUses.some((tu) => tu.name === END_CALL_TOOL_NAME)) {
      if (suppressEndCall) suppressedEndCall = true;
      else endCall = true;
    }
    // Echtes oder unterdruecktes end_call mit vorhandener Aeusserung -> Turn beenden,
    // nicht weiter re-prompten. Bei unterdruecktem end_call bleibt endCall=false, der
    // Webhook rendert also ein <Gather>. Ohne speech weiterlaufen (max. 4 Runden),
    // damit das Modell nach end_call doch noch eine kurze Antwort liefern kann.
    //
    // AL-P4: derselbe Ausstieg gilt fuer JEDEN Roundtrip, der ausschliesslich
    // Seiteneffekt-Werkzeuge angefordert hat - deren tool_result traegt nichts, worauf das
    // Modell noch antworten muesste (bisher lief nach take_message unbedingt eine zweite
    // llm.complete-Runde, ~1,4-1,9 s pro Turn). Die Bedingung wird dabei NUR ERWEITERT,
    // nie verengt: der end_call-Arm bleibt eigenstaendig stehen, damit ein end_call NEBEN
    // einem unbekannten Werkzeug weiterhin auflegt statt eine Runde nachzulegen.
    // Bei leerem speech aendert sich nichts - der schlechteste Fall ist Bestandsverhalten.
    const sideEffectOnlyRound = toolUses.every((tu) => isSideEffectOnlyTool(tu.name));
    // EIN benannter Ausdruck (G5) statt derselben Bedingung an zwei Stellen: er steuert das
    // Denk-Signal UND den Ausstieg unten. Wortlaut byte-identisch zum Bestands-Ausstieg.
    const loopContinues = !(speech && (endCall || suppressedEndCall || sideEffectOnlyRound));

    // AL-P7b (Weg A): genau hier beginnt die Wartezeit, die der Anrufer sonst als tote
    // Leitung hoert. Der fuehrende Text DIESER Runde geht als Ueberbrueckung raus -
    // hoechstens einmal pro Turn, nie in einer Runde, die den Turn ohnehin beendet
    // (das ist die Schwelle: ein weiterlaufender Loop heisst mindestens zwei Roundtrips).
    // Ein angenommenes get_consult ist oben bereits ausgestiegen und spricht seinen EIGENEN
    // Ueberbrueckungssatz - hier entstuende sonst eine doppelte Ueberbrueckung.
    if (loopContinues && thinkingSignal.speakBridge(speech)) speechStreamed = true;

    messages = [
      ...messages,
      { role: "assistant", content: resp.content },
      {
        role: "user",
        content: toolUses.map((tu) => {
          // end_call ignorieren und das Modell anweisen, auf die Antwort zu warten. Die
          // ZUSTANDS-Entscheidung ist oben gefallen; hier entsteht nur noch der Text.
          if (tu.name === END_CALL_TOOL_NAME && suppressEndCall)
            return {
              type: "tool_result",
              tool_use_id: tu.id,
              content: endCallWaitInstruction(call),
            };
          // get_consult laeuft NIE durch execTool - dort gibt es bewusst keinen Case
          // (der zweite Riegel: die Realtime-Bridge ruft execTool direkt und bekaeme
          // sonst ein Werkzeug ausgefuehrt, das sie nicht bedienen kann). consult ist in
          // diesem Zweig garantiert nicht-null: decideConsultRequest liefert nur dann
          // null, wenn die Runde ueberhaupt kein get_consult enthaelt.
          const result =
            tu.name === GET_CONSULT_TOOL_NAME
              ? consult.toolResult
              : execTool(call, tu.name, tu.input || {});
          return { type: "tool_result", tool_use_id: tu.id, content: result };
        }),
      },
    ];
    if (!loopContinues) break;
  }

  if (stopReason) logTurnStop({ callId: call.id, grund: stopReason, roundtrips });

  metrics.logTurn({
    callId: call.id,
    direction: call.direction,
    roundtrips,
    tools: firedTools,
  });

  // I8: Modell-Text shapen, BEVOR ueber den Fallback entschieden wird (reiner Text-
  // Shaper, aendert eine leere Antwort nicht). I2: Fallback ist richtungsabhaengig +
  // sprachabhaengig (Locale-Bundle) - DE-inbound bleibt byte-identisch zum Vorgaenger.
  // AL-P7b: shapeForSpeech kann den Text noch veraendern (Schlusspunkt der Transkript-
  // Zeile). speechStreamed bleibt davon unberuehrt - es beantwortet "wurde diese Aeusserung
  // bereits gesprochen", nicht "ist sie byte-gleich zur Leitung" (AL-P7-Bestandsgrenze).
  speech = shapeForSpeech(speech);
  if (!speech) {
    speech = localeFor(call.language).turnFallbackSpeech[call.direction];
    // Der Fallback ist server-eigener Text und ging nie ueber den Draht - er MUSS gesprochen
    // werden, auch wenn dieser Turn zuvor eine Ueberbrueckung gesprochen hat.
    speechStreamed = false;
  }
  store.addTranscript(call.id, "agent", speech);
  // AL-P1: roundtrips/firedTools wurden bisher NUR in metrics.logTurn geschrieben - und der
  // Seam steht hinter METRICS_ENABLED (Fallback false), war live also stumm. Genau auf
  // diesen zwei Zahlen stehen die Abnahmen ab Phase 3/4. Sie wandern deshalb zusaetzlich
  // in den Rueckgabewert; metrics.logTurn bleibt UNVERAENDERT (sein Payload-Schluesselsatz
  // ist in test/l0-metrics.test.js woertlich gepinnt). EINE Quelle bleibt firedTools.
  // toolNames statt tools: es sind NAMEN - genau daran haengt die PII-Freiheit der Logzeile.
  // AL-P6: stopReason ist rein additiv (null im Normalfall). Der Aufrufer entscheidet die
  // REAKTION: der Shim beendet ueber Call-Control, die Budget-Engine ueber den TeXML-
  // Render. Die PRUEFUNG liegt an genau einer Stelle (oben, roundStopReason).
  // AL-P7b: zwei rein additive Felder. speechStreamed loest den Aufrufer von der
  // Chunk-ZAHL (die seit der Ueberbrueckung nicht mehr "der Turn-Text ist gesprochen"
  // bedeutet); thinkingSignalSpoken ist der PII-freie Diskriminator der Live-Abnahme.
  return {
    speech,
    speechStreamed,
    thinkingSignalSpoken: thinkingSignal.spoken(),
    endCall,
    roundtrips,
    toolNames: firedTools,
    stopReason,
  };
}

// ---------- Summary + Action Items nach dem Call ----------
// AL-P11: Kopf-Budget der Zusammenfassung. 500 trug Summary + Action Items; die
// Ergebnis-Karte kommt mit ~250 Output-Token dazu.
const SUMMARY_MAX_TOKENS = 800;

export async function summarizeCall(call) {
  const ctx = store.tenantContext(call.tenantId);
  const s = ctx.settings;
  const owner = ctx.ownerName;
  if (!s.allowSummaries) return null;
  if (!call.transcript.length) return null;

  // P11: die Rollen-/Feld-Labels des Zusammenfassungs-Inputs sind sprachabhaengig
  // (loc.prompt.summaryInput, DE byte-identisch); die JSON-Keys der Modell-Antwort
  // (summarySystem oben) bleiben sprachunabhaengig.
  const loc = localeFor(call.language);
  const si = loc.prompt.summaryInput;
  const convo = call.transcript
    .map((t) => `${t.role === "agent" ? si.agentRole : si.callerRole}: ${t.text}`)
    .join("\n");

  const model = config.llm.claudeModel;
  // O5: die Zitat-Aufforderung existiert nur, wenn die kurze Frist scharf ist. Sonst
  // steht sie nicht einmal im Prompt (kein Zitat, das man verwerfen muesste).
  const evidenceAllowed = evidenceRetentionEnabled(config.privacy);
  const resp = await llm.complete({
    model,
    // AL-P11: die Karte kostet ~250 zusaetzliche Output-Token an einer Anfrage, die
    // ohnehin laeuft - 500 reichten dafuer nicht mehr zuverlaessig.
    max_tokens: SUMMARY_MAX_TOKENS,
    // Zusammenfassungs-Prompt sprachabhaengig (F1 Phase 2): die Summary entsteht in der
    // Gespraechssprache (de byte-identisch); die JSON-Keys bleiben sprachunabhaengig.
    system: loc.summarySystem(owner) + (evidenceAllowed ? loc.summaryEvidenceClause : ""),
    messages: [
      {
        role: "user",
        content: `${si.directionLabel} ${call.direction}${call.goal ? `\n${si.goalLabel} ${call.goal}` : ""}\n\n${si.transcriptLabel}\n${convo}`,
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
  // AL-P11: die strukturierte Ergebnis-Karte. normalizeCallResult klemmt fremde
  // Modell-Ausgabe auf eine feste Form und liefert null, wenn das Modell die neuen
  // Felder ignoriert hat - dann bleibt result null und die Persistenz ist
  // byte-identisch zum Bestand.
  call.result = normalizeCallResult(parsed, { evidenceAllowed });
  store.save();
  for (const item of parsed.actionItems || []) store.addActionItem(call.id, item, "todo");
  return parsed;
}
