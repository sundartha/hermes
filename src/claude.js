// Das "Gehirn": Claude fuehrt das Gespraech, nutzt Tools (Kalender, Termin buchen,
// Nachricht aufnehmen, auflegen) und schreibt am Ende Summary + Action Items.
import { createLlmClient } from "./llm.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { USAGE_EVENT_KIND } from "./store/defaults.js";
import { aiCostCents } from "./store/state-ops.js";
import { localeFor } from "./i18n/locales.js";
import { metrics } from "./metrics.js";

// Resilienter LLM-Seam (src/llm.js): EINE Stelle fuer Timeout/
// selektiven Retry/Breaker. Verdrahtung am Modul-Top, Fachcode ruft nur
// llm.complete(...). Wirft bei Breaker-open/Retries-erschoepft LlmUnavailableError
// (Aufrufer faengt das, degradedSpeechFor aus llm.js); 4xx/Auth propagieren unveraendert.
const llm = createLlmClient({ apiKey: config.llm.anthropicApiKey, config, metrics });

// L3: tatsaechlich verarbeitete Input-Token EINES Anthropic-Aufrufs inkl. Cache. Mit
// Prompt-Caching zaehlt usage.input_tokens nur den UNGECACHTEN Rest; der gecachte
// Praefix erscheint separat als cache_creation_/cache_read_input_tokens. Summe =
// voller Umfang -> Budget-Gate (Regel 1) und Stripe-Meter zaehlen weiter den vollen
// Verbrauch (fail-safe: NIE weniger als ohne Caching). Felder fehlen ohne Cache
// (summarizeCall ohne Tools, Praefix < Modell-Minimum) -> identisch zu input_tokens.
function inputTokensOf(usage) {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0)
  );
}

// AI-Token-Meter EINES Anthropic-Aufrufs (P6b3, Meter 3). NUR im Metering-Pfad
// (PAYMENT_ENABLED) - der Nebeneffekt (recordUsageEvent) steht im Namen. Laeuft
// PARALLEL zum trackUsage-Live-Gate (getrennte Quellen, kein Doppelzaehlen):
// trackUsage fuettert den Budget-Bucket, dieser Meter den Stripe-Ledger. quantity =
// Gesamt-Tokens, costCents aus derselben Preisformel (aiCostCents, G5). callId
// verknuepft den Beleg, ueberlebt aber ein Call-Erase (usage_event ohne call-FK).
function meterAiTokens(call, usage) {
  if (!config.billing.paymentEnabled) return;
  const inputTokens = inputTokensOf(usage);
  store.recordUsageEvent({
    tenantId: call.tenantId,
    callId: call.id,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: inputTokens + usage.output_tokens,
    costCents: aiCostCents(inputTokens, usage.output_tokens, config),
  });
}

// locale (BCP-47) sprachabhaengig vom Aufrufer (call.language -> loc.dateLocale).
// Default "de-DE": Aufrufer ohne Locale (Bestand) bleiben byte-identisch.
const fmtDate = (iso, locale = "de-DE") =>
  new Date(iso).toLocaleString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// ---------- System-Prompts ----------
