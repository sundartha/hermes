// Das "Gehirn": Claude fuehrt das Gespraech, nutzt Tools (Kalender, Termin buchen,
// Nachricht aufnehmen, auflegen) und schreibt am Ende Summary + Action Items.
import { createLlmClient } from "./llm.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { USAGE_EVENT_KIND } from "./store/defaults.js";
import { aiCostCents } from "./store/state-ops.js";
import { localeFor } from "./i18n/locales.js";

// Resilienter LLM-Seam (P3b-R Schicht 2, src/llm.js): EINE Stelle fuer Timeout/
// selektiven Retry/Breaker. Verdrahtung am Modul-Top (P15), Fachcode ruft nur
// llm.complete(...). Wirft bei Breaker-open/Retries-erschoepft LlmUnavailableError
// (Aufrufer behandelt das in CP4); 4xx/Auth propagieren unveraendert.
const llm = createLlmClient({ apiKey: config.anthropicApiKey, config });

// AI-Token-Meter EINES Anthropic-Aufrufs (P6b3, Meter 3). NUR im Metering-Pfad
// (PAYMENT_ENABLED) - der Nebeneffekt (recordUsageEvent) steht im Namen. Laeuft
// PARALLEL zum trackUsage-Live-Gate (getrennte Quellen, kein Doppelzaehlen):
// trackUsage fuettert den Budget-Bucket, dieser Meter den Stripe-Ledger. quantity =
// Gesamt-Tokens, costCents aus derselben Preisformel (aiCostCents, G5). callId
// verknuepft den Beleg, ueberlebt aber ein Call-Erase (usage_event ohne call-FK).
function meterAiTokens(call, usage) {
  if (!config.paymentEnabled) return;
  store.recordUsageEvent({
    tenantId: call.tenantId,
    callId: call.id,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: usage.input_tokens + usage.output_tokens,
    costCents: aiCostCents(usage.input_tokens, usage.output_tokens, config),
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
- Wenn das Anliegen erledigt ist oder das Gespraech zu Ende geht, verabschiede dich und rufe danach das Tool end_call auf.
- Erfinde nichts. Was du nicht weisst, sagst du ehrlich und nimmst stattdessen eine Nachricht auf (take_message).
${s.allowPersonalData ? "" : `- Du darfst KEINE persoenlichen Daten von ${owner} herausgeben (Adresse, E-Mail, private Nummer etc.).`}
${s.allowBankData ? "" : `- Du darfst NIEMALS Bank- oder Zahlungsdaten nennen oder Zahlungen zusagen.`}
${s.allowCalendar ? `- Du darfst ${owner}s Kalender einsehen (get_calendar).` : `- Du hast KEINEN Kalenderzugriff. Bei Terminwuenschen nimmst du nur eine Nachricht auf.`}
${s.allowBooking && s.allowCalendar ? `- Du darfst Termine direkt in ${owner}s Kalender buchen (book_appointment), wenn der Slot frei ist.` : `- Du darfst KEINE Termine fest buchen, nur Terminwuensche als Nachricht aufnehmen.`}`;

  if (call.direction === "inbound") {
    return `${base}

SITUATION: Jemand hat ${owner} angerufen, ${owner} konnte nicht rangehen, der Anruf wurde an dich weitergeleitet. Anrufernummer: ${call.from}.
Deine Aufgabe: Anliegen herausfinden, wenn moeglich direkt loesen (z.B. Termin vereinbaren), sonst Nachricht aufnehmen. ${owner} erhaelt danach automatisch eine Zusammenfassung.`;
  }

  return `${base}

SITUATION: Du rufst gerade IM AUFTRAG von ${owner} bei ${call.to} an. Du bist der Anrufer.
DEIN AUFTRAG: ${call.goal}
${call.briefing ? `BRIEFING/KONTEXT: ${call.briefing}` : ""}
${call.constraints ? `EINSCHRAENKUNGEN: ${call.constraints}` : ""}
WICHTIG: Offenlegung UND dein Anliegen ("${call.goal}") wurden dem Angerufenen bereits zu Beginn des Anrufs woertlich gesagt (LLM-frei, garantiert). Wiederhole sie NICHT. Knuepfe direkt an die Antwort des Angerufenen an und treibe den Auftrag voran.
Erledige den Auftrag so konkret wie moeglich (Termin nennen lassen, Alternativen abgleichen, zusagen). Pruefe Terminvorschlaege gegen ${owner}s Kalender, bevor du zusagst. Sage nichts zu, was ausserhalb deines Auftrags liegt. Warte nach deiner Offenlegung und deinem Anliegen IMMER auf die Antwort des Angerufenen - lege niemals auf, bevor er geantwortet hat. Erst wenn der Auftrag erledigt ist oder das Gespraech endet, verabschiede dich und rufe end_call auf.`;
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

// Erst-Turn-Text fuer den LLM-FREIEN /voice/outbound-Pfad (G2): Offenlegung (Regel 2,
// erster Satz) + Bruecke + gekapptes Anliegen, in EINEM Gather-Say. Rein synchron,
// kein Anthropic-Pfad. Das Anliegen wird hier deterministisch genannt; der erste
// LLM-Turn (systemPrompt) wiederholt es daher NICHT.
export function openingText(call) {
  const disclosure = disclosureSentence(call);
  const goal = trimGoalForSpeech(call.goal);
  if (!goal) return disclosure;
  // Sprachabhaengige Bruecke aus dem Bundle (de: "Ich rufe an, weil ...", byte-identisch).
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
    {
      name: "end_call",
      description:
        "Beendet das Telefonat. IMMER erst aufrufen, NACHDEM du dich verabschiedet hast.",
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
          title: { type: "string", description: "Termintitel, z.B. 'Friseur Schneider'" },
          start: { type: "string", description: "Start als ISO 8601, z.B. 2026-06-15T14:00:00" },
          durationMinutes: { type: "number", description: "Dauer in Minuten, Default 60" },
        },
        required: ["title", "start"],
      },
    });
  }
  return tools;
}

export function execTool(call, name, input) {
  // Datums-Locale sprachabhaengig (F1 Phase 2): die im Tool-Ergebnis genannten Termine
  // erscheinen in der Gespraechssprache (fr-FR/de-DE), die der LLM weiterspricht.
  const dateLocale = localeFor(call.language).dateLocale;
  switch (name) {
    case "get_calendar": {
      // READ ueber den Seam (Identitaets-Konsument): ctx.calendar ist der
      // pro-Tenant-Kalender (calendarFor). Konsistent zur Schreib-/Konflikt-Seite
      // (book_appointment: findConflict/addCalendarEvent ueber call.tenantId).
      const events = store.tenantContext(call.tenantId).calendar.slice(0, 8);
      if (!events.length) return "Kalender ist leer, alles frei.";
      return (
        "Naechste Termine:\n" +
        events
          .map(
            (e) =>
              `- ${e.title}: ${fmtDate(e.start, dateLocale)} bis ${fmtDate(e.end, dateLocale)}`,
          )
          .join("\n")
      );
    }
    case "book_appointment": {
      const start = new Date(input.start);
      if (isNaN(start)) return "FEHLER: Ungueltiges Datum.";
      const end = new Date(start.getTime() + (input.durationMinutes || 60) * 60000);
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
    case "end_call":
      return "OK";
    default:
      return "Unbekanntes Tool.";
  }
}

// ---------- Gespraechs-Turn ----------
// Liefert { speech, endCall } und fuehrt Tool-Aufrufe serverseitig aus.
export async function agentTurn(call, callerText) {
  if (callerText) store.addTranscript(call.id, "caller", callerText);

  // Verlauf -> Messages (Transkript kompakt halten: letzte 24 Beitraege)
  const history = call.transcript.slice(-24).map((t) => ({
    role: t.role === "agent" ? "assistant" : "user",
    content: t.text,
  }));
  if (!history.length || history[history.length - 1].role !== "user") {
    history.push({
      role: "user",
      content:
        call.direction === "outbound"
          ? "[Der Angerufene hat abgenommen. Beginne das Gespraech.]"
          : "[Der Anrufer ist in der Leitung. Begruesse ihn.]",
    });
  }

  // T1-Sicherungsboden (docs/strategy/call-debug.md 3.2): Im ersten Outbound-Turn -
  // bevor der Angerufene ueberhaupt etwas gesagt hat - darf der Agent nicht auflegen.
  // Solange keine role:caller-Zeile existiert, wird ein end_call unterdrueckt; der
  // Webhook rendert dann ein <Gather> (STT bleibt scharf) statt eines stummen Hangups.
  // Nur Outbound - Inbound bleibt unveraendert.
  const suppressEndCall =
    call.direction === "outbound" && !call.transcript.some((t) => t.role === "caller");

  let messages = history;
  let endCall = false;
  let suppressedEndCall = false;
  let speech = "";

  // Tool-Loop (max. 4 Runden pro Turn)
  for (let i = 0; i < 4; i++) {
    const resp = await llm.complete({
      model: config.claudeModel,
      max_tokens: 300,
      system: systemPrompt(call),
      tools: toolDefs(call.tenantId),
      messages,
    });
    store.trackUsage(call.tenantId, resp.usage.input_tokens, resp.usage.output_tokens, config);
    meterAiTokens(call, resp.usage);

    const textParts = resp.content.filter((b) => b.type === "text").map((b) => b.text);
    if (textParts.length) speech = textParts.join(" ").trim();

    const toolUses = resp.content.filter((b) => b.type === "tool_use");
    if (!toolUses.length) break;

    messages = [
      ...messages,
      { role: "assistant", content: resp.content },
      {
        role: "user",
        content: toolUses.map((tu) => {
          if (tu.name === "end_call") {
            if (suppressEndCall) {
              // end_call ignorieren und das Modell anweisen, auf die Antwort zu warten.
              suppressedEndCall = true;
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content:
                  "Der Angerufene hat noch nichts gesagt. Lege nicht auf - warte auf seine Antwort.",
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

  if (!speech) speech = "Alles klar, vielen Dank fuer Ihren Anruf. Auf Wiederhoeren!";
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
    model: config.claudeModel,
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
  });
  store.trackUsage(call.tenantId, resp.usage.input_tokens, resp.usage.output_tokens, config);
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
