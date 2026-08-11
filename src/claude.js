// Das "Gehirn": Claude fuehrt das Gespraech, nutzt Tools (Nachricht aufnehmen,
// auflegen) und schreibt am Ende Summary + Action Items.
import { attemptReachedProvider, createLlmClient, createSecondaryLlmClient } from "./llm.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { CONSULT_WAIT, MANDATE_OUT_OF_SCOPE_DEFAULT, resolveTimezone } from "./store/defaults.js";
import { bookTokenUsage, estimatedAbortUsage } from "./llm-usage.js";
import { providerTurnMessage, toolResultsMessage } from "./llm/messages.js";
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
import { LOOK_UP_TOOL_NAME, lookupAvailableFor, performLookupRequest } from "./research/in-call.js";

// Resilienter LLM-Seam (src/llm.js): EINE Stelle fuer Timeout/
// selektiven Retry/Breaker. Verdrahtung am Modul-Top, Fachcode ruft nur
// llm.complete(...). Wirft bei Breaker-open/Retries-erschoepft LlmUnavailableError
// (Aufrufer faengt das, degradedSpeechFor aus llm.js); 4xx/Auth propagieren unveraendert.
// WELCHER Anbieter das ist, entscheidet die Registry aus LLM_PROVIDER (src/llm/
// registry.js) - nicht dieser Aufrufer, der deshalb auch keinen Schluessel mehr kennt.
const llm = createLlmClient({ config, metrics });

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
    // AL-P10b: EINE Quelle (G5) fuer "wird look_up in diesem Zug angeboten?" - dieselbe
    // Frage entscheidet ueber den Werkzeugsatz UND ueber die GRENZEN-Zeile.
    // Ein Prompt, der "du kannst nichts nachschlagen" sagt, waehrend das Werkzeug
    // danebensteht, ist genau die Klasse Widerspruch, an der Haiku kippt.
    // AL-P10b-fix: die Zusage gilt fuer BEIDE Aufrufer dieses Prompts. Budget-Engine:
    // agentTools schaltet mit demselben Praedikat. Realtime-Bridge: ihr Werkzeugsatz
    // (realtimeTools = toolDefs) traegt look_up nie, deshalb liefert lookupAvailableFor
    // unter VOICE_ENGINE=realtime fail-closed false (Engine-Faktor in
    // research/in-call.js lookupProviderFor). Vorher stimmte der Satz nur fuer die
    // Budget-Engine - der Realtime-Prompt versprach eine Faehigkeit ohne Werkzeug.
    lookupAvailable: lookupAvailableFor(call),
    // WW-P3: dieselbe Regel wie lookupAvailable, EINE Quelle (G5) fuer "wird get_consult
    // in diesem Zug angeboten?" - dieselbe Frage entscheidet ueber den Werkzeugsatz
    // (agentTools) UND ueber die drei Prompt-Stellen, die den Rueckfrage-Fall routen.
    // Der Prompt darf NIE auf ein Werkzeug zeigen, das im selben Zug fehlt: Kontingent
    // erschoepft, Poll nicht frisch, Tenant-Recht fehlt -> Bestandswortlaut.
    consultAvailable: consultAvailableFor(call),
    // WW-F1: EINE Quelle (G5) fuer "steht in DIESEM Prompt ein SPIELRAUM?" - dieselbe
    // Frage entscheidet ueber den SPIELRAUM-Block (mandateSection) UND ueber die
    // Buchungs-Zeile in den GRENZEN (boundaryRules). Bisher entschied jede Stelle fuer
    // sich, und beide sagten fuer denselben Terminwunsch Gegenteiliges: der Block
    // "entscheidest du selbst ... gibst es NICHT als Nachricht weiter", die Zeile
    // "einen Terminwunsch nimmst du als Nachricht auf" (Befund
    // tasks/befund-toolwahl-7-szenariopruefung.md, Abschnitt 2).
    mandateScopeGiven: Boolean(call.mandate && call.mandate.decide_freely),
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

// WW-P3: die Nachschlag-Zeile kennt jetzt DREI Lagen statt zwei. Wird nachgeschlagen,
// gilt unveraendert lookupAllowed (die Zeile spricht dort ohnehin nur noch das
// Weiterverbinden ab, das auch get_consult nicht kann). Ohne Nachschlag entscheidet die
// Rueckfrage-Verfuegbarkeit, ob der Satz den Fall exklusiv auf die Nachricht schickt.
function researchBoundaryLine(b, { lookupAvailable, consultAvailable }) {
  if (lookupAvailable) return b.lookupAllowed;
  return consultAvailable ? b.noLookupWithConsult : b.noLookup;
}

