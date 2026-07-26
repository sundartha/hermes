// MCP-Tool-Definitionen (gemeinsam fuer stdio-Transport und Streamable HTTP /mcp).
// Die Tools sprechen mit der REST-API des Gateways.
import { z } from "zod";
import { uiRendererFor } from "./ui/registry.js";
import { WIDGET_AGENT_STATUS } from "./ui/adapters/mcp-native.js";
// Neue Widgets aus der kanonischen Quelle (widget-catalog.js); der mcp-native-Re-Export
// oben ist historisch (siehe Datei-Kommentar dort).
import {
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALENDAR,
  WIDGET_CALL,
} from "./ui/widget-catalog.js";
import { MAX_CALL_DURATION_CAP_S, MANDATE_OUT_OF_SCOPE_VALUES } from "./store/defaults.js";
import { config, resolveGatewayUrl } from "./config.js";
import { localeFor } from "./i18n/locales.js";
import { MCP_ERROR_CODE } from "./i18n/mcp-texts.js";

// Letzte N Transkriptzeilen fuer get_call_status (G25, kein Magic-Wert im Slice).
const LAST_TRANSCRIPT_LINES = 6;

// identity (optional): wird als interner X-Internal-Identity-Header an die localhost-
// REST-API gereicht und dient seit Phase S nur noch Audit/requestedBy (Forensik), NICHT
// mehr dem Rechteprofil. Das Gateway akzeptiert den Header nur von localhost-Sockets.
// scopedTenant (optional, AM6): am /mcp-Gateway aufgeloester Request-Tenant, als
// X-Internal-Tenant gereicht (ebenfalls nur localhost akzeptiert). Das Rechteprofil laeuft
// seit Phase S ueber diese Tenant-Achse (resolveProfile(scopedTenant)). Ohne scopedTenant
// -> Owner/Bootstrap.
async function api(method, path, body, identity, scopedTenant) {
  const headers = { "Content-Type": "application/json" };
  if (identity) headers["X-Internal-Identity"] = identity;
  if (scopedTenant) headers["X-Internal-Tenant"] = scopedTenant;
  // Zur Aufrufzeit gelesen (server.js setzt GATEWAY_URL ggf. erst beim Start)
  const res = await fetch(resolveGatewayUrl() + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const text = (s) => ({
  content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }],
});
// Fehler-Tool-Ergebnis (MCP-Konvention isError): der LLM-Client sieht eine klare,
// generische Meldung statt eines process-level Crashes. KEIN roher Gateway-Body.
const errText = (s) => ({ content: [{ type: "text", text: s }], isError: true });
// Datums-/Zeitformat der Tenant-Sprache (FMT-03). dateLocale kommt aus DEMSELBEN
// Locale-Bundle wie der Anrufpfad (claude.js promptInputs) - kein zweites "de-DE"-
// Literal in dieser Datei. Fabrik statt drittem Argument an pickCall/pickCalendarEntry:
// die Bindung passiert EINMAL je Registrierung (registerTools), nicht je Zeile.
const makeDateFormatter = (dateLocale) => (iso) =>
  new Date(iso).toLocaleString(dateLocale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// AC5 Result-Guard: prueft, ob das api()-Ergebnis die erwarteten Felder mit dem
// erwarteten Typ traegt, BEVOR ein Handler verschachtelt deref't. api() degradiert
// bei Parse-Fehler zu `{}` (mcp-tools.js: res.json().catch(() => ({}))); ein blinder
// Deref (`s.calendar.length`, `r.callId`) crasht darauf mit TypeError. Geprueft wird
// Existenz/Typ, NICHT Nicht-Leere (leerer Kalender `[]` bleibt valide). Wirft eine
// generische, provider-freie Tool-Fehlermeldung (kein roher Gateway-Body, Regel 5).
// Tool-Fehler mit stabiler, sprachneutraler Kennung (P12): der Wurf legt NUR den Code
// fest, die Uebersetzung passiert an EINER Kante (wrapHandler). Vorher war der deutsche
// Klartext selbst das Format zwischen Wurf und Kante - jede Sprachverzweigung haette
// ihn an beiden Enden duplizieren muessen (G5).
class ToolError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireFields(obj, specs) {
  if (obj == null || typeof obj !== "object") throw new ToolError(MCP_ERROR_CODE.UPSTREAM_INVALID);
  for (const [field, type] of Object.entries(specs)) {
    const v = obj[field];
    const ok =
      type === "array"
        ? Array.isArray(v)
        : type === "object"
          ? v != null && typeof v === "object"
          : typeof v === type;
    if (!ok) throw new ToolError(MCP_ERROR_CODE.UPSTREAM_INCOMPLETE);
  }
  return obj;
}

// Status-Mapping laut Vertrag: dialing | in_progress | completed | failed | cancelled
function mapStatus(c) {
  if (c.status === "active") return c.answeredAt ? "in_progress" : "dialing";
  return c.status;
}
// Vergangene Zeit seit Anrufstart (startedAt), monoton wachsend. Anker fest auf
// startedAt - KEIN answeredAt-Fallback: bei markAnswered wuerde der Anker sonst
// vorspringen und die angezeigte Dauer rueckwaerts springen (z.B. 3->2). Reiner
// Anzeigewert; abgerechnet wird separat ueber voiceMinutesOf (answeredAt..endedAt).
function durationS(c) {
  const start = c.startedAt;
  const end = c.endedAt || new Date().toISOString();
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
}

// Daten-Kontrakt get_call_status (P1-Spec Abschnitt 5): GENAU diese Felder duerfen
// nach aussen (structuredContent + Text + Widget). Whitelist, keine Blacklist. Sitzt
// NACH der Tenant-Aufloesung (Gateway) und VOR jeder Sicht - eine einzige Stelle.
// Kein Secret/Identitaet/Audio/Cross-Tenant-Feld passiert diese Funktion.
function pickCallStatus(callId, c, texts) {
  return {
    call_id: callId,
    status: mapStatus(c),
    duration_s: durationS(c),
    last_transcript_lines: c.transcript
      .slice(-LAST_TRANSCRIPT_LINES)
      .map((t) => `${t.role === "agent" ? texts.roleAgent : texts.roleCounterparty}: ${t.text}`),
    // CDF1: PII-freier Fehlergrund NICHT erfolgreicher Calls. Erfolgreich/aktiv -> null
    // (Shape stabil; bestehende Felder unveraendert). Reines Whitelist-Feld, kein Roh-Durchstich.
    failure_reason: c.failureReason ?? null,
  };
}

// outputSchema fuer get_call_status: validiert GENAU die Whitelist (Stufe 0,
// schema-validiert). Modul-Konstante (G35, an einer Stelle).
const CALL_STATUS_OUTPUT = {
  call_id: z.string(),
  status: z.string(),
  duration_s: z.number(),
  last_transcript_lines: z.array(z.string()),
  failure_reason: z.string().nullable(),
};

// Daten-Kontrakt get_transcript (Strategie Abschnitt 5.1, DSGVO): GENAU diese Felder
// duerfen nach aussen (structuredContent + Text + Widget). Das Roh-Transkript
// (c.transcript: role/text/t) wird NIE durchgereicht - es wird serverseitig nach der
// Summary gepurged (P8a) und faellt hier per Whitelist (nicht Blacklist) ohnehin raus.
// EIN Filter, VOR jeder Sicht (Pre-Mortem #1).
function pickTranscript(callId, c) {
  return {
    call_id: callId,
    result_summary:
      c.summary ||
      "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)",
    objective_achieved: c.objectiveAchieved ?? "unclear",
  };
}

// outputSchema fuer get_transcript: validiert GENAU die Whitelist. objective_achieved
// ist true|false|"unclear" (Bool oder String), daher union.
const TRANSCRIPT_OUTPUT = {
  call_id: z.string(),
  result_summary: z.string(),
  objective_achieved: z.union([z.boolean(), z.string()]),
};

// I10 (call-quality Impl-1): additives Meta, WAS vom optionalen place_call-context
// tatsaechlich beim Gateway ankam - NUR bool/count, NIE der Kontext-Inhalt selbst
// (kein zweiter Transportweg fuer HINTERGRUND-Daten). Hilft dem aufrufenden Chat-LLM,
// einen stillschweigend ignorierten Kontext zu erkennen (S2 aus
// tasks/call-quality-findings.md: place_call meldete nie, was ankam).
const CONTEXT_RECEIVED_OUTPUT = z.object({
  active: z.boolean(),
  summary: z.boolean(),
  key_facts_count: z.number(),
  recipient_relationship: z.boolean(),
  desired_outcome: z.boolean(),
});

// outputSchema fuer place_call (W2, vereinte Live-Karte WIDGET_CALL): Obermenge aus
// CALL_STATUS_OUTPUT (dialing/in_progress/...-Felder) plus den beiden Abschluss-Feldern
// aus dem get_transcript-Kontrakt (result_summary/objective_achieved), hier initial NULL
// (der Anruf hat gerade erst begonnen - das Widget pollt Status/Ergebnis selbst nach),
// plus dem additiven context_received-Meta (I10). Modul-Konstante bei den anderen
// *_OUTPUT (G35), EIN Spread statt Redefinition (G5/S2).
const CALL_OUTPUT = {
  ...CALL_STATUS_OUTPUT,
  result_summary: z.string().nullable(),
  objective_achieved: z.union([z.boolean(), z.string()]).nullable(),
  context_received: CONTEXT_RECEIVED_OUTPUT,
};

// I10: defensive Normalisierung des context_received-Metas aus der Gateway-Antwort
// (Result-Guard-Geist wie requireFields, aber NICHT werfend): ein Gateway-Body ohne das
// additive Feld (z.B. ein aelterer Mock in Tests) darf den Handler NICHT crashen lassen -
// fail-closed auf "kein Kontext angekommen" (alles false/0), NIE auf Verdacht "aktiv".
function normalizeContextReceived(cr) {
  return {
    active: !!cr?.active,
    summary: !!cr?.summary,
    key_facts_count: typeof cr?.key_facts_count === "number" ? cr.key_facts_count : 0,
    recipient_relationship: !!cr?.recipient_relationship,
    desired_outcome: !!cr?.desired_outcome,
  };
}

// Berechtigungen als EIN flacher String (passt in genau einen data-mcp-Slot, W1-Binding
// rendert Nicht-Arrays via textContent). EINE Quelle - auch der Stufe-0-Textblock liest
// data.permissions (keine Duplizierung der allow*-Formatierung, G5/S2).
// Kalender/Buchen entfielen mit P1b - der Agent hat diese Faehigkeiten nicht mehr.
function permissionsSummary(settings) {
  return (
    `Summaries=${settings.allowSummaries}, PersoenlicheDaten=${settings.allowPersonalData}, ` +
    `Bankdaten=${settings.allowBankData}`
  );
}

// Nachkommastellen der Kostenbetraege im get_agent_status-Textblock (G25: benannte
// Konstante statt dreimal nackter Literal-3 fuer costEur/spendMonthCostEur/reservedEur).
const AGENT_STATUS_COST_DIGITS = 3;
function costDigits(amount) {
  return amount.toFixed(AGENT_STATUS_COST_DIGITS);
}

// Anzeige-Waehrung == Belastungs-Waehrung (MCP-08 / Owner-Entscheidung 7.1): das Label
// folgt IMMER config.billing.paymentCurrency, nie einem Literal. Zur AUFRUFZEIT gelesen,
// nicht beim Modul-Load: die Konfiguration ist ein Laufzeit-Objekt.
function chargeCurrencyLabel() {
  return config.billing.paymentCurrency.toUpperCase();
}

// Daten-Kontrakt get_agent_status (W3-Spec): GENAU diese flachen Eigen-Felder duerfen
// nach aussen (structuredContent + Text + Widget). Whitelist, keine Blacklist. number/
// owner koennen fail-closed leer sein (kein aktiver Nummern-Seed / Tenant ohne
// ownerName) -> auf null normalisiert, damit der Schluessel erhalten bleibt und das
// Schema (nullable) NICHT zu isError fuehrt. Kein Secret/internes Feld passiert hier.
function pickAgentStatus(s) {
  return {
    number: s.agent.number ?? null,
    owner: s.agent.owner ?? null,
    voiceEngine: s.agent.voiceEngine,
    model: s.agent.model,
    calls: s.usage.calls,
    costEur: s.usage.costEur,
    tenantCapEur: s.usage.tenantCapEur,
    // P5b: dieselben drei TENANT-EIGENEN Felder wie /api/state.usage (eine Quelle,
    // keine zweite Ableitung) - Spend-Monat-Verbrauch/-Schluessel + eigene Reserve.
    spendMonthCostEur: s.usage.spendMonthCostEur,
    spendMonthKey: s.usage.spendMonthKey,
    reservedEur: s.usage.reservedEur,
    permissions: permissionsSummary(s.settings),
  };
}

// outputSchema fuer get_agent_status: validiert GENAU die Whitelist (Stufe 0
// schema-validiert). number/owner nullable (fail-closed leer ist ein gueltiger Zustand).
// spendMonthKey nullable (unlesbare Uhr -> null, s. spendMonthWindowKey).
const AGENT_STATUS_OUTPUT = {
  number: z.string().nullable(),
  owner: z.string().nullable(),
  voiceEngine: z.string(),
  model: z.string(),
  calls: z.number(),
  costEur: z.number(),
  tenantCapEur: z.number(),
  spendMonthCostEur: z.number(),
  spendMonthKey: z.string().nullable(),
  reservedEur: z.number(),
  permissions: z.string(),
};

// Daten-Kontrakt get_my_number: GENAU das eine Eigen-Feld number. Whitelist, keine
// Blacklist. number kann fail-closed leer sein (kein aktiver Nummern-Seed) -> auf null
// normalisiert (Schema nullable), damit der Schluessel erhalten bleibt.
function pickMyNumber(s) {
  return { number: s.agent.number ?? null };
}
const MY_NUMBER_OUTPUT = { number: z.string().nullable() };

// Daten-Kontrakt list_calls: pro Eintrag GENAU diese Eigen-Felder. counterparty ist die
// Gegenseite (to bei outbound, from bei inbound), status via mapStatus, startedAt
// server-seitig formatiert (formatDate - eine Quelle, derselbe Formatter wie der Stufe-0-Text).
// summary optional. Kein Roh-Transkript/Audio/internes Feld passiert diese Funktion.
// counterparty nullable: eine einzelne defekte Zeile darf nicht die ganze Liste killen.
function pickCall(c, formatDate) {
  const entry = {
    id: c.id,
    direction: c.direction,
    counterparty: (c.direction === "outbound" ? c.to : c.from) ?? null,
    status: mapStatus(c),
    startedAt: formatDate(c.startedAt),
  };
  if (c.summary) entry.summary = c.summary;
  return entry;
}
const CALL_LIST_ENTRY = z.object({
  id: z.string(),
  direction: z.string(),
  counterparty: z.string().nullable(),
  status: z.string(),
  startedAt: z.string(),
  summary: z.string().optional(),
});
const CALLS_OUTPUT = { calls: z.array(CALL_LIST_ENTRY) };

// Stufe-0-Textzeile eines Calls aus den GEWHITELISTETEN Feldern (eine Quelle: kein
// zweites Aufloesen von to/from/status/Datum). Format byte-identisch zum Bestand.
function callTextLine(e) {
  const arrow = e.direction === "outbound" ? "->" : "<-";
  return `[${e.id}] ${arrow} ${e.counterparty} | ${e.status} | ${e.startedAt}${e.summary ? " | " + e.summary : ""}`;
}

// Daten-Kontrakt get_calendar: pro Eintrag GENAU title/start/end (start/end server-seitig
// formatiert via formatDate - eine Quelle, derselbe Formatter wie der Stufe-0-Text). title
// nullable (Robustheit, eine defekte Zeile killt nicht die Liste). Kein internes Feld.
function pickCalendarEntry(e, formatDate) {
  return { title: e.title ?? null, start: formatDate(e.start), end: formatDate(e.end) };
}
const CALENDAR_ENTRY = z.object({
  title: z.string().nullable(),
  start: z.string(),
  end: z.string(),
});
const CALENDAR_OUTPUT = { calendar: z.array(CALENDAR_ENTRY) };

// ctx (Phase 2): { identity, scopedTenant, allowCalendar }. identity wird per Closure
// an jeden REST-Aufruf gehaengt (X-Internal-Identity); scopedTenant (AM6) ebenso als
// X-Internal-Tenant (am /mcp-Gateway aufgeloest). allowCalendar steuert, ob das
// get_calendar-Tool ueberhaupt registriert wird. stdio ruft registerTools(server)
// ohne ctx -> identity/scopedTenant null (Owner), allowCalendar true.
// language (P12): die BEREITS aufgeloeste Tenant-Sprache. Aufgeloest wird sie am
// Transport (routes/mcp.js) mit derselben Funktion wie im Anrufpfad (views.tenantLanguage
// -> resolveCallLanguage) - hier gibt es KEINE zweite Aufloesungsregel. Fehlt sie
// (stdio-Transport, der keinen Store hat), faellt localeFor() fail-safe auf den
// Weltdefault zurueck (R7) - derselbe eine Fallback wie ueberall sonst.
export function registerTools(
  server,
  { identity = null, scopedTenant = null, allowCalendar = true, uiHost = null, language = null } = {},
) {
  const call = (method, path, body) => api(method, path, body, identity, scopedTenant);
  const loc = localeFor(language); // Namensgleich zu claude.js promptInputs
  const formatDate = makeDateFormatter(loc.dateLocale);
  const uiRenderer = uiRendererFor(uiHost); // null = Stufe-0-only (fail-closed)

  // Stufe 1 fuer EIN Widget aktivieren - geteilt von ALLEN UI-Tools (G5/S2, keine
  // Duplizierung der Anhang-Logik). Registriert die statische ui://-Resource am Server
  // UND liefert das _meta-Fragment fuer den Tool-Deskriptor - aber NUR wenn der
  // Renderer das Widget kennt und der Host faehig ist. Sonst {} (kein _meta, keine
  // Resource = fail-closed Stufe-0-only, AC3). Der Name nennt den Seiteneffekt
  // (Registrierung, N7); idempotent pro Server-Instanz (stateless: frischer Server je
  // Request).
  const enableWidgetUi = (widgetId) => {
    if (!uiRenderer || !uiRenderer.hasWidget(widgetId)) return {};
    uiRenderer.registerResource(server, widgetId);
    return { _meta: uiRenderer.toolMeta(widgetId) };
  };

  // AC6 per-handler Throw-Schutz (gilt stdio UND HTTP /mcp, da registerTools geteilt
  // ist): wickelt JEDEN Handler in ein catch. Ein Tool-Throw (Gateway-Fehler,
  // Result-Guard, Deref) wird zu einer sauberen MCP-Fehlerantwort (isError) statt
  // einer process-level unhandled rejection. requireFields-Meldungen sind bereits
  // generisch; alles andere bekommt eine stabile, provider-freie Meldung (kein Leak).
  // EINE Fehlerhuelle, geteilt von tool() und uiTool() (G5/S2 - keine Duplizierung).
  const wrapHandler =
    (handler) =>
    async (...args) => {
      try {
        return await handler(...args);
      } catch (err) {
        // P12: ein ToolError traegt eine stabile Kennung -> hier uebersetzt. Alles ohne
        // bekannte Kennung behaelt sein Bestandsverhalten (err.message, z.B. "HTTP 500"
        // oder "fetch failed" aus api()); nur der leere Fall bekommt den lokalisierten
        // Auffangsatz. Diese Reihenfolge ist Absicht: wuerde err.message unterdrueckt,
        // saehe ein EN-Tenant bei Netzfehlern wieder den deutschen Satz (MCP-05).
        return errText(
          loc.mcp.errors[err?.code] ||
            err?.message ||
            loc.mcp.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE],
        );
      }
    };

  // Bestands-Tools: positionsbasiertes server.tool (frozen API, kein outputSchema/_meta).
  const tool = (name, desc, schema, handler) => server.tool(name, desc, schema, wrapHandler(handler));

  // Wie tool(), aber ueber registerTool(config) -> erlaubt outputSchema (Stufe 0
  // schema-validiert) und _meta.ui.resourceUri (Stufe 1). config ohne _meta ->
  // Stufe-0-only. Dieselbe Fehlerhuelle wie tool() (Single Source via wrapHandler).
  const uiTool = (name, config, handler) =>
    server.registerTool(name, config, wrapHandler(handler));

  // place_call: EINZIGE Karte fuer den gesamten Anruf-Lebenszyklus (W2, Spam-Wurzel
  // beseitigt). uiTool statt tool(): initiales structuredContent (dialing, alle Felder
  // auf Start-Werte) + Widget-Anhang (WIDGET_CALL) NUR bei faehigem Host - das Widget
  // pollt sich selbst (get_call_status/get_transcript ueber die Host-Bruecke), das
  // Modell NICHT mehr (kein Karten-Spam). Safety-Gates (Allowlist/Denylist/Land/Budget/
  // Signatur) sitzen UNVERAENDERT in src/server.js /api/calls - hier aendern sich NUR
  // Widget-Anhang, Beschreibung und Rueckgabeform.
  uiTool(
    "place_call",
    {
      description:
        "Startet einen echten Telefonanruf des KI-Agenten an eine Telefonnummer und verfolgt dabei das angegebene Ziel. Welche Ziele erlaubt sind, entscheidet der Server ueber seine Safety-Gates (Rechteprofil/Allowlist, Denylist, Land, Limits) - einfach aufrufen; unerlaubte Ziele weist der Server mit einer klaren Meldung ab. Gibt sofort eine call_id zurueck und zeigt eine Live-Karte, die sich selbst aktualisiert (Status, Dauer, Transkript, Ergebnis). Du musst NICHT pollen - falls keine Live-Aktualisierung ankommt, bleibt get_call_status als Fallback verfuegbar.",
      inputSchema: {
        to: z
          .string()
          .describe(
            "Zielrufnummer EXAKT so uebernehmen, wie der Nutzer sie angegeben hat - Ziffern zeichengenau kopieren, NIEMALS umrechnen oder in E.164 umformen (beim Umformen entstehen Ziffernfehler; der Server normalisiert deterministisch). Nationale Schreibweise mit fuehrender 0 loest der Server ueber das Heimatland des Nutzers auf; Auslandsziele brauchen +XX/00XX - wirkt eine Nummer wie ein auslaendisches nationales Format, frage den Nutzer nach der internationalen Schreibweise statt zu raten. Wird serverseitig durch die Safety-Gates geprueft (Rechteprofil/Allowlist, Denylist, Land).",
          ),
        objective: z
          .string()
          .describe(
            "Das Ziel des Anrufs als EIN sprechbarer Ich-Satz aus Sicht des anrufenden Assistenten - er wird dem Angerufenen direkt nach der Offenlegung WOERTLICH vorgesprochen, BEVOR er antwortet. Formuliere ihn so, wie ein Mensch am Telefon sein Anliegen nennt, z.B. 'Ich moechte fuer Max einen Herrenhaarschnitt am Samstagvormittag vereinbaren.' KEIN Infinitiv-Stummel wie 'Termin vereinbaren'. Nenne IMMER ein konkretes Thema/Anlass, wenn es bekannt ist; ist Thema oder Praeferenz noch unbekannt, frage ZUERST kurz beim Nutzer nach, statt einen vagen Auftrag abzusetzen. Hintergrund und Details gehoeren NICHT hierher, sondern ins briefing.",
          ),
        briefing: z
          .string()
          .optional()
          .describe(
            "Relevanter Kontext aus dem bisherigen Chat, den der Agent fuers Telefonat braucht: worum es geht, beteiligte Namen, Vorlieben/Praeferenzen, Vorgeschichte sowie gewuenschtes Ergebnis und Ton. ZUSAMMENFASSEN statt roh hineinkopieren - nur was fuers Gespraech zaehlt. KEINE Secrets, Passwoerter oder Zahlungsdaten. Der Agent spricht als persoenlicher KI-Assistent des Auftraggebers (nicht als Claude/Gemini); formuliere den Kontext aus dessen Sicht.",
          ),
        constraints: z
          .string()
          .optional()
          .describe(
            "Harte Grenzen, die der Agent im Gespraech nicht ueberschreiten darf, z.B. 'Nicht vor 10 Uhr, maximal 40 Euro, keine Anzahlung zusagen.'",
          ),
        // P6 (PLAN-CONVERSATION-QUALITY-V2): Vorab-Mandat. Ohne Eintrag im zod-Schema
        // erreichte das Feld /api/calls nie (zod strippt unbekannte Keys - dieselbe
        // Falle wie bei diagnostic). Kein Constraint-DSL: die Feld-BESCHREIBUNGEN sind
        // das Feature, nicht der Typ.
        mandate: z
          .object({
            decide_freely: z
              .string()
              .optional()
              .describe(
                "Die Vollmacht - was der Agent im Gespraech OHNE Rueckfrage verbindlich zusagen darf, z.B. 'Termin an jedem Werktag zwischen 9 und 12 Uhr, bis 60 Euro'. Formuliere sie so konkret, dass am Telefon eine Ja/Nein-Entscheidung daraus ableitbar ist; vage Rahmen ('flexibel', 'irgendwann') helfen nicht. Frage den Nutzer ZUERST kurz nach seinem Rahmen, statt einen zu erfinden. OHNE dieses Feld darf der Agent gar nichts zusagen und gibt jeden Vorschlag nur als Nachricht weiter. Harte Verbote gehoeren NICHT hierher, sondern in constraints.",
              ),
            fallback_order: z
              .string()
              .optional()
              .describe(
                "Praeferenz-Reihenfolge, die der Agent selbstaendig abarbeitet, wenn der Erstwunsch nicht geht, z.B. 'zuerst Donnerstag frueh, sonst Freitag, sonst naechste Woche'. Ohne dieses Feld probiert er von sich aus keine Alternative.",
              ),
            on_out_of_scope: z
              .enum(MANDATE_OUT_OF_SCOPE_VALUES)
              .optional()
              .describe(
                "Was der Agent tut, wenn ein Angebot AUSSERHALB von decide_freely liegt: 'take_message' (Default) - Angebot mit allen Details festhalten, weitergeben und zusagen, dass der Nutzer sich meldet; 'decline' - hoeflich ablehnen, ohne Gegenangebot; 'accept_best' - die beste angebotene Moeglichkeit trotzdem annehmen und festhalten. Setze 'accept_best' NUR, wenn der Nutzer ausdruecklich sagt, dass ihm jede Option recht ist.",
              ),
          })
          .optional()
          .describe(
            "Optionales Vorab-MANDAT: der Rahmen, in dem der Agent im Gespraech SELBST entscheiden darf, statt jede Frage als Nachricht zurueckzugeben. Der Agent bucht dadurch NICHTS und bekommt KEINEN Kalenderzugriff - er sagt nur muendlich zu, was der Nutzer ihm vorab erlaubt hat. Frage den Nutzer nach seinem Rahmen, wenn im Anruf eine Termin- oder Preisfrage zu erwarten ist; ohne Mandat kann der Agent auf 'Wann passt es Ihnen?' nur mit 'Ich gebe das weiter' antworten. Bei Konflikt mit constraints gewinnt IMMER constraints.",
          ),
        context: z
          .object({
            summary: z
              .string()
              .optional()
              .describe(
                "Worum es im Anruf geht, in 1-3 Saetzen zusammengefasst (kein Roh-Dump des Chats).",
              ),
            key_facts: z
              .array(z.string())
              .optional()
              .describe(
                "Wenige (max. 10) kurze Stichpunkte mit fuers Gespraech relevanten Fakten (Namen, Daten, Praeferenzen). KEINE Secrets/Passwoerter/Zahlungsdaten.",
              ),
            recipient_relationship: z
              .string()
              .optional()
              .describe("Verhaeltnis des Auftraggebers zum Angerufenen, z.B. 'Stammfriseur', 'Neukunde'."),
            desired_outcome: z
              .string()
              .optional()
              .describe("Das gewuenschte Ergebnis aus Sicht des Auftraggebers, knapp formuliert."),
          })
          .optional()
          .describe(
            "Optionaler strukturierter HINTERGRUND fuers Gespraech (nur zur Information des Agenten, ZUSAETZLICH zum briefing). Der Agent spricht als persoenlicher KI-Assistent des Auftraggebers, NIE als Claude/Gemini; gib nur weiter, was der Auftrag erfordert. KEINE Secrets.",
          ),
        // b.language wird serverseitig ueber store.resolveCallLanguage (Geo/Settings)
        // aufgeloest und hier ignoriert; das Feld bleibt nur abwaertskompatibel im Schema.
        language: z.string().optional().describe("Gespraechssprache, Default 'de'."),
        // S1-6 DiD: schema-seitig bereits positiv/ganzzahlig/gecappt (der eigentliche
        // Wurzelfix sitzt in outbound-gates.js resolveMaxDurationS, das JEDEN Body-Wert
        // - auch einen durch diese Zod-Grenze rutschenden - nochmal klemmt).
        max_duration_s: z
          .number()
          .int()
          .positive()
          .max(MAX_CALL_DURATION_CAP_S)
          .optional()
          .describe("Maximale Gespraechsdauer in Sekunden (Default 180, Max 300)."),
        // P2b (Diagnose-Retention): reiner WUNSCH. Der Server gewaehrt ihn NUR, wenn das
        // Ziel die eigene verifizierte Nummer des Nutzers ist - sonst still ignoriert.
        // Ohne dieses Feld erreichte das Flag /api/calls nie (Zod strippt unbekannte Keys).
        diagnostic: z
          .boolean()
          .optional()
          .describe(
            "NUR setzen, wenn der Nutzer ausdruecklich einen Testanruf an die EIGENE Nummer machen und das Gespraech hinterher analysieren will. Behaelt das Roh-Transkript fuer eine begrenzte Frist. Bei jedem anderen Ziel ignoriert der Server das Feld. Niemals ungefragt setzen.",
          ),
      },
      outputSchema: CALL_OUTPUT,
      ...enableWidgetUi(WIDGET_CALL),
    },
    async (args) => {
      const r = await call("POST", "/api/calls", args);
      requireFields(r, { callId: "string" });
      const data = {
        call_id: r.callId,
        status: "dialing",
        duration_s: 0,
        last_transcript_lines: [],
        failure_reason: null,
        result_summary: null,
        objective_achieved: null,
        context_received: normalizeContextReceived(r.context_received), // I10
      };
      return {
        content: [
          { type: "text", text: JSON.stringify({ call_id: data.call_id, status: data.status }, null, 2) },
        ],
        structuredContent: data,
      };
    },
  );

  // Stufe-0-Sicht (Text + structuredContent) eines Calls nach dem get_call_status-
  // Datenkontrakt. Whitelist (pickCallStatus) sitzt VOR Text + structuredContent.
  // Textblock bleibt die heutige 3-Feld-Sicht (Legacy/stdio byte-kompatibel);
  // structuredContent ist die SSOT-Obermenge inkl. call_id.
  const callStatusResult = async (call_id) => {
    const c = await call("GET", `/api/calls/${call_id}`);
    requireFields(c, { transcript: "array" });
    const data = pickCallStatus(call_id, c, loc.mcp);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: data.status,
              duration_s: data.duration_s,
              last_transcript_lines: data.last_transcript_lines,
            },
            null,
            2,
          ),
        },
      ],
      structuredContent: data,
    };
  };

  // Reines Stufe-0-Tool (W2): traegt in JEDEM Fall (faehiger Host oder nicht) KEIN _meta
  // mehr - das Widget lebt jetzt einzig an place_call (WIDGET_CALL, vereinte Live-Karte
  // mit Selbst-Poll). get_call_status bleibt aber MODELL-SICHTBAR als Text-Tool: falls
  // die Widget-Bruecke nicht antwortet, kann das Modell weiterhin manuell pollen und so
  // den Abschluss lernen (Fallback-Vertrag).
  uiTool(
    "get_call_status",
    {
      description:
        "Liefert den Live-Zustand eines Anrufs: status (dialing|in_progress|completed|failed|cancelled), Dauer und die letzten Transkriptzeilen. Die Live-Karte von place_call aktualisiert sich normalerweise von selbst; dieses Tool bleibt als manueller Fallback verfuegbar, falls keine Live-Aktualisierung ankommt.",
      inputSchema: { call_id: z.string().describe("Die call_id aus place_call") },
      outputSchema: CALL_STATUS_OUTPUT,
    },
    async ({ call_id }) => callStatusResult(call_id),
  );

  // Reines Stufe-0-Tool (W2): kein Widget-Anhang mehr - der Abschluss (Summary/Ziel-
  // Status) erscheint jetzt in der vereinten place_call-Karte (WIDGET_CALL), die
  // get_transcript beim Terminal-Status "completed" selbst ueber ihre Host-Bruecke
  // aufruft. Bleibt als Text-Tool erhalten (Fallback, falls die Widget-Bruecke nicht
  // antwortet). Handler/Whitelist (pickTranscript) unveraendert.
  uiTool(
    "get_transcript",
    {
      description:
        "Liefert nach Gespraechsende die Ergebnis-Zusammenfassung und ob das Ziel erreicht wurde. Aus Datenschutzgruenden wird das Roh-Transkript nach der Zusammenfassung nicht aufbewahrt (Datenminimierung) und NICHT zurueckgegeben - nur Zusammenfassung und Ziel-Status. Erst aufrufen, wenn get_call_status status=completed meldet.",
      inputSchema: { call_id: z.string().describe("Die call_id aus place_call") },
      outputSchema: TRANSCRIPT_OUTPUT,
    },
    async ({ call_id }) => {
      const c = await call("GET", `/api/calls/${call_id}`);
      if (c.status === "active")
        return text({
          error: "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen.",
        });
      // Validiert, dass ein echtes Call-Objekt zurueckkam (transcript-Feld vorhanden);
      // das Roh-Transkript selbst wird bewusst NICHT durchgereicht (Whitelist unten).
      requireFields(c, { transcript: "array" });
      const data = pickTranscript(call_id, c); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
      // Textblock = Summary/Ziel-Sicht (kein call_id, analog get_call_status);
      // structuredContent ist die SSOT-Obermenge inkl. call_id (Whitelist). Roh-
      // Transkript taucht in KEINER Sicht auf (DSGVO).
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { result_summary: data.result_summary, objective_achieved: data.objective_achieved },
              null,
              2,
            ),
          },
        ],
        structuredContent: data,
      };
    },
  );

  tool(
    "cancel_call",
    "Bricht einen laufenden Anruf sauber ab.",
    { call_id: z.string().describe("Die call_id aus place_call") },
    async ({ call_id }) => {
      await call("POST", `/api/calls/${call_id}/cancel`);
      return text({ status: "cancelled" });
    },
  );

  // Stufe 0 (Text byte-identisch zum Bestand) + structuredContent (Whitelist) + Stufe 1
  // (my-number Widget) NUR bei faehigem Host. Der Textblock bleibt JSON.stringify ueber
  // den ROHEN agent.number (undefined -> "{}", byte-identisch); structuredContent
  // normalisiert auf null (Schema nullable), damit fehlende Nummer kein isError ist.
  uiTool(
    "get_my_number",
    {
      description: "Liefert die Rufnummer des Telefon-Agenten (die Twilio-Nummer).",
      inputSchema: {},
      outputSchema: MY_NUMBER_OUTPUT,
      ...enableWidgetUi(WIDGET_MY_NUMBER),
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object" });
      const data = pickMyNumber(s); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
      return {
        content: [
          { type: "text", text: JSON.stringify({ number: s.agent.number }, null, 2) },
        ],
        structuredContent: data,
      };
    },
  );

  // ---- Bonus-Tools (ueber den Brief hinaus, fuer die Hermes-Demo) ----
  // Stufe 0 (Text byte-identisch zum Bestand) + structuredContent (Whitelist: Liste mit
  // genau den pickCall-Feldern) + Stufe 1 (calls Widget) NUR bei faehigem Host. Text UND
  // structuredContent lesen DIESELBEN gewhitelisteten Eintraege (eine Quelle, G5/S2). Der
  // leere Fall behaelt den "Noch keine Anrufe."-Text + leere Liste (Schema verlangt
  // structuredContent auch leer).
  uiTool(
    "list_calls",
    {
      description:
        "Listet die letzten Telefonate des Agenten (inbound und outbound) mit Status und Summary.",
      inputSchema: {},
      outputSchema: CALLS_OUTPUT,
      ...enableWidgetUi(WIDGET_CALLS),
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { calls: "array" });
      const entries = s.calls.map((c) => pickCall(c, formatDate)); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
      const txt = entries.length ? entries.map(callTextLine).join("\n") : "Noch keine Anrufe.";
      return {
        content: [{ type: "text", text: txt }],
        structuredContent: { calls: entries },
      };
    },
  );

  tool("list_action_items", "Listet offene Action Items aus allen Telefonaten.", {}, async () => {
    const s = await call("GET", "/api/state");
    requireFields(s, { actionItems: "array" });
    const open = s.actionItems.filter((a) => !a.done);
    if (!open.length) return text("Keine offenen Action Items.");
    return text(
      open
        .map((a) => `[${a.id}] ${a.type === "appointment" ? "(Termin) " : ""}${a.text}`)
        .join("\n"),
    );
  });

  // Kalender-Tool nur registrieren, wenn das Profil es erlaubt (Phase 2). Ein
  // restriktives Profil sieht get_calendar gar nicht erst. Stufe 0 (Text byte-identisch)
  // + structuredContent (Whitelist: title/start/end je Eintrag) + Stufe 1 (calendar
  // Widget) bei faehigem Host. Text UND structuredContent lesen dieselben gewhitelisteten
  // Eintraege (eine Quelle); leerer Kalender behaelt "Kalender ist leer." + leere Liste.
  if (allowCalendar)
    uiTool(
      "get_calendar",
      {
        description: "Zeigt die naechsten Kalendereintraege des Besitzers.",
        inputSchema: {},
        outputSchema: CALENDAR_OUTPUT,
        ...enableWidgetUi(WIDGET_CALENDAR),
      },
      async () => {
        const s = await call("GET", "/api/state");
        // Existenz/Typ pruefen, NICHT Nicht-Leere: leerer Kalender ([]) ist valide
        // und behaelt den bestehenden "Kalender ist leer."-Pfad.
        requireFields(s, { calendar: "array" });
        const entries = s.calendar.map((e) => pickCalendarEntry(e, formatDate)); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
        const txt = entries.length
          ? entries.map((e) => `${e.title}: ${e.start} bis ${e.end}`).join("\n")
          : "Kalender ist leer.";
        return {
          content: [{ type: "text", text: txt }],
          structuredContent: { calendar: entries },
        };
      },
    );

  // Stufe 0 (Text byte-identisch zum Bestand, Backward-Compat) + structuredContent
  // (Whitelist) + Stufe 1 (agent-status Widget) NUR bei faehigem Host (enableWidgetUi).
  // Der Textblock liest dieselben gewhitelisteten Daten (data.*) - eine Quelle, keine
  // Duplizierung der Formatierung (permissions).
  uiTool(
    "get_agent_status",
    {
      description:
        "Status des Telefon-Agenten: Rufnummer, Voice-Engine, Modell, Kosten/Budget, Berechtigungen.",
      inputSchema: {},
      outputSchema: AGENT_STATUS_OUTPUT,
      ...enableWidgetUi(WIDGET_AGENT_STATUS),
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object", usage: "object", settings: "object" });
      const data = pickAgentStatus(s); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
      const currency = chargeCurrencyLabel();
      return {
        content: [
          {
            type: "text",
            text:
              `Agent-Nummer: ${data.number}\nBesitzer: ${data.owner}\nVoice-Engine: ${data.voiceEngine}\nModell: ${data.model}\n` +
              `Calls bisher: ${data.calls}\n` +
              `KI-Kosten gesamt (Lebenszeit): ${costDigits(data.costEur)} ${currency} von ${data.tenantCapEur} ${currency} eigenem Budget\n` +
              `KI-Kosten Spend-Monat ${data.spendMonthKey ?? "unbekannt"}: ${costDigits(data.spendMonthCostEur)} ${currency}\n` +
              `Aktuell reserviert: ${costDigits(data.reservedEur)} ${currency}\n` +
              `Berechtigungen: ${data.permissions}`,
          },
        ],
        structuredContent: data,
      };
    },
  );
}