export function systemPrompt(call) {
  const ctx = store.tenantContext(call.tenantId);
  const s = ctx.settings;
  // LLM-Persona = Vorname (G1, Owner-Entscheidung #1): der Assistent spricht im
  // Gespraech vom Vornamen seines Auftraggebers. Die PFLICHT-Offenlegung weiter unten
  // (disclosureSentence) nennt dagegen den VOLLEN Namen. Beide aus derselben
  // gebundenen Tenant-Identitaet (tenantContext) -> keine Impersonation.
  const owner = ctx.firstName;
  // Sprach-Resolver (F1 Phase 2): loest den frueher toten Kanal call.language in ein
  // Locale auf (Fallback de). Steuert Datums-Locale + Output-Sprach-Regel (Regel 1).
  const loc = localeFor(call.language);
  const now = new Date().toLocaleString(loc.dateLocale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const base = `Du bist "${s.agentName}", der persoenliche KI-Telefonassistent von ${owner}.
Du sprichst gerade LIVE am Telefon. Heute ist ${now}.

REGELN FUERS TELEFONIEREN:
- Antworte KURZ: 1-2 gesprochene Saetze pro Antwort. Kein Markdown, keine Listen, keine Emojis. ${loc.speechClause}
- Sei freundlich, professionell und effizient. ${loc.styleClause(s.agentStyle)}
- Stelle pro Antwort hoechstens eine Frage.
- Reagiere zuerst kurz und natuerlich auf das zuletzt Gesagte (z.B. "Alles klar," / "Gut,"), bevor du weitersprichst.
- Beziehe kurze oder unklare Aeusserungen des Gegenuebers auf deine letzte Frage, statt das Thema zu wechseln.
- Sprich Datum und Uhrzeit natuerlich aus (z.B. "Donnerstag um 17 Uhr"), nie rohe Tool-Formate; keine Klammern, Anfuehrungszeichen oder Gedankenstriche.
- Nenne das Ergebnis eines Tool-Aufrufs in deiner naechsten gesprochenen Antwort - der Gespraechsverlauf ist deine einzige Erinnerung daran.
- Erfinde keine Fakten (Datum, Uhrzeit, Ort), die niemand genannt hat, und behaupte nie, etwas sei erledigt oder gebucht, was du nicht wirklich erledigt hast. Rechne Wochentage oder Kalenderdaten nie selbst aus - nenne sie nur so, wie das Gegenueber oder dein Kalender sie genannt hat.
- Bleibe durchgehend bei der Anrede, mit der du begonnen hast - wechsle nie unaufgefordert vom Sie zum Du.
- Wenn das Anliegen erledigt ist oder das Gespraech zu Ende geht, verabschiede dich und rufe danach das Tool end_call auf.
- Erfinde nichts. Was du nicht weisst, sagst du ehrlich und nimmst stattdessen eine Nachricht auf (take_message).
${s.allowPersonalData ? "" : `- Du darfst KEINE persoenlichen Daten von ${owner} herausgeben (Adresse, E-Mail, private Nummer etc.).`}
${s.allowBankData ? "" : `- Du darfst NIEMALS Bank- oder Zahlungsdaten nennen oder Zahlungen zusagen.`}
${s.allowCalendar ? `- Du darfst ${owner}s Kalender einsehen (get_calendar).` : `- Du hast KEINEN Kalenderzugriff. Bei Terminwuenschen nimmst du nur eine Nachricht auf.`}
${s.allowBooking && s.allowCalendar ? `- Du darfst Termine direkt in ${owner}s Kalender buchen (book_appointment), wenn der Slot frei ist. Fehlt dir fuer den Termin-Titel ein konkreter Anlass, frage NICHT danach - leite einen allgemeinen Titel aus deinem AUFTRAG ab oder nimm den Terminwunsch als Nachricht auf (take_message).` : `- Du darfst KEINE Termine fest buchen, nur Terminwuensche als Nachricht aufnehmen.`}`;

  if (call.direction === "inbound") {
    return `${base}

SITUATION: Jemand hat ${owner} angerufen, ${owner} konnte nicht rangehen, der Anruf wurde an dich weitergeleitet. Anrufernummer: ${call.from}.
Deine Aufgabe: Anliegen herausfinden, wenn moeglich direkt loesen (z.B. Termin vereinbaren), sonst Nachricht aufnehmen. Bei einem Terminwunsch bietest du konkrete freie Zeiten aus ${owner}s Kalender an, statt offen nach einer Wunschzeit zu fragen. ${owner} erhaelt danach automatisch eine Zusammenfassung.${calendarSection(call)}`;
  }

  return `${base}

SITUATION: Du rufst gerade IM AUFTRAG von ${owner} bei ${call.to} an. Du bist der Anrufer. Frage nie nach Thema, Anlass oder Grund deines eigenen Anliegens - die stehen in deinem AUFTRAG. Kurze Abstimmungsfragen (welcher Slot, eine Bestaetigung vor einer Buchung) sind richtig und erwuenscht. Bekommst du mehrere Optionen angeboten, antworte zuerst mit deiner Wahl (z.B. "Der Donnerstag um 9 Uhr passt besser.") - als gebucht oder vereinbart bezeichnest du einen Termin erst, NACHDEM das Gegenueber deiner Wahl zugestimmt hat, nie in derselben Antwort.
DEIN AUFTRAG: ${call.goal}
${call.briefing ? `BRIEFING/KONTEXT: ${call.briefing}` : ""}
${call.constraints ? `EINSCHRAENKUNGEN: ${call.constraints}` : ""}${assistantContextSection(call)}${calendarSection(call)}
WICHTIG: Offenlegung UND dein Anliegen ("${call.goal}") wurden dem Angerufenen bereits zu Beginn des Anrufs woertlich gesagt (LLM-frei, garantiert). Wiederhole sie NICHT. Knuepfe direkt an die Antwort des Angerufenen an und treibe den Auftrag voran.
Erledige zuerst den AUFTRAG vollstaendig und so konkret wie moeglich (Anliegen klaeren, Alternativen abgleichen, zu einem Ergebnis kommen). Danach darfst du hilfreiche Folgeschritte anbieten, z.B. einen Termin eintragen; pruefe Terminvorschlaege gegen ${owner}s Kalender, bevor du zusagst. Fehlt dir dafuer eine Information oder macht das Gegenueber nicht weiter mit, schliesse hoeflich ab - lass den Anruf nie an einem selbst eroeffneten Nebenthema haengen. Warte nach deiner Offenlegung und deinem Anliegen IMMER auf die Antwort des Angerufenen - lege niemals auf, bevor er geantwortet hat. Erst wenn der Auftrag erledigt ist oder das Gespraech endet, verabschiede dich und rufe end_call auf.`;
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
  if (c.recipient_relationship) lines.push(`- Verhaeltnis zum Angerufenen: ${c.recipient_relationship}`);
  if (c.desired_outcome) lines.push(`- Gewuenschtes Ergebnis: ${c.desired_outcome}`);
  if (Array.isArray(c.key_facts) && c.key_facts.length)
    lines.push(`- Wichtige Fakten: ${c.key_facts.join("; ")}`);
  if (!lines.length) return "";
  return `\nHINTERGRUND (nur zu deiner Information):\n${lines.join("\n")}\nDieser Hintergrund ist fuer dich; gib nur weiter, was der Auftrag erfordert.`;
}

// Formatierter Kalender-Auszug (naechste Termine) des Tenants - EINE Quelle (G5) fuer
// das get_calendar-Tool UND die Outbound-Prompt-Einbettung (L2). Datums-Locale folgt
// der Gespraechssprache (wie das Tool-Ergebnis); Wortlaut byte-identisch zur frueheren
// inline-Formatierung im get_calendar-Case. Reiner Read, kein Nebeneffekt (N7).
function calendarExcerpt(call) {
  const dateLocale = localeFor(call.language).dateLocale;
  const events = store.tenantContext(call.tenantId).calendar.slice(0, CALENDAR_PREVIEW_LIMIT);
  if (!events.length) return "Kalender ist leer, alles frei.";
  return (
    "Naechste Termine:\n" +
    events
      .map((e) => `- ${e.title}: ${fmtDate(e.start, dateLocale)} bis ${fmtDate(e.end, dateLocale)}`)
      .join("\n")
  );
}

// Optionaler Kalender-Block fuer den System-Prompt (I6, vormals NUR Outbound/L2):
// bettet den Auszug vorab ein, damit das Modell freie Slots kennt und get_calendar im
// Buchungs-/Terminwunsch-Normalfall nicht erst mid-turn aufrufen muss. Gegated am
// allowCalendar-Gate (massgeblich, fail-closed: aus -> "" -> Prompt byte-identisch).
// Fuehrendes "\n" + leeres "" bei aus spiegeln assistantContextSection (G11).
// Richtungsneutral: outbound bettete den Block schon vorher ein, I6 haengt ihn genauso
// in den Inbound-Zweig (gleiches Gate, EINE Quelle statt zweier Kopien, G5). KEINE neue
// Datenexposition: derselbe Inhalt war schon via get_calendar erreichbar - nur der
// Transportweg aendert sich.
function calendarSection(call) {
  if (!store.tenantContext(call.tenantId).settings.allowCalendar) return "";
  return `\nKALENDER DEINES AUFTRAGGEBERS (bereits abgerufen, du brauchst get_calendar dafuer nicht erneut):\n${calendarExcerpt(call)}`;
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

// Anzahl der naechsten Kalendereintraege im Auszug (G25). EINE Quelle fuer das
// get_calendar-Tool UND die Outbound-Prompt-Einbettung (L2). Modul-Konstante, kein
// Tuning-Knopf -> nicht in config.js (Praezedenz OPENING_GOAL_MAX_CHARS).
const CALENDAR_PREVIEW_LIMIT = 8;

// Tool-Name des end_call-Tools (G25): EINE Quelle fuer Schema-Name/Dispatch-Case/Guard.
const END_CALL_TOOL_NAME = "end_call";

// Default-Termindauer in Minuten, wenn book_appointment kein durationMinutes liefert (G25).
const DEFAULT_EVENT_DURATION_MINUTES = 60;

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
export function toolDefs(tenantId) {
  const s = store.tenantContext(tenantId).settings;
  const tools = [
    // RCA-Wurzel R3: Das Modell schloss aus STT-Kauderwelsch, das Ziel sei
    // erreicht, und rief end_call. Das enge Verbot sitzt deshalb GENAU HIER, am Tool-
    // Entscheidungspunkt (Lehre call-quality-chain: breite Stil-/Meta-Regeln im Prompt-
    // Rumpf kippen bei Haiku in Ueberkorrektur, Verbote an der Tool-Description wirken).
    // Der letzte Satz ist der Ausstieg: er verhindert, dass der Agent aus Vorsicht GAR
    // nicht mehr auflegt. Keine Sprach-Variante noetig - toolDefs ist locale-frei.
    {
      name: END_CALL_TOOL_NAME,
      description:
        "Beendet das Telefonat. IMMER erst aufrufen, NACHDEM du dich verabschiedet hast. " +
        "Rufe end_call NUR auf, wenn du den letzten Beitrag des Gegenuebers verstanden hast. " +
        "War er unverstaendlich oder zusammenhanglos, frage GENAU EINMAL nach, statt aufzulegen; " +
        "bleibt die Antwort danach unverstaendlich, verabschiede dich und rufe end_call auf.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: "Kurzer Grund" } },
        required: [],
      },
    },
    {
      name: "take_message",
      description:
        "Nimmt eine Nachricht / ein Anliegen fuer den Besitzer auf (wird ihm als Action Item zugestellt).",
      input_schema: {
        type: "object",
        properties: { message: { type: "string", description: "Die Nachricht" } },
        required: ["message"],
      },
    },
  ];
  if (s.allowCalendar) {
    tools.push({
      name: "get_calendar",
      description:
        "Liefert die naechsten Kalendereintraege des Besitzers, um freie Zeiten zu finden.",
      input_schema: { type: "object", properties: {}, required: [] },
    });
  }
  if (s.allowCalendar && s.allowBooking) {
    tools.push({
      name: "book_appointment",
      description:
        "Bucht einen Termin fest in den Kalender des Besitzers. Nur nutzen, wenn Datum und Uhrzeit final besprochen sind.",
      input_schema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Termintitel, z.B. 'Friseur Schneider'. Ist kein konkreter Anlass bekannt, bilde den Titel selbst aus deinem Auftrag (z.B. 'Termin: <Anliegen>') - frage den Gespraechspartner NIEMALS nach Thema oder Grund.",
          },
          start: { type: "string", description: "Start als ISO 8601, z.B. 2026-06-15T14:00:00" },
          durationMinutes: {
            type: "number",
            description: `Dauer in Minuten, Default ${DEFAULT_EVENT_DURATION_MINUTES}`,
          },
        },
        required: ["title", "start"],
      },
    });
  }
  return tools;
}

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

