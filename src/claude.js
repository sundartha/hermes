// Das "Gehirn": Claude fuehrt das Gespraech, nutzt Tools (Nachricht aufnehmen,
// auflegen) und schreibt am Ende Summary + Action Items.
import { createLlmClient } from "./llm.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { MANDATE_OUT_OF_SCOPE_DEFAULT, resolveTimezone } from "./store/defaults.js";
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
function assignmentBlock(p) {
  const { call, loc } = p;
  const t = loc.prompt;
  const lines = [`${t.goalLabel} ${call.goal}`];
  if (call.briefing) lines.push(`${t.briefingLabel} ${call.briefing}`);
  if (call.constraints) lines.push(`${t.constraintsLabel} ${call.constraints}`);
  return lines.join("\n") + assistantContextSection(p);
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
// Tool-Name des take_message-Tools (G25, P11): der Name wird jetzt an drei Stellen
// gebraucht (Schema, Dispatch, Test) - EINE Quelle statt eines zweiten Literals.
const TAKE_MESSAGE_TOOL_NAME = "take_message";

// AL-P4: die zwei Werkzeug-KLASSEN des Tool-Loops (G25, EINE Quelle).
// nur-Seiteneffekt = das tool_result traegt KEINE Information, auf die das Modell noch
// antworten muesste (end_call -> "OK", take_message -> "Nachricht ist notiert."). Genau
// dann darf der Loop nach diesem Roundtrip enden, sobald bereits Text vorliegt - der
// zweite llm.complete-Roundtrip war reine Latenz.
// informationsliefernd = alles NICHT Gelistete (heute keines; kuenftig look_up/get_consult).
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
  if (callerText) {
    store.addTranscript(call.id, "caller", callerText);
    // AL-P1 (Abbruch-Achse): derselbe Riegel wie das Transkript-Recording - genau dann,
    // wenn der Anrufer wirklich etwas gesagt hat. Purge-fest (purgeTranscript leert nur
    // transcript). BEWUSSTE GRENZE: der Realtime-Pfad (bridge.js) laeuft nicht durch
    // agentTurn und zaehlt nicht mit - er ist nicht der live laufende Pfad (O1).
    store.countCallerTurn(call.id);
  }

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
      tools: toolsWithCacheControl(toolDefs(call.language)),
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
                content: endCallWaitInstruction(call),
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
    //
    // AL-P4: derselbe Ausstieg gilt fuer JEDEN Roundtrip, der ausschliesslich
    // Seiteneffekt-Werkzeuge angefordert hat - deren tool_result traegt nichts, worauf das
    // Modell noch antworten muesste (bisher lief nach take_message unbedingt eine zweite
    // llm.complete-Runde, ~1,4-1,9 s pro Turn). Die Bedingung wird dabei NUR ERWEITERT,
    // nie verengt: der end_call-Arm bleibt eigenstaendig stehen, damit ein end_call NEBEN
    // einem unbekannten Werkzeug weiterhin auflegt statt eine Runde nachzulegen.
    // Bei leerem speech aendert sich nichts - der schlechteste Fall ist Bestandsverhalten.
    const sideEffectOnlyRound = toolUses.every((tu) => isSideEffectOnlyTool(tu.name));
    if (speech && (endCall || suppressedEndCall || sideEffectOnlyRound)) break;
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
  // AL-P1: roundtrips/firedTools wurden bisher NUR in metrics.logTurn geschrieben - und der
  // Seam steht hinter METRICS_ENABLED (Fallback false), war live also stumm. Genau auf
  // diesen zwei Zahlen stehen die Abnahmen ab Phase 3/4. Sie wandern deshalb zusaetzlich
  // in den Rueckgabewert; metrics.logTurn bleibt UNVERAENDERT (sein Payload-Schluesselsatz
  // ist in test/l0-metrics.test.js woertlich gepinnt). EINE Quelle bleibt firedTools.
  // toolNames statt tools: es sind NAMEN - genau daran haengt die PII-Freiheit der Logzeile.
  return { speech, endCall, roundtrips, toolNames: firedTools };
}

// ---------- Summary + Action Items nach dem Call ----------
export async function summarizeCall(call) {
  const ctx = store.tenantContext(call.tenantId);
  const s = ctx.settings;
  const owner = ctx.ownerName;
  if (!s.allowSummaries) return null;
  if (!call.transcript.length) return null;

  // P11: die Rollen-/Feld-Labels des Zusammenfassungs-Inputs sind sprachabhaengig
  // (loc.prompt.summaryInput, DE byte-identisch); die JSON-Keys der Modell-Antwort
  // (summarySystem oben) bleiben sprachunabhaengig.
  const si = localeFor(call.language).prompt.summaryInput;
  const convo = call.transcript
    .map((t) => `${t.role === "agent" ? si.agentRole : si.callerRole}: ${t.text}`)
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
  store.save();
  for (const item of parsed.actionItems || []) store.addActionItem(call.id, item, "todo");
  return parsed;
}