// Grenzen. Die beiden allow*-Gates behalten exakt ihre fail-closed-Semantik (Zeile
// steht, SOLANGE nicht ausdruecklich erlaubt) - nur die Leerzeile bei "erlaubt" faellt
// weg (D8). Die beiden Kalender-/Buchungs-Zeilen sind seit P1b unbedingt (Owner-
// Entscheidung E1) und bleiben es. Die letzten beiden Zeilen decken die vierte neu
// geschlossene Telefonie-Luecke (Faehigkeits-Ehrlichkeit + Werkzeug-Sparsamkeit). Die
// Verzweigung bleibt hier (EINE Quelle, P11 D1) - nur die Zeilen kommen aus dem
// Sprach-Baustein.
function boundaryRules({
  loc,
  settings: s,
  owner,
  lookupAvailable,
  consultAvailable,
  mandateScopeGiven,
}) {
  const b = loc.prompt.boundaries;
  const lines = [b.heading];
  if (!s.allowPersonalData) lines.push(b.personalData(owner));
  if (!s.allowBankData) lines.push(b.bankData);
  // AL-P10b: genau EINE Zeile wechselt. lookupAvailable=false (Flag aus, Inbound,
  // Realtime-Engine, Kontingent erschoepft, kein Tenant-Recht) -> b.noLookup -> Prompt
  // byte-identisch zum Bestand.
  lines.push(
    b.noCalendar(owner),
    // WW-F1: die Zeile bleibt unbedingt (E1: "du buchst KEINE Termine fest" steht in
    // BEIDEN Varianten), nur ihr Terminwunsch-Weg folgt dem SPIELRAUM. Ohne Spielraum
    // -> Bestandswortlaut, byte-identisch.
    mandateScopeGiven ? b.noBookingWithMandate : b.noBooking,
    researchBoundaryLine(b, { lookupAvailable, consultAvailable }),
    // GQ-P9: unbedingt, in JEDEM Turn. Der Defekt haengt nicht an einem Werkzeug oder
    // Flag - er trat auf, WAEHREND get_consult im Satz lag: die Gegenstelle fragt nach
    // einer Angabe zum Auftraggeber, der Agent gibt die Frage an sie zurueck.
    // WW-P3: die Regel bleibt unbedingt, nur ihr AUSWEG folgt dem Werkzeugsatz - bisher
    // nannte sie zwei Auswege, von denen einer vage war und der andere die Nachricht.
    consultAvailable
      ? b.noAskingCounterpartAboutOwnerWithConsult(owner)
      : b.noAskingCounterpartAboutOwner(owner),
    b.toolThrift,
  );
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
// WW-P3: der AUSSERHALB-Ausgang folgt dem Werkzeugsatz. Eine Consult-Variante gibt es NUR
// dort, wo der Sprach-Baustein eine anbietet - heute allein fuer den Default-Ausgang
// (Nachricht). DECLINE/ACCEPT_BEST tragen bewusst keine: beide sind ausdrueckliche
// Owner-Anweisungen, gerade NICHT zurueckzufragen. Welcher Ausgang eine Variante hat,
// entscheidet damit der Sprach-Baustein, nicht diese Funktion (kein Enum-Wissen hier).
function outOfScopeSentenceFor(mp, onOutOfScope, consultAvailable) {
  const key = mp.outOfScopeSentence[onOutOfScope] ? onOutOfScope : MANDATE_OUT_OF_SCOPE_DEFAULT;
  const withConsult = consultAvailable ? mp.outOfScopeSentenceWithConsult[key] : null;
  return withConsult || mp.outOfScopeSentence[key];
}

function mandateSection({ call, owner, loc, consultAvailable, mandateScopeGiven }) {
  const m = call.mandate;
  if (!hasMandateContent(m)) return "";
  const mp = loc.prompt.mandate;
  const outOfScope = outOfScopeSentenceFor(mp, m.on_out_of_scope, consultAvailable);
  const precedence = call.constraints ? mp.constraintsPrecedence : "";
  const blocks = [];
  // WW-F1: dasselbe Praedikat wie die Buchungs-Zeile in boundaryRules (G27: Struktur
  // statt Konvention) - die beiden koennen nicht mehr auseinanderlaufen.
  if (mandateScopeGiven)
    blocks.push(`${mp.scopeLabel} ${m.decide_freely}\n${mp.scopeRules}${precedence}`);
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

// WW-P3/P4: der Rueckfrage-Weg im Prompt-Rumpf. get_consult stand bisher in KEINEM
// gerenderten Prompt woertlich (Befund W2) - es existierte fuer das Modell nur als
// Eintrag im tools-Array, waehrend drei Prompt-Bloecke denselben Fall woertlich auf
// take_message schickten. Werkzeug nicht im Zug -> "" -> filter(Boolean) in systemPrompt
// haelt den Bestandsprompt byte-identisch (Muster thinkingSignalRules/mandateSection).
function consultRules(p) {
  return p.consultAvailable ? p.loc.prompt.consultRules(p.owner) : "";
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
    // WW-P3: steht VOR dem SPIELRAUM, weil der Mandats-Block die Ausnahme dazu ist ("in
    // diesem Rahmen entscheidest du selbst, fragst NICHT nach") - erst die Regel, dann der
    // ausdruecklich freigegebene Bereich. Werkzeug nicht im Zug -> "" -> byte-identisch.
    consultRules(p),
    // P6: rote Linien (GRENZEN) zuerst, dann der gruene Bereich. Ohne Mandat "" ->
    // filter(Boolean) haelt den Bestandsprompt byte-identisch (Muster D8).
    mandateSection(p),
    // GQ-P10 (Befund N-2): eigener Listeneintrag statt Teil von assignmentBlock - der
    // haengt an call.goal und rendert NUR outbound. Nachrichten entstehen aber gerade
    // inbound (das ist der Hauptzweck eingehender Anrufe). Nichts notiert -> "" ->
    // filter(Boolean) haelt den Bestandsprompt byte-identisch (Muster mandateSection).
    recordedMessagesSection(p),
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
  if (Array.isArray(c.key_facts) && c.key_facts.length)
    lines.push(`${b.facts}${c.key_facts.join("; ")}`);
  if (!lines.length) return "";
  return `\n${b.heading}\n${lines.join("\n")}\n${b.guardrail}`;
}

// GQ-P10 (Befund N-2): was in DIESEM Gespraech bereits notiert ist.
//
// Live entstanden drei Eintraege fuer einen Sachverhalt, weil das Modell jedes Mal neu
// formuliert und der Inhaltsgleichheits-Riegel aus GQ-P4 deshalb nie greift. Die Wurzel
// ist nicht die Aehnlichkeitsschwelle, sondern dass das Modell nie erfaehrt, was es schon
// notiert hat - es entscheidet ueber take_message ohne Gedaechtnis. Dieselbe Blindheit wie
// bei der eingetroffenen Rueckfrage-Antwort (GQ-P8).
//
// Leerer Fall -> "" wie assistantContextSection daneben: solange nichts notiert ist, bleibt
// der Prompt byte-identisch zum Bestand (Golden-Master-Pins). Der Block ist SERVER-Text
// ueber eigene Notizen, keine fremde Rede - er speist weder Offenlegung noch Persona.
// KEIN fuehrendes "\n" (anders als assistantContextSection/callMemorySection): die beiden
// werden per String-+ konkateniert und tragen ihren Separator selbst, dieser Block haengt
// im Top-Level-Array von systemPrompt und bekommt seinen "\n\n" vom join.
// GQ-P14: DIE Form des Notiz-Blocks - eine Quelle fuer beide Pfade (G5). Gespraech
// (recordedMessagesSection) und Nachbereitung (summarizeCall) zeigen dieselbe Liste in
// derselben Form; nur die Handlungsanweisung darunter unterscheidet sich, weil das
// Gespraech ueber take_message entscheidet und die Nachbereitung ueber den JSON-Key
// actionItems. Leere Liste -> "": beide Aufrufer bleiben dann byte-identisch zum Bestand.
function recordedItemsBlock({ items, heading, guardrail }) {
  if (!items.length) return "";
  return `${heading}\n${items.map((item) => `- ${item.text}`).join("\n")}\n${guardrail}`;
}

function recordedMessagesSection({ call, loc }) {
  const b = loc.prompt.recorded;
  return recordedItemsBlock({
    items: store.callActionItems(call.id),
    heading: b.heading,
    guardrail: b.guardrail,
  });
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

// AL-P17 (E1, Owner-Entscheidung O-D1-A vom 2026-08-01): die zweite Werkzeug-KLASSE
// dieser Datei - STROM-SICHER. Strom-sicher heisst: dieses Werkzeug kann einen bereits
// GESPROCHENEN Rundentext nicht mehr ersetzen. Nur wenn JEDES angebotene Werkzeug der
// Runde hier steht, darf ihr Text satzweise raus (streamSinkFor).
//
// ALLOWLIST, niemals Denylist: eine Regel der Form "sperre bei get_consult" faellt bei
// jedem kuenftigen Werkzeug fail-open. Hier schaltet ein unbekanntes Werkzeug das
// Streamen von selbst ab (G27) - das ist die Eigenschaft, die aus der Vorgaenger-Regel
// erhalten bleibt.
//
// Warum heute ALLE vier bekannten Werkzeuge drinstehen:
//   end_call/take_message - ihr tool_result traegt nichts, worauf das Modell antworten
//                           muesste (die AL-P4-Klasse oben).
//   look_up               - liefert Information, ersetzt aber nichts: der FUEHRENDE Text
//                           der Runde ist genau der Satz, den das Denk-Signal ohnehin
//                           spraeche, und die Folgerunde HAENGT ihren Text an.
//   get_consult           - ersetzte den Rundentext bis AL-P17 durch den Fueller. Genau
//                           das unterbleibt seit E3, wenn bereits gestreamt wurde
//                           (O-D1-B). E3 ist die Vorbedingung dieser Zeile - beide
//                           gehoeren zusammen oder gar nicht.
// KEINE Ableitung aus toolDefs()/agentTools(): eine abgeleitete Liste waere genau die
// fail-open-Regel, die oben ausgeschlossen ist.
const STREAM_SAFE_TOOL_NAMES = Object.freeze(
  new Set([END_CALL_TOOL_NAME, TAKE_MESSAGE_TOOL_NAME, LOOK_UP_TOOL_NAME, GET_CONSULT_TOOL_NAME]),
);

// Rein (N7), ohne Store-/Netz-Zugriff.
function isStreamSafeTool(name) {
  return STREAM_SAFE_TOOL_NAMES.has(name);
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
      parameters: {
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
      parameters: {
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
    parameters: {
      type: "object",
      properties: { question: { type: "string", description: t.getConsultQuestionParam } },
      required: ["question"],
    },
  };
}

// Werkzeugsatz DIESES Turns. toolDefs bleibt der feste Satz beider Engines (die
// Realtime-Bridge und agentToolNames lesen weiter dort); nur der Budget-/Shim-Turn
// bekommt den Notausgang dazu, und nur wenn er in diesem Call auch bedient werden kann.
// KOSTEN-HINWEIS: Werkzeugangebot + Systemanweisung sind das cachefaehige Praefix
// (LlmRequest.cachePrefix) - taucht das Werkzeug mitten im Call auf oder verschwindet
// es, faellt dieses Praefix genau einmal. Bewusst in Kauf genommen; die Alternative
// waere ein dauerhaft angebotenes Werkzeug ohne Empfaenger.
function agentTools(call) {
  const tools = toolDefs(call.language);
  if (consultAvailableFor(call)) tools.push(getConsultToolDef(call.language));
  // AL-P10b: dieselbe Sperre wie get_consult - outbound-only, aktiver Call, Kontingent,
  // Flag x Tenant-Recht x Secret. Erschoepftes Kontingent laesst das Werkzeug aus dem
  // tools-Array des NAECHSTEN Zuges verschwinden (der Agent faellt auf sein Mandat
  // zurueck). KOSTEN-HINWEIS wie oben: Werkzeugangebot + Systemanweisung sind das
  // cachefaehige Praefix, ein Auftauchen/Verschwinden mitten im Call kostet es einmal.
  if (lookupAvailableFor(call)) tools.push(lookUpToolDef(call.language));
  return tools;
}

// AL-P10b: die engen Verbote sitzen GENAU HIER an der Tool-Description (Lehre
// call-quality-chain). Der Query-Filter wird serverseitig durchgesetzt
// (research/lookup-guard.js) - der Prompt allein ist keine Durchsetzung.
function lookUpToolDef(language) {
  const t = localeFor(language).prompt.tools;
  return {
    name: LOOK_UP_TOOL_NAME,
    description: t.lookUpDescription,
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: t.lookUpQueryParam } },
      required: ["query"],
    },
  };
}

// P8: Werkzeugliste des Telefon-Agenten als reine Namensliste, ABGELEITET aus toolDefs()
// (EINE Quelle, G5). Das briefende Modell (src/precall-briefing.js) darf keinen
// Hintergrund schreiben, der eine Faehigkeit voraussetzt, die der Agent nicht hat.
// Ohne Sprach-Argument, weil die NAMEN sprachinvariant sind (D4) - der Weltdefault-
// Schalter faerbt hier also nicht ab.
export const agentToolNames = () => toolDefs().map((t) => t.name);

// Tool-Dispatch beider Engines. Kein Kalender-/Buchungs-Case mehr (P1b), und seit
// AUTH-P4 auch keine HTTP-Schreibflaeche mehr - in den Kalender schreibt nichts mehr
// aus dem Gespraech (das lesende Kalender-Auskunfts-Tool bleibt ein reiner Lese-Case,
// s. mcp-tools.js). P11: die
// tool_result-Texte sind sprachabhaengig (loc.prompt.turnControl), call.language ist an
// der Dispatch-Site immer vorhanden (beide Engines reichen den vollen call durch).
export function execTool(call, name, input) {
  const tc = localeFor(call.language).prompt.turnControl;
  switch (name) {
    case TAKE_MESSAGE_TOOL_NAME: {
      // GQ-P4 (Befund B-6): der Store legt eine inhaltsgleiche Nachricht desselben Calls
      // kein zweites Mal an. Das Werkzeug-Ergebnis sagt dem Modell genau das - vorher war
      // der Ergebnistext eine statische Konstante, die "das ist schon notiert" NIE
      // signalisieren konnte. Einzige Prompt-nahe Aenderung dieser Phase.
      const { duplicate } = store.addActionItem(call.id, input.message, "todo");
      return duplicate ? tc.takeMessageDuplicateResult : tc.takeMessageResult;
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
// beenden. LLM-Token UND Carrier-Minuten laufen seit KV-P2 richtungsunabhaengig in den
// Budget-Guard; die Exposition eines stillen Inbound-Calls ist damit zusaetzlich durch die
// Tenant-Decke begrenzt. Begrenzt wird die Exposition ausserdem durch den 180-s-Hard-Cap.
// maxEmptyTurns fuer Inbound NIE hochdrehen.
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

// GQ-P1: der Tool-Loop wurde zugunsten einer VOLLSTAENDIGEREN Fassung derselben Aeusserung
// abgebrochen. Eigenes Token neben der ZEIT-Achse, damit die Log-Auswertung den Riegel vom
// Fristablauf trennt. KEINE Geld-Achse - isBudgetAxis (budget-gate.js) erkennt es nicht,
// der Shim-Notaus bleibt damit unberuehrt.
export const TURN_STOP_SUPERSEDED = "superseded";

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
  const fits = roundFitsDeadline({
    elapsedMs,
    deadlineMs,
    requestTimeoutMs: config.llm.llmRequestTimeoutMs,
  });
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
//
// Gemessen wird die NEUTRALE Anfrage, nicht der Anbieter-Body: die Anbieter-Huelle
// (System-Blockliste, Feldnamen) ist Draht-Syntax, kein Prompt-Inhalt. Die Zahl liegt
// dadurch rund 60 Zeichen (~20 Token) unter der bis B3a gemessenen - weit innerhalb der
// eingebauten Pessimismus-Reserve (ESTIMATE_CHARS_PER_TOKEN = 3 gegen real 3,5-4, also
// 17-33 % Aufschlag). Die Schaetzung bleibt eine Obergrenze (Regel 1).
function promptCharsOf({ system, tools, messages }) {
  return (
    JSON.stringify(system).length + JSON.stringify(tools).length + JSON.stringify(messages).length
  );
}

// AL-P7: der Satz-Abnehmer DIESER Runde - oder null, wenn nicht gestreamt werden darf.
// Drei Bedingungen, jede fail-closed:
//   1. Es gibt ueberhaupt einen Abnehmer (nur der Shim-Pfad liefert einen; die
//      Budget-Engine rendert ein fertiges TeXML-Dokument und kann nichts inkrementell).
//   2. AL-P17 (E1): JEDES angebotene Werkzeug ist bekannt und STROM-SICHER
//      (isStreamSafeTool). Bis AL-P17 stand hier die schaerfere Bedingung
//      "ausschliesslich Seiteneffekt-Werkzeuge". Sie sperrte live in JEDEM Turn, weil
//      look_up an keiner Frische-Bedingung haengt und damit immer im Satz liegt
//      (AL-D1-2) - der einzige Mechanismus gegen die Latenz der ERSTEN Modellrunde war
//      dadurch dauerhaft still (AL-D2 Klasse K1). Die Regel bleibt eine ALLOWLIST: ein
//      kuenftiges, unbekanntes Werkzeug schaltet das Streamen von selbst ab (G27).
//   3. Die Frist des Turns traegt noch einen vollen Versuch (derselbe Massstab wie
//      roundStopReason ab der zweiten Runde, G5) - sonst laeuft der Bestandspfad.
//
// continuesStream: steht auf dem Draht DIESES Turns schon Text? Der Chunker ist je Runde
// eine neue Instanz und kann das nicht wissen; ohne die Auskunft klebte der erste Satz
// der Folgerunde am letzten der Vorrunde.
//
// Exportiert, weil der fail-closed-Fall NICHT ueber agentTurn erreichbar ist: agentTools
// kann per Konstruktion nur BEKANNTE Werkzeuge anbieten, ein erfundenes Werkzeug kommt
// dort nie an. Die Armierungsregel ist der Gegenstand dieser Phase und muss direkt
// pinnbar sein - dieselbe Begruendung, aus der isSideEffectOnlyTool exportiert ist.
export function streamSinkFor({ onSpeechChunk, tools, elapsedMs, deadlineMs, continuesStream }) {
  if (!onSpeechChunk) return null;
  if (!tools.every((t) => isStreamSafeTool(t.name))) return null;
  if (
    !roundFitsDeadline({ elapsedMs, deadlineMs, requestTimeoutMs: config.llm.llmRequestTimeoutMs })
  )
    return null;
  return makeSentenceChunker({ onChunk: onSpeechChunk, continuesStream });
}

// Genau EIN Modell-Aufruf einer Schleifenrunde - samt der EINEN Verbrauchsbuchung dieses
// Aufrufs (Regel 1). Nebeneffekte im Namen (N7).
//
// KOSTEN-REGEL DIESER PHASE: je llm-Aufruf faellt GENAU EIN bookTokenUsage. Im Gutfall mit
// dem echten usage der Antwort; reisst ein GESTREAMTER Aufruf ab, mit einem
// deterministischen, pessimistischen Ersatzwert (Input aus der bekannten Prompt-Laenge,
// Output fail-closed auf TURN_MAX_TOKENS). Nie 0, nie "kein Beleg", nie zwei Belege. Die
// Ueberbuchung im Abrissfall ist bewusst akzeptiert - dieselbe Fehlerrichtung wie
// priceForModel -> worstCasePrice.
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
  const bookReal = (usage) => bookTokenUsage({ tenantId: call.tenantId, callId: call.id, usage });
  if (!stream) {
    const turn = await llm.complete(params);
    bookReal(turn.usage);
    return turn;
  }
  const promptChars = promptCharsOf(params);
  try {
    const turn = await llm.completeStream({
      ...params,
      sink: stream.sink,
      streamBudgetMs: stream.budgetMs,
    });
    bookReal(turn.usage);
    return turn;
  } catch (err) {
    // Der Anbieter hat gerechnet, wenn der Versuch auf der Leitung war ODER wenn schon ein
    // Fragment ankam (z.B. ein Schreibfehler des Abnehmers - kein LLM-Fehlertyp).
    if (attemptReachedProvider(err) || stream.sink.receivedText())
      bookReal(
        estimatedAbortUsage({
          promptChars,
          maxTokens: TURN_MAX_TOKENS,
          billingModelId: params.model,
        }),
      );
    throw err;
  }
}

// Liefert { speech, endCall } und fuehrt Tool-Aufrufe serverseitig aus.
// AL-P7: onSpeechChunk ist der optionale Satz-Abnehmer des Streaming-Pfads. Ohne ihn ist
// dieser Turn byte-identisch zum Bestand (die Budget-Engine in routes/voice.js reicht
// keinen durch). Drittes Argument als OBJEKT, damit spaetere Abnehmer keine weitere
// Positions-Stelle brauchen (F1).
// Der Ergebnistext EINES Werkzeugs dieser Runde. get_consult (AL-P14) und look_up
// (AL-P10b) laufen NIE durch execTool - dort gibt es bewusst keinen Case, das ist der
// zweite Riegel fuer die Realtime-Bridge, die execTool direkt ruft und beide Werkzeuge
// nicht bedienen kann (sie bekommt tc.unknownTool). Beide Ergebnisse stehen fest, bevor
// diese Funktion laeuft; ihr jeweiliger Entscheider liefert garantiert non-null, wenn
// der Name in dieser Runde vorkam. Ein Objekt statt vier Positionen (F1).
function toolResultText({ call, toolCall, consult, lookup }) {
  if (toolCall.name === GET_CONSULT_TOOL_NAME) return consult.toolResult;
  if (toolCall.name === LOOK_UP_TOOL_NAME) return lookup.toolResult;
  return execTool(call, toolCall.name, toolCall.input);
}

// GQ-P2: der Steuertext-Marker dieses Turns, abgeleitet aus dem Zustandsschritt der
// Rueckfrage. EINE Zuordnung statt zweier paralleler if-Ketten (G5/G23); NONE und HOLD
// tragen keinen Marker (HOLD spricht statt zu schreiben).
function consultTurnMarker(consultWait, turnControl) {
  // GQ-P8: die Ankunft steht VORN - sie ist der Zustand, auf den es ankommt.
  if (consultWait === CONSULT_WAIT.ANSWERED) return turnControl.consultAnswered;
  if (consultWait === CONSULT_WAIT.PENDING) return turnControl.consultPending;
  if (consultWait === CONSULT_WAIT.TIMED_OUT) return turnControl.consultTimeout;
  return "";
}

// GQ-P1: abortSignal ist der optionale Riegel des Shims (telnyx-turn-supersede.js). Ohne
// ihn ist dieser Turn byte-identisch zum Bestand - /voice/turn (routes/voice.js) reicht
// keinen durch. Der Abbruch ist KOOPERATIV: gelesen wird an der Schleifengrenze und vor
// dem Transkript-Schreiben, NICHT im Modell-Aufruf. Damit bleibt die Kosten-Buchhaltung
// (completeRound: genau EINE Buchung je Modellrunde) unangetastet. Stumm geschaltet wird
// der Turn nicht hier, sondern am Sprech-Draht des Shims.
export async function agentTurn(call, callerText, { onSpeechChunk, abortSignal } = {}) {
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

  // AL-P14/GQ-P2: server-eigener, eckig geklammerter Steuertext - dieselbe Klasse wie
  // silentTurn, KEIN fremder Text (die ANTWORT wandert weiterhin ausschliesslich ueber
  // key_facts in den HINTERGRUND-Block, Gate 5). Der Block darueber garantiert, dass die
  // letzte Message ein user-Turn ist; der Marker haengt sich an genau ihn. Je Zustand
  // genau EINMAL - der Einmal-Riegel ist die Latch im Store, keine Zaehlung hier.
  const consultMarker = consultTurnMarker(consultWait, localeFor(call.language).prompt.turnControl);
  if (consultMarker) {
    const last = history[history.length - 1];
    last.content = `${last.content}\n${consultMarker}`;
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
  // AL-P17: steht auf dem Sprech-Draht DIESES Turns bereits Text? Nur der Turn weiss das -
  // der Satz-Chunker ist je Runde eine NEUE Instanz und begaenne sonst jede Folgerunde
  // ohne Wortgrenze ("...schaue ich nach.Donnerstag um neun..."). Dieselbe Wurzel und
  // dieselbe Loesung wie BRIDGE_TAIL_SEPARATOR (thinking-signal.js) - dort haengt das
  // Zeichen hinten, weil die Bruecke immer das erste Fragment ist. Genau deshalb setzt
  // die Bruecke dieses Flag bewusst NICHT: sie liefert ihre Wortgrenze selbst mit.
  let wireHasSpeech = false;
  // AL-P7b: der Ueberbrueckungssatz dieses Turns - hoechstens EINER. Ohne Abnehmer
  // (Budget-Engine) oder mit ausgeschaltetem Flag ein No-op -> Bestandsverhalten.
  const thinkingSignal = makeThinkingSignal({
    onSpeechChunk,
    enabled: config.voice.thinkingSignalEnabled,
  });
  let roundtrips = 0; // L0: Anzahl llm.complete-Roundtrips dieses Turns
  const firedTools = []; // L0: vom Modell angeforderte Tool-NAMEN dieses Turns (PII-frei)
  // AL-D1: die zwei Groessen, die am Live-Log die zwei Befunde des ersten Ende-zu-Ende-
  // Anrufs aufloesen. offeredTools beantwortet "lag das Werkzeug ueberhaupt im Satz" -
  // firedTools allein kann "Gate hat nie angeboten" nicht von "Modell hat nicht gewaehlt"
  // trennen. streamArmedRounds beantwortet "wurde der Streaming-Pfad ueberhaupt armiert" -
  // ohne diese Zahl ist streamChunks=0 zwischen "nie armiert" und "armiert, aber der
  // Chunker gab nichts aus" mehrdeutig. Beides PII-frei (Namen sind Code-Konstanten).
  const offeredTools = new Set(); // Union ueber die Runden dieses Turns
  let streamArmedRounds = 0;

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
    // GQ-P1: ein verdraengter Turn faehrt KEINE weitere Modellrunde (echte Token-
    // Ersparnis ab Runde 2). Die bereits laufende Runde laeuft aus - ihr Text wird
    // verworfen, nicht gesprochen.
    if (abortSignal?.aborted) {
      stopReason = TURN_STOP_SUPERSEDED;
      break;
    }
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

    const tools = agentTools(call);
    for (const tool of tools) offeredTools.add(tool.name);
    const elapsedMs = Date.now() - loopStartedAt;
    const sink = streamSinkFor({
      onSpeechChunk,
      tools,
      elapsedMs,
      deadlineMs,
      continuesStream: wireHasSpeech,
    });
    if (sink) streamArmedRounds += 1;
    const params = {
      model,
      maxTokens: TURN_MAX_TOKENS,
      system: systemPrompt(call),
      tools,
      messages,
      // L3: Werkzeugangebot + Systemanweisung sind der stabile Praefix dieses Turns.
      // WELCHE Marken ein Anbieter dafuer braucht, weiss nur sein Adapter.
      cachePrefix: true,
      callId: call.id, // I13: Bench-Korrelation (llm.js streift callId vor dem SDK-Call ab)
    };
    const turn = await completeRound({
      call,
      params,
      stream: sink && { sink, budgetMs: deadlineMs - elapsedMs },
    });
    roundtrips += 1;
    // AL-P7: der Rest des Puffers geht als letzter Chunk raus. Zulaessig ohne weitere
    // Pruefung, weil streamSinkFor nur Runden armiert, deren Text nachweislich der Text
    // des Turns ist (siehe dort). Lieferte die Runde gar keinen Text, ist das ein No-op.
    if (sink) {
      sink.flushRemainder();
      // Ab jetzt steht Text auf dem Draht dieses Turns (die naechste Runde bekommt ihr
      // fuehrendes Trennzeichen). chunkCount statt eines eigenen Zaehlers: der Chunker
      // gibt kein leeres Fragment aus, die Zahl ist die ehrliche Auskunft (G5).
      if (sink.chunkCount() > 0) wireHasSpeech = true;
    }

    // Der zusammengesetzte, getrimmte Antworttext der Runde (llm/ports.js LlmTurn.text) -
    // leerer String heisst "diese Runde hat nichts gesagt" und laesst den zuletzt
    // gesprochenen Text stehen.
    if (turn.text) {
      speech = turn.text;
      // AL-P7b: nur eine armierte Runde (streamSinkFor, AL-P7) hat ihren Text bereits
      // satzweise gesprochen. Eine unarmierte Runde ueberschreibt einen frueher gesetzten
      // true-Wert korrekt mit false - ihr Text steht noch aus.
      speechStreamed = Boolean(sink);
    }

    const toolCalls = turn.toolCalls;
    firedTools.push(...toolCalls.map((tc) => tc.name)); // L0: Tools dieses Roundtrips
    if (!toolCalls.length) break;

    // AL-P14: die Rueckfrage ist das EINZIGE Werkzeug, das den Turn selbst beendet -
    // deshalb wird sie VOR dem generischen Tool-Mapping ausgewertet. Angenommen: kein
    // zweiter llm.complete, gesprochen wird der deterministische Ueberbrueckungssatz.
    // Abgelehnt: ein deterministisches tool_result, das Kontingent bleibt unberuehrt,
    // der Loop laeuft weiter wie bei jedem informationsliefernden Werkzeug.
    const consult = decideConsultRequest(call, toolCalls);
    if (consult?.accepted) {
      // AL-P17 (E3, Owner-Entscheidung O-D1-B vom 2026-08-01): der deterministische
      // Consult-Fueller spricht nur noch, wenn dieser Turn noch NICHTS gesprochen hat.
      // Lag der fuehrende Text der Runde schon auf der Leitung, hat der Anrufer seine
      // Ueberbrueckung bereits gehoert - der Fueller waere ein ZWEITER Haltesatz.
      // AUSDRUECKLICH: damit gilt die AL-P14-Zusage "der Haltesatz ist LLM-frei" in
      // GENAU DIESEM Fall nicht mehr. Das ist eine bewusste Owner-Entscheidung, keine
      // Nachlaessigkeit; der Fall ohne gestreamten Text bleibt unveraendert LLM-frei.
      // Die Consult-Mechanik selbst (Kontingent, Frische, Frist, Mandats-Fallback,
      // Paraphrase-Pflicht) ist NICHT beruehrt - nur, welcher Satz gesprochen wird.
      // speechStreamed braucht keine Zuweisung: ohne gestreamten Text ist es bereits
      // false, mit gestreamtem Text bleibt der gesprochene Text stehen - die Invariante
      // "speechStreamed beschreibt den AKTUELLEN Wert von speech" haelt in beiden Armen.
      if (!speechStreamed) speech = consult.speech;
      break;
    }

    // AL-P7b: die end_call-Entscheidung haengt an den ANGEFORDERTEN Werkzeugen, nicht an
    // deren Ausfuehrung - sie steht deshalb VOR dem tool_result-Mapping. Werte, Reihenfolge
    // und Klebrigkeit ueber Runden hinweg sind unveraendert; gewonnen ist, dass schon VOR
    // execTool feststeht, ob der Loop weiterlaeuft. Genau das braucht das Denk-Signal:
    // sobald ein Werkzeug selbst wartet (AL-P10b look_up), waere eine Ueberbrueckung NACH
    // der Ausfuehrung zu spaet. Nebenbei tut das Mapping jetzt nur noch eine Sache (G30).
    if (toolCalls.some((tc) => tc.name === END_CALL_TOOL_NAME)) {
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
    const sideEffectOnlyRound = toolCalls.every((tc) => isSideEffectOnlyTool(tc.name));
    // EIN benannter Ausdruck (G5) statt derselben Bedingung an zwei Stellen: er steuert das
    // Denk-Signal UND den Ausstieg unten. Wortlaut byte-identisch zum Bestands-Ausstieg.
    const loopContinues = !(speech && (endCall || suppressedEndCall || sideEffectOnlyRound));

    // AL-P7b (Weg A): genau hier beginnt die Wartezeit, die der Anrufer sonst als tote
    // Leitung hoert. Der fuehrende Text DIESER Runde geht als Ueberbrueckung raus -
    // hoechstens einmal pro Turn, nie in einer Runde, die den Turn ohnehin beendet
    // (das ist die Schwelle: ein weiterlaufender Loop heisst mindestens zwei Roundtrips).
    // Ein angenommenes get_consult ist oben bereits ausgestiegen und spricht seinen EIGENEN
    // Ueberbrueckungssatz - hier entstuende sonst eine doppelte Ueberbrueckung.
    // Korrektheits-Fix Runde 1: speech MUSS auf den tatsaechlich gesprochenen
    // Brueckentext gezogen werden, nicht auf den vollen (ggf. laengeren) Rundentext -
    // sonst weicht das Transkript (und die Owner-SMS/Summary) von der Leitung ab, sobald
    // THINKING_SIGNAL_MAX_CHARS kappt (thinking-signal.js).
    // AL-P17 (E2, Korrektheitsriegel): bis AL-P17 garantierte sideEffectOnlyRound die
    // Ausschliesslichkeit von Streaming und Bruecke - eine armierte Runde war nie eine,
    // die den Loop fortsetzt. Mit E1 faellt diese Garantie: eine Runde mit Text +
    // look_up streamt ihren Text UND liefe hier in speakBridge, das denselben Satz ein
    // ZWEITES Mal auf dieselbe Leitung schriebe. Gelesen wird die vorhandene Invariante
    // speechStreamed ("der AKTUELLE Wert von speech steht bereits auf dem Draht") - kein
    // zweiter Zustand, keine zweite Wahrheit (G5). Der Einmal-pro-Turn-Riegel in
    // thinking-signal.js wird dabei NICHT verbraucht: eine spaetere, nicht armierte Runde
    // darf weiterhin ueberbruecken.
    const bridgeText = loopContinues && !speechStreamed && thinkingSignal.speakBridge(speech);
    if (bridgeText) {
      speech = bridgeText;
      speechStreamed = true;
    }

    // AL-P10b: der EINZIGE await im Tool-Loop neben der Modellrunde. Er steht bewusst
    // NACH der Ueberbrueckung (der Anrufer hoert den Satz, WAEHREND gesucht wird - genau
    // die Reihenfolge, die der AL-P7b-Kommentar oben vorwegnimmt) und VOR dem
    // tool_result-Mapping (das Ergebnis IST das tool_result). execTool bleibt dadurch
    // synchron - die Realtime-Bridge ruft es unveraendert direkt auf.
    // loopContinues wird durchgereicht: endet der Zug ohnehin, wird KEINE Suche
    // ausgeloest und KEINE Gebuehr gebucht (Regel 1).
    const lookup = await performLookupRequest({ call, toolUses: toolCalls, loopContinues });

    // Die Ruecktrage dieser Runde geht OPAK zurueck (llm/ports.js LlmTurn.providerTurn) -
    // ihre Form gehoert dem Adapter, nicht dieser Schleife. Daneben die Ergebnisse aller
    // Werkzeuge der Runde in Aufruf-Reihenfolge.
    messages = [
      ...messages,
      providerTurnMessage(turn.providerTurn),
      toolResultsMessage(
        toolCalls.map((tc) => {
          // end_call ignorieren und das Modell anweisen, auf die Antwort zu warten. Die
          // ZUSTANDS-Entscheidung ist oben gefallen; hier entsteht nur noch der Text.
          const waitsForAnswer = tc.name === END_CALL_TOOL_NAME && suppressEndCall;
          return {
            toolCallId: tc.id,
            text: waitsForAnswer
              ? endCallWaitInstruction(call)
              : toolResultText({ call, toolCall: tc, consult, lookup }),
          };
        }),
      ),
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
  // GQ-P1: die PII-freien Zaehler dieses Turns - identisch fuer den regulaeren UND den
  // verdraengten Ausgang. EINE Quelle (G5) statt zweier Rueckgabe-Literale, die
  // auseinanderdriften. Liest nur, mutiert nichts (N7).
  const turnTelemetry = () => ({
    roundtrips,
    toolNames: firedTools,
    offeredToolNames: [...offeredTools],
    streamArmedRounds,
    stopReason,
  });

  // GQ-P1: der Turn wurde verdraengt - eine vollstaendigere Fassung derselben Aeusserung
  // wird gerade beantwortet. Er hat NICHTS gesprochen (der Sprech-Draht des Shims ist im
  // Moment der Verdraengung stumm), also darf er auch KEINE agent-Zeile ins Transkript
  // schreiben: sie waere im naechsten Turn "bereits Gesagtes" in der Message-Kette und im
  // Dashboard/DSGVO-Export das zweite agent-Segment auf dieselbe Aeusserung - genau der
  // Befund, den dieser Riegel beseitigt. endCall faellt bewusst weg: die Auflege-
  // Entscheidung trifft der Turn, der die VOLLSTAENDIGE Aeusserung beantwortet.
  // stopReason bleibt echt - eine Geld-Achse muss den Shim-Notaus weiter ausloesen.
  if (abortSignal?.aborted)
    return {
      speech: "",
      speechStreamed: false,
      thinkingSignalSpoken: thinkingSignal.spoken(),
      endCall: false,
      superseded: true,
      ...turnTelemetry(),
    };

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
  //
  // AL-P17 (E2, Lesart festgeschrieben): thinkingSignalSpoken bedeutet unveraendert
  // "die BRUECKEN-FUNKTION hat gesprochen" - mechanismus-bezogen, NICHT turn-bezogen
  // ("dieser Turn hat ueberbrueckt"). Die turn-bezogene Lesart braeuchte einen zweiten
  // Schreiber auf dasselbe Feld und machte den turn_ok-Diskriminator mehrdeutig - genau
  // der Fehler, den AL-D2 mit speechWireOpen gerade repariert hat. Folge, ausdruecklich:
  // im heutigen Werkzeugsatz ist jede Runde mit offenem Draht armiert, also ist das Feld
  // in Live-Turns dauerhaft false. Der Live-Diskriminator DIESER Faehigkeit ist deshalb
  // streamArmedRounds (hier) bzw. streamChunks (Shim), nicht thinkingSignalSpoken.
  return {
    speech,
    speechStreamed,
    thinkingSignalSpoken: thinkingSignal.spoken(),
    endCall,
    // GQ-P1: der regulaere Ausgang ist ausdruecklich nicht verdraengt - ein Feld, das nur
    // im Abbruchfall existiert, zwaenge jeden Leser zu einer undefined-Pruefung.
    superseded: false,
    ...turnTelemetry(),
  };
}

// ---------- Summary + Action Items nach dem Call ----------
// AL-P11: Kopf-Budget der Zusammenfassung. 500 trug Summary + Action Items; die
// Ergebnis-Karte kommt mit ~250 Output-Token dazu.
const SUMMARY_MAX_TOKENS = 800;

// FIX-1: GENAU EIN Wiederholversuch - nicht llmMaxRetries (2). Der gemessene Fehlgrund
// war die zu kurze Frist, kein flackerndes Netz; dagegen hilft der eigene Timeout, nicht
// ein dritter Versuch. Jeder weitere Versuch laesst den Anbieter erneut bis zu
// SUMMARY_MAX_TOKENS Ausgabe-Token erzeugen, und ein GESCHEITERTER Versuch wird hier -
// anders als beim Briefing - NICHT geschaetzt gebucht (bookTokenUsage laeuft erst nach
// der Antwort). Diese unsichtbaren Kosten verdreifacht man nicht.
const SUMMARY_MAX_RETRIES = 1;

// Eigene Instanz => eigene Frist UND eigener Breaker (Muster precall-briefing.js). Die
// Zusammenfassung laeuft detached (call-termination.js stoesst bill() fire-and-forget an),
// sie unterliegt also nicht dem Webhook-Hardcut, an dem llmRequestTimeoutMs haengt.
// Bewusste Konsequenz des eigenen Breakers: eine Stoerung der Nachbereitung kann keinen
// laufenden Anruf toeten - und ein Gespraechs-Brownout keine Zusammenfassung verhindern.
const summaryLlm = createSecondaryLlmClient({
  config,
  requestTimeoutMs: config.llm.summaryTimeoutMs,
  maxRetries: SUMMARY_MAX_RETRIES,
  metrics,
});

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

  // GQ-P14 (Befund N-2, Messung M-6): was in DIESEM Anruf bereits notiert ist - dieselbe
  // Liste, die GQ-P10 dem Gespraech gibt, mit der Anweisung fuer die Nachbereitung. Ohne
  // sie entscheidet die Zusammenfassung ueber actionItems, ohne zu wissen, was
  // take_message schon angelegt hat: live wurden daraus drei Eintraege fuer einen
  // Sachverhalt (call_msg0swwfhe5e). GELESEN VOR dem Nachtrag am Ende dieser Funktion -
  // die Liste zeigt den Stand des GESPRAECHS, nie den eigenen Output dieses Laufs.
  const alreadyRecorded = recordedItemsBlock({
    items: store.callActionItems(call.id),
    heading: loc.prompt.recorded.heading,
    guardrail: loc.prompt.recorded.summaryGuardrail,
  });
  // Der Block haengt HINTER dem Transkript: transcriptLabel und convo bleiben ein
  // zusammenhaengender Block, und die Anweisung steht unmittelbar vor der Generierung.
  // Leerer Block -> kein Separator -> byte-identisch zum Bestand (Golden-Master-Pin).
  const summaryInputText =
    `${si.directionLabel} ${call.direction}` +
    (call.goal ? `\n${si.goalLabel} ${call.goal}` : "") +
    `\n\n${si.transcriptLabel}\n${convo}` +
    (alreadyRecorded ? `\n\n${alreadyRecorded}` : "");

  const model = config.llm.claudeModel;
  // O5: die Zitat-Aufforderung existiert nur, wenn die kurze Frist scharf ist. Sonst
  // steht sie nicht einmal im Prompt (kein Zitat, das man verwerfen muesste).
  const evidenceAllowed = evidenceRetentionEnabled(config.privacy);
  const turn = await summaryLlm.complete({
    model,
    // AL-P11: die Karte kostet ~250 zusaetzliche Output-Token an einer Anfrage, die
    // ohnehin laeuft - 500 reichten dafuer nicht mehr zuverlaessig.
    maxTokens: SUMMARY_MAX_TOKENS,
    // Zusammenfassungs-Prompt sprachabhaengig (F1 Phase 2): die Summary entsteht in der
    // Gespraechssprache (de byte-identisch); die JSON-Keys bleiben sprachunabhaengig.
    system: loc.summarySystem(owner) + (evidenceAllowed ? loc.summaryEvidenceClause : ""),
    messages: [
      {
        role: "user",
        content: summaryInputText,
      },
    ],
    callId: call.id, // I13: Bench-Korrelation (llm.js streift callId vor dem SDK-Call ab)
  });
  bookTokenUsage({ tenantId: call.tenantId, callId: call.id, usage: turn.usage });

  let parsed = { summary: "", actionItems: [] };
  try {
    const raw = turn.text || "{}";
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    parsed.summary = turn.text;
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