export function execTool(call, name, input) {
  // Datums-Locale sprachabhaengig (F1 Phase 2): die im Tool-Ergebnis genannten Termine
  // erscheinen in der Gespraechssprache (fr-FR/de-DE), die der LLM weiterspricht.
  const dateLocale = localeFor(call.language).dateLocale;
  switch (name) {
    // READ ueber den Seam (Identitaets-Konsument): calendarExcerpt liest den
    // pro-Tenant-Kalender (calendarFor). Konsistent zur Schreib-/Konflikt-Seite
    // (book_appointment: findConflict/addCalendarEvent ueber call.tenantId). EINE Quelle
    // (G5) fuer Tool-Ausgabe UND Outbound-Prompt-Einbettung (L2).
    case "get_calendar":
      return calendarExcerpt(call);
    case "book_appointment": {
      const start = new Date(input.start);
      if (isNaN(start)) return "FEHLER: Ungueltiges Datum.";
      const end = new Date(
        start.getTime() + (input.durationMinutes || DEFAULT_EVENT_DURATION_MINUTES) * 60000,
      );
      const conflict = store.findConflict(call.tenantId, start.toISOString(), end.toISOString());
      if (conflict)
        return `KONFLIKT: Ueberschneidung mit "${conflict.title}" (${fmtDate(conflict.start, dateLocale)}). Bitte anderen Slot vorschlagen.`;
      store.addCalendarEvent(call.tenantId, input.title, start.toISOString(), end.toISOString());
      store.addActionItem(
        call.id,
        `Termin gebucht: ${input.title} am ${fmtDate(start.toISOString(), dateLocale)}`,
        "appointment",
      );
      return `GEBUCHT: ${input.title} am ${fmtDate(start.toISOString(), dateLocale)}.`;
    }
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
// config.callerSubstanceMinLen). Genutzt fuer den content-basierten suppressEndCall (beide
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

// EINE strukturell erzwungene Invariante (G27): der Outbound-Frueh-
// auflege-Schutz gilt fuer JEDE Voice-Engine (Budget-agentTurn UND Realtime-bridge.js),
// nicht mehr nur per Kommentar. Unterdrueckt end_call, solange (i) keine SUBSTANZIELLE
// Anrufer-Aeusserung vorliegt UND (ii) die Zahl konsekutiver Leer-Turns die Schwelle
// (maxEmptyTurns) noch nicht erreicht hat. Nur Outbound; Inbound liefert immer false
// (Direction-Kurzschluss zuerst -> robust auch ohne transcript-Feld). Rein, kein
// Nebeneffekt (N7). unansweredAgentTurns bleibt modul-privat.
export function shouldSuppressEndCall(call) {
  if (call.direction !== "outbound") return false;
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

  // Tool-Loop (max. 4 Runden pro Turn)
  for (let i = 0; i < 4; i++) {
    const resp = await llm.complete({
      model: config.llm.claudeModel,
      max_tokens: 300,
      system: [{ type: "text", text: systemPrompt(call), cache_control: CACHE_CONTROL_EPHEMERAL }],
      tools: toolsWithCacheControl(toolDefs(call.tenantId)),
      messages,
      callId: call.id, // I13: Bench-Korrelation (llm.js streift callId vor dem SDK-Call ab)
    });
    roundtrips += 1;
    store.trackUsage(call.tenantId, inputTokensOf(resp.usage), resp.usage.output_tokens, config);
    meterAiTokens(call, resp.usage);

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

  const resp = await llm.complete({
    model: config.llm.claudeModel,
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
  store.trackUsage(call.tenantId, inputTokensOf(resp.usage), resp.usage.output_tokens, config);
  meterAiTokens(call, resp.usage);

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
