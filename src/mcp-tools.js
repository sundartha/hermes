// MCP-Tool-Definitionen (gemeinsam fuer stdio-Transport und Streamable HTTP /mcp).
// Die Tools sprechen mit der REST-API des Gateways.
//
// SYSTEMGRENZE (Owner-Entscheidung O14, PLAN-I18N-FIX P15): MODELLSPRACHE != NUTZERSPRACHE.
// Alles, was der TENANT liest (Fehler-/Leertexte, Feldnamen, Widget), folgt seiner
// Sprache (loc.mcp, aufgeloest ueber das language-Argument von registerTools).
// Alles, was NUR das Client-Modell liest - die Tool-Beschreibungen und alle
// .describe()-Schematexte - ist EINSPRACHIG ENGLISCH und bekommt bewusst KEINE
// Sprachverzweigung: sie sind der Tool-Entscheidungspunkt, an dem die Anrufqualitaets-
// Kette enge Verbote erarbeitet hat; dreifache Pflege wuerde sie je Sprache verschieben.
// Emphase (Grossschreibung, Negation, Negativ-Beispiele) ist Teil des Vertrags und per
// Test gepinnt (test/p15-mcp-tool-descriptions-en.test.js). NICHT lokalisieren.
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
import {
  MAX_CALL_DURATION_CAP_S,
  MANDATE_OUT_OF_SCOPE_VALUES,
  KEY_FACTS_LIMITS,
  CONSULT_ANSWER_MODE,
} from "./store/defaults.js";
import { CONSULT_EVENT, CONSULT_POLL_ABORT_MS } from "./consult/delivery.js";
import { resolveGatewayUrl } from "./config.js";
// INBOX-P2 (S2-1): die Ergebnis-Karten-Whitelist lebt seit dieser Etappe dort, wo die
// Karte definiert wird (src/call-result.js) - EINE Quelle fuer MCP-Sicht UND die
// Inbox-Projektion in state-ops.js. Hier NUR noch importiert, nie zweitdefiniert (G5).
import { resultCardView } from "./call-result.js";
import { localeFor, SUPPORTED_LANGUAGES } from "./i18n/locales.js";
import { MCP_ERROR_CODE } from "./i18n/mcp-texts.js";
// P5b (O-13 Teil 2): dieselbe Zerlegeregel wie der Erzeuger (Modul-Kopf dort) -
// nicht kopiert, nicht nachgebaut. Wiederverwendung an genau der Naht, an der
// failure_reason den Server verlaesst (callOutcomeView unten).
import { failureReasonBase } from "./telephony/failure-reason.js";

// Letzte N Transkriptzeilen fuer get_call_status (G25, kein Magic-Wert im Slice).
// NICHT MEHR EXPORTIERT: der einzige Fremdnutzer war src/conversation/outcome-to-mcp-
// fields.js, und der ist am 17.08.2026 als toter Export geloescht worden (Phase 5).
const LAST_TRANSCRIPT_LINES = 6;

// identity (optional): wird als interner X-Internal-Identity-Header an die localhost-
// REST-API gereicht und dient seit Phase S nur noch Audit/requestedBy (Forensik), NICHT
// mehr dem Rechteprofil. Das Gateway akzeptiert den Header nur von localhost-Sockets.
// scopedTenant (optional, AM6): am /mcp-Gateway aufgeloester Request-Tenant, als
// X-Internal-Tenant gereicht (ebenfalls nur localhost akzeptiert). Das Rechteprofil laeuft
// seit Phase S ueber diese Tenant-Achse (resolveProfile(scopedTenant)). Ohne scopedTenant
// -> Owner/Bootstrap.
// timeoutMs (AL-P13): explizite Frist fuer den EINEN Aufruf, der bewusst lange haelt
// (await_call_event). Ohne sie bindet ein 22-s-Long-Poll den zweiten, prozessinternen
// Socket unbegrenzt, falls der Gateway-Handler haengt. Ohne timeoutMs byte-identisch
// zum Bestand (kein signal -> fetch-Default). EIN Objekt-Argument statt sechs
// Positionen (F1). AbortSignal.timeout ist ab Node 17.3 verfuegbar (package.json: >=22).
async function api({ method, path, body, identity, scopedTenant, timeoutMs = null }) {
  const headers = { "Content-Type": "application/json" };
  if (identity) headers["X-Internal-Identity"] = identity;
  if (scopedTenant) headers["X-Internal-Tenant"] = scopedTenant;
  // Zur Aufrufzeit gelesen (server.js setzt GATEWAY_URL ggf. erst beim Start)
  const res = await fetch(resolveGatewayUrl() + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    // AL-P13: der Status reist additiv mit (Message unveraendert) - answer_consult muss
    // "verworfen" (400) von "nicht mehr offen" (409) unterscheiden, ohne den Fehlertext
    // zu parsen (Zeichenketten-Vergleich waere ein zweites, brechendes Format).
    err.httpStatus = res.status;
    throw err;
  }
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
// Exportiert (rein additiv, keine Verhaltensaenderung): weitere Aufrufer bleiben
// innerhalb dieser Datei, der Export vermeidet nur einen kuenftigen Nachbau.
export function mapStatus(c) {
  if (c.status === "active") return c.answeredAt ? "in_progress" : "dialing";
  return c.status;
}
// Vergangene Zeit seit Anrufstart (startedAt), monoton wachsend. Anker fest auf
// startedAt - KEIN answeredAt-Fallback: bei markAnswered wuerde der Anker sonst
// vorspringen und die angezeigte Dauer rueckwaerts springen (z.B. 3->2). Reiner
// Anzeigewert; abgerechnet wird separat ueber voiceMinutesOf (answeredAt..endedAt).
// NICHT MEHR EXPORTIERT: der einzige Fremdnutzer war src/conversation/outcome-to-mcp-
// fields.js, und der ist am 17.08.2026 als toter Export geloescht worden (Phase 5).
function durationS(c) {
  const start = c.startedAt;
  const end = c.endedAt || new Date().toISOString();
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
}

// OUTBOUND-E3a (G5): get_call_status und await_call_event beantworten dieselbe Frage -
// "wie ist der Anruf ausgegangen und warum" - und duerfen sie nicht zweimal beantworten.
// BEWUSST NICHT pickCallStatus als Ganzes wiederverwendet: die traegt
// last_transcript_lines, und der await_call_event-Kontrakt reicht das Roh-Transkript
// strukturell NICHT durch (Absolute Regel 5, s. Kommentar bei pickTranscript).
// failure_reason ist das MASCHINENFELD - seit P5b (O-13 Teil 2, Datenminimierung) NUR
// das BASIS-Token (z.B. "not-placed"), nicht mehr die volle Diagnose
// ("not-placed:invite-403-D51"). Das Detail (SIP-/Carrier-Code) bleibt der Diagnose
// vorbehalten: Datensatz, Log und Ausfallbericht (outage-report.js) tragen es weiterhin
// unveraendert - dort wird es gebraucht, um z.B. zwei verschiedene not-placed-Ausfallarten
// zu unterscheiden. Der Nutzertext entsteht getrennt in pickTranscript und loest bereits
// auf dem Basis-Token auf.
function callOutcomeView(call) {
  return { status: mapStatus(call), failure_reason: failureReasonBase(call.failureReason) };
}

// Daten-Kontrakt get_call_status (P1-Spec Abschnitt 5): GENAU diese Felder duerfen
// nach aussen (structuredContent + Text + Widget). Whitelist, keine Blacklist. Sitzt
// NACH der Tenant-Aufloesung (Gateway) und VOR jeder Sicht - eine einzige Stelle.
// Kein Secret/Identitaet/Audio/Cross-Tenant-Feld passiert diese Funktion.
// Praezisierung: diese Aussage geht ueber die FELDER dieser Funktion, nicht ueber den
// INHALT jedes Feldes. Eines der Felder, last_transcript_lines, traegt woertliche
// Zeilen der Gegenseite (Rohtext, den der Angerufene gesagt hat) unveraendert durch -
// bewusst offener Befund, noch nicht behoben.
function pickCallStatus(callId, c, texts) {
  return {
    call_id: callId,
    ...callOutcomeView(c),
    duration_s: durationS(c),
    last_transcript_lines: c.transcript
      .slice(-LAST_TRANSCRIPT_LINES)
      .map((t) => `${t.role === "agent" ? texts.roleAgent : texts.roleCounterparty}: ${t.text}`),
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

// OUTBOUND-E3a: der Warte-Platzhalter als benannte Konstante. Wortlaut BYTE-IDENTISCH zum
// Bestand - er ist die Gegenrichtung des neuen Verhaltens und per Test gepinnt.
// BEWUSST NICHT nach i18n/mcp-texts.js verschoben: das aenderte den Text fuer EN/FR-Tenants
// und braeche genau die Byte-Identitaet, die E3a zusichert. Die fehlende Lokalisierung
// dieses Bestandstexts ist ein KARTIERTER, hier NICHT behobener Befund.
const AWAIT_SUMMARY_PLACEHOLDER =
  "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)";

// Daten-Kontrakt get_transcript (Strategie Abschnitt 5.1, DSGVO): GENAU diese Felder
// duerfen nach aussen (structuredContent + Text + Widget). Das Roh-Transkript
// (c.transcript: role/text/t) wird NIE durchgereicht - es wird serverseitig nach der
// Summary gepurged (P8a) und faellt hier per Whitelist (nicht Blacklist) ohnehin raus.
// EIN Filter, VOR jeder Sicht (Pre-Mortem #1). Die fuenf Karten-Felder kommen aus
// resultCardView (src/call-result.js, seit INBOX-P2 dort zuhause).
// Exportiert (rein additiv, keine Verhaltensaenderung): weitere Aufrufer bleiben
// innerhalb dieser Datei.
// OUTBOUND-E3a: texts ist der 3. Parameter, Default null - Altaufrufer bleiben
// byte-identisch. Der Warte-Platzhalter verschwindet AUSSCHLIESSLICH bei terminalem Anruf
// MIT gespeichertem Grund. Alles andere - laufender Anruf, terminaler Anruf OHNE Grund
// (das sind ALLE EL-Anrufe vor E2, deren failure_reason strukturell NULL ist), fehlende
// texts (Altaufrufer/Test) - bleibt byte-identisch. Beide Richtungen sind gepinnt.
export function pickTranscript(callId, c, texts = null) {
  const failureSummary =
    texts && mapStatus(c) === "failed" ? texts.callFailedSummary(c.failureReason) : null;
  return {
    call_id: callId,
    result_summary: c.summary || failureSummary || AWAIT_SUMMARY_PLACEHOLDER,
    objective_achieved: c.objectiveAchieved ?? "unclear",
    ...resultCardView(c.result),
  };
}

// AL-P11: die fuenf Karten-Felder als eigenes Schema-Fragment - von TRANSCRIPT_OUTPUT
// gespreadet (G5), damit Sicht (resultCardView) und Schema nie auseinanderlaufen.
const RESULT_CARD_OUTPUT = {
  outcome: z.string().nullable(),
  commitments: z.array(z.string()),
  counterparty_commitments: z.array(z.string()),
  open_points: z.array(z.string()),
  next_step: z.string().nullable(),
};

// outputSchema fuer get_transcript: validiert GENAU die Whitelist. objective_achieved
// ist true|false|"unclear" (Bool oder String), daher union.
const TRANSCRIPT_OUTPUT = {
  call_id: z.string(),
  result_summary: z.string(),
  objective_achieved: z.union([z.boolean(), z.string()]),
  ...RESULT_CARD_OUTPUT,
};

// AL-P13: outputSchema von await_call_event. Die Ergebnis-Felder sind NUR bei
// event="done" befuellt (der Payoff, der das Dranbleiben lohnt) - sonst null bzw. leer.
// OUTBOUND-E3a (F2a): Ausgang UND Grund auf DEM Weg, in den die Server-Instruktionen das
// Modell schicken. Beide nullable - solange der Anruf laeuft (event "none"/"consult")
// gibt es noch keinen Ausgang; befuellt sind sie bei event="done". Additiv: kein
// bestehendes Feld entfaellt, kein Typ aendert sich.
const AWAIT_EVENT_OUTPUT = {
  event: z.string(),
  event_id: z.string().nullable(),
  questions: z.array(z.string()),
  status: z.string().nullable(),
  failure_reason: z.string().nullable(),
  result_summary: z.string().nullable(),
  objective_achieved: z.union([z.boolean(), z.string()]).nullable(),
  ...RESULT_CARD_OUTPUT,
};

// AL-P13: EIN Bauplan der await_call_event-Antwort. Der Payoff kommt aus der BESTEHENDEN
// Whitelist (pickTranscript/resultCardView) - KEINE zweite Ergebnis-Sicht (G5), das
// Roh-Transkript ist strukturell nicht erreichbar (Regel 5). finished = der Call-Record
// bei event="done", sonst null.
// OUTBOUND-E3a: EIN Objekt-Argument statt vier Positionen (max-params 3, F1) - und
// zugleich der Grund, warum der Aufrufer unveraendert EINE Zeile bleibt.
function awaitEventView({ callId, event, finished, texts }) {
  const done = finished ? pickTranscript(callId, finished, texts) : null;
  const outcome = finished ? callOutcomeView(finished) : { status: null, failure_reason: null };
  return {
    event: event.event,
    event_id: event.eventId ?? null,
    questions: Array.isArray(event.questions) ? event.questions : [],
    ...outcome,
    result_summary: done?.result_summary ?? null,
    objective_achieved: done?.objective_achieved ?? null,
    ...resultCardView(finished?.result),
  };
}

// AL-P13: outputSchema von answer_consult. Reine Quittung - KEIN Inhalt zurueck.
const ANSWER_CONSULT_OUTPUT = {
  accepted: z.boolean(),
  merged_facts: z.number(),
};

// HTTP-Status, die answer_consult in einen normalen (nicht-Fehler) Hinweistext uebersetzt:
// beide sind erwartbare Zustaende der Schleife, kein Werkzeugfehler (G25, keine nackten
// Zahlen im Handler).
const CONSULT_ANSWER_REJECTED_STATUS = 400;
const CONSULT_ANSWER_CONFLICT_STATUS = 409;

// Ein Zeitablauf ist das NORMALE Ergebnis eines Long-Polls. AbortSignal.timeout wirft je
// nach Runtime-Pfad TimeoutError oder AbortError - beide sind hier dasselbe Ereignis.
const ABORT_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);
const isAbortError = (err) => ABORT_ERROR_NAMES.has(err?.name);

// E3 (T-27): die Frist des EINEN Hops, der einen echten Anruf ausloest. Sie ist STRUKTURELL
// groesser als das gesamte Vorwahl-Budget des Servers, damit ein Zeitablauf nie einen
// laufenden Anrufstart kappt - am Seam abgelesen, nicht geraten:
//   Anrufstart blockiert ueber die Klingelphase: REQUEST_TIMEOUT_MS 120000
//     (elevenlabs/convai.js, dort GEMESSEN: 40,3 s blosses Klingeln)
// + Pre-Call-Briefing: config.llm.briefingTimeoutMs (6000), BRIEFING_MAX_RETRIES = 0
// + Eroeffnungszeile: DERSELBE Wert, OPENING_MAX_RETRIES = 0 (elevenlabs/opening-line-llm.js)
// Backoff faellt weg: withRetry (llm.js) schlaeft nur VOR einem Retry, bei max=0 also nie.
// Summe 132000, hier 180000 - 48 s Kopf.
// KEIN Env-Knopf: eine kuerzere Frist erzeugt genau die Waise, die diese Etappe beseitigt
// (der Abbruch verhindert den Anruf nicht, er kappt nur unsere Kennung). Praezedenz fuer
// "interner Transport-Bound, kein Operator-Knopf" ist REQUEST_TIMEOUT_MS selbst.
// Wer PRECALL_BRIEFING_TIMEOUT_MS anhebt, muss hier nachrechnen -
// test/openai-s3-hop-frist.test.js faellt dann rot.
export const PLACE_CALL_HOP_TIMEOUT_MS = 180000;

const NO_CONSULT_EVENT = Object.freeze({
  event: CONSULT_EVENT.NONE,
  eventId: null,
  questions: [],
});

// Nicht angenommene Antwort: Hinweistext PLUS schema-konformes structuredContent (das
// Tool deklariert ein outputSchema - ohne strukturierten Teil lehnte das SDK die Antwort ab).
const notAccepted = (message) => ({
  content: [{ type: "text", text: message }],
  structuredContent: { accepted: false, merged_facts: 0 },
});

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
  // E3 (N-11): lief die Aktion schon? true = der zurueckgegebene Anruf lief bereits, es wurde
  // kein zweiter gestartet. NUR hier, NICHT in CALL_STATUS_OUTPUT - get_call_status bleibt
  // unveraendert.
  deduplicated: z.boolean(),
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
// Die Feldnamen folgen der Tenant-Sprache (MCP-09): sie kommen aus DEMSELBEN Locale-
// Buendel wie Rollen-Praefix und Fehlertexte (loc.mcp), kein zweiter Lookup.
function permissionsSummary(settings, labels) {
  return (
    `${labels.summaries}=${settings.allowSummaries}, ${labels.personalData}=${settings.allowPersonalData}, ` +
    `${labels.bankData}=${settings.allowBankData}`
  );
}

// Daten-Kontrakt get_agent_status (W3-Spec): GENAU diese flachen Eigen-Felder duerfen
// nach aussen (structuredContent + Text + Widget). Whitelist, keine Blacklist. number/
// owner koennen fail-closed leer sein (kein aktiver Nummern-Seed / Tenant ohne
// ownerName) -> auf null normalisiert, damit der Schluessel erhalten bleibt und das
// Schema (nullable) NICHT zu isError fuehrt. Kein Secret/internes Feld passiert hier.
function pickAgentStatus(s, texts) {
  return {
    number: s.agent.number ?? null,
    owner: s.agent.owner ?? null,
    calls: s.usage.calls,
    // KS-P8/E4: KEIN Kostenbetrag mehr im Chat - nur die Monatsnutzung in Prozent.
    // null = kein Kontingent hinterlegt (Schluessel bleibt erhalten, Schema nullable).
    planUsagePercent: s.usage.planUsagePercent ?? null,
    permissions: permissionsSummary(s.settings, texts.permissionLabels),
  };
}

// outputSchema fuer get_agent_status: validiert GENAU die Whitelist (Stufe 0
// schema-validiert). number/owner nullable (fail-closed leer ist ein gueltiger Zustand).
// planUsagePercent nullable (kein Kontingent hinterlegt).
const AGENT_STATUS_OUTPUT = {
  number: z.string().nullable(),
  owner: z.string().nullable(),
  calls: z.number(),
  planUsagePercent: z.number().nullable(),
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

// ---- check_inbox (PLAN-ANRUF-INBOX, INBOX-P3, E-5) --------------------------------
// Daten-Kontrakt check_inbox. Die Whitelist lebt an GENAU EINER Stelle: inboxEntryView
// in src/store/state-ops.js. Dieses Schema ist ihre Schema-Seite, KEINE zweite Sicht -
// die fuenf Karten-Felder kommen aus demselben RESULT_CARD_OUTPUT wie get_transcript
// und await_call_event (G5/S2, ein Spread statt einer Redefinition).
// at (statt started_at) ist der EINZIGE Unterschied zur REST-Sicht: server-seitig in
// der Tenant-Sprache formatiert, derselbe Formatter wie list_calls/get_calendar.
// BEWUSST NICHT .strict(): Praezedenz CALL_LIST_ENTRY. Ein spaeter im Store
// hinzugefuegtes Feld soll als ROTER TEST auffallen (test/inbox-mcp-tool.test.js,
// Schluesselsatz-Pin), nicht als Laufzeit-Fehler des Werkzeugs.
const INBOX_ENTRY = z.object({
  call_id: z.string(),
  caller: z.string().nullable(),
  at: z.string().nullable(),
  summary: z.string().nullable(),
  summary_unavailable: z.boolean(),
  ...RESULT_CARD_OUTPUT,
  action_items: z.array(z.string()),
  action_required: z.boolean(),
});
const INBOX_OUTPUT = { entries: z.array(INBOX_ENTRY), remaining: z.number() };

// Der EINE Unterschied zwischen REST- und MCP-Sicht eines Eintrags. Rest-Destrukturierung
// statt Feldliste: das Werkzeug PROJIZIERT NICHT ERNEUT (E-5/S2-1), es tauscht ein Feld.
// Waere hier eine Feldliste, gaebe es zwei Whitelists derselben Karte - genau die Drift,
// gegen die der Bestandskommentar bei pickTranscript argumentiert.
// Fehlt der Zeitstempel, bleibt at null: new Date(null) formatierte die Epoche und
// behauptete damit eine Anrufzeit von 1970 (G26, Praezision statt Vagheit).
function inboxEntryForModel(entry, formatDate) {
  const { started_at: startedAt, ...rest } = entry;
  return { ...rest, at: startedAt ? formatDate(startedAt) : null };
}

// Stufe-0-Textzeile eines Eintrags aus den GEWHITELISTETEN Feldern - Text und
// structuredContent lesen dieselbe Struktur (eine Quelle, G5/S2).
// Kein Richtungs-Pfeil wie in callTextLine: ein Inbox-Eintrag ist per Konstruktion
// immer eingehend, ein konstantes Symbol waere Rauschen (G12).
// Fehlt die Zusammenfassung, steht dort der Ersatzsatz der Tenant-Sprache statt einer
// Luecke - ein Eintrag ohne Inhalt ist unbequem, aber wahr (E-2, Pre-Mortem R-1).
function inboxTextLine(entry, texts) {
  const summaryText = entry.summary ?? texts.inboxSummaryUnavailable;
  const actions = entry.action_items.map((item) => `\n  - ${item}`).join("");
  return `[${entry.call_id}] ${entry.caller} | ${entry.at} | ${summaryText}${actions}`;
}

// WOERTLICH festgelegt (E-5). Einsprachig englisch (Systemgrenze O14) und mit einem
// ENGEN NEGATIV-VERBOT am Tool-Entscheidungspunkt: ohne den letzten Satz waehlt das
// Modell check_inbox, wenn der Nutzer nur blaettern will, und verbraucht die Inbox
// beilaeufig (Pre-Mortem R-11). Die Emphase (CONSUMING/NOT/NOT) ist Vertrag und in
// test/p15-mcp-tool-descriptions-en.test.js nach Anzahl UND Reihenfolge gepinnt -
// NICHT umformulieren, NICHT lokalisieren. Modulebene wie CANCEL_CALL_DESCRIPTION:
// haelt registerTools() so klein wie moeglich (der Zeilen-Pin haengt daran).
const CHECK_INBOX_DESCRIPTION =
  "Check the call inbox: inbound calls that finished since the last check - who called, " +
  "what they wanted, what was promised, and what to do now. CONSUMING: entries returned " +
  "here are marked as seen and will NOT appear again. Do NOT use this to browse or re-read " +
  "call history - use list_calls for that.";

// Modulebene wie OPEN_QUESTIONS_FIELD. .optional().describe() in DIESER Reihenfolge:
// .describe().optional() haengte die Beschreibung an das innere Schema, und der
// Beschreibungs-Waechter saehe einen leeren Text.
const INCLUDE_SEEN_FIELD = z
  .boolean()
  .optional()
  .describe("Re-read entries that were already marked as seen. Changes NO marker.");

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

// AL-P13, der Eroeffnungs-Consult: das Feld war das einzige der fuenf Kontext-Felder, das
// dieses Schema NICHT deklarierte - und zod strippt undeklarierte Schluessel STILL. Ueber
// place_call erreichte es den Server also nie, obwohl HTTP-Validierung (routes/
// _validation.js, CONTEXT_FIELDS) und Auswertung (routes/api-calls.js, emitOpeningConsult)
// dafuer gebaut sind. Form und Deckel wie beim Geschwisterfeld key_facts (maxItems 10,
// routes/_validation.js OPEN_QUESTIONS_LIMITS).
//
// Auf Modulebene wie CALENDAR_ENTRY/CALL_LIST_ENTRY daneben, NICHT inline wie die
// Geschwisterfelder: die Schema-Definition von place_call ist bereits so tief
// verschachtelt, dass jede weitere inline gekettete Feld-Definition die Demeter-Grenze
// (G36) reisst. Ein benannter Wert an dieser Stelle haelt die Kette flach.
const OPEN_QUESTIONS_FIELD = z
  .array(z.string())
  .optional()
  .describe(
    "A few (max. 10) short questions that are still open BEFORE the call and that only the principal can answer. They are asked while the phone is ringing, so the agent starts the conversation with the answers.",
  );

// Bestands-Beschreibung von place_call, byte-identisch aus dem Tool-Deskriptor
// herausgeloest (AL-P13 haengt bei aktivem Consult-Kanal genau EINEN Satz an).
const PLACE_CALL_DESCRIPTION =
  "Starts a real phone call by the AI agent to a phone number, pursuing the given objective. The call is billed per minute to the caller's account and is NOT reversible once placed. Which destinations are allowed is decided by the server through its safety gates (permission profile/allowlist, denylist, country, limits) - just call it; disallowed destinations are refused by the server with a clear message. Returns a call_id immediately; some clients also show a live card that updates itself, but this is NOT guaranteed - ALWAYS poll get_call_status with the call_id until it reports a final status. Calling it again for a running number returns that same call (deduplicated: true).";

// AL-P13: der Schleifen-Hinweis haengt am AKTIVEN Kanal. Repo-Lehre (call-quality-chain):
// enge Anweisungen an der Tool-Description wirken dort, wo breite Prompt-Regeln kippen -
// aber eine Anweisung auf ein Werkzeug, das gar nicht registriert ist, waere eine Luege.
// GQ-B1: Die frueher hier zugesagte Gratis-Rueckfrage waehrend der Klingelzeit (Consult #0)
// faellt weg - auf dem live laufenden ElevenLabs-Weg erreicht ihre Antwort keinen Prompt
// mehr: emitOpeningConsult feuert unmittelbar vor dem Waehlen, und backgroundText baut den
// Hintergrund genau einmal beim Waehlen. Eine Zusage ohne Deckung gehoert nicht in eine
// Beschreibung. Der Ersatz ist KONDITIONAL formuliert: consultAllowedFor (das diesen Text
// anhaengt) deckt die Rueckfrage IM Gespraech nicht vollstaendig ab, die braucht zusaetzlich
// IN_CALL_CONSULT_ENABLED - eine unbedingte Zusage waere dort eine Luege. "at most once"
// spiegelt MAX_IN_CALL_CONSULTS_PER_CALL; der Draht dorthin haengt in
// test/gq-b1-briefing-openness.test.js.
const PLACE_CALL_CONSULT_LOOP =
  "Right after this call returns, start calling await_call_event with the returned call_id and keep calling it until it returns event=\"done\" - if the agent runs into a detail the briefing left open, its question reaches you only inside this loop, and it can ask at most once, so answer it straight away. Place the call with what you have: an open detail costs nothing, a guessed one cannot be taken back.";

// Zusammensetzung per filter(Boolean) (Muster briefingSystem in precall-briefing.js):
// Kanal aus -> byte-identisch zum Bestand (test-gepinnt).
const placeCallDescription = (consultLoop) =>
  [PLACE_CALL_DESCRIPTION, consultLoop ? PLACE_CALL_CONSULT_LOOP : null].filter(Boolean).join(" ");

// S1-2c Fix (Owner-Auftrag 15.08.2026): die alte Beschreibung "Cancels a running call
// cleanly" versprach einen bestaetigten Leitungs-Abbruch, den routes/api-calls.js seit
// Owner-Auftrag 15.08.2026 (S1-4) selbst nicht mehr zusichert - das Modell entscheidet
// nach der BESCHREIBUNG, nicht nach dem REST-Rumpf, und eine ueberholte Beschreibung ist
// dieselbe Luege eine Ebene hoeher (C2). Modulebene statt inline (Muster
// PLACE_CALL_DESCRIPTION): haelt registerTools() bei gleicher Zeilenzahl (Owner-Auflage,
// eslint-legacy-exceptions.json pinnt sie).
const CANCEL_CALL_DESCRIPTION =
  "Cancels the call record and stops billing right away. Whether the phone line itself actually drops is NOT guaranteed on every call path - when it is not, the response says so explicitly instead of claiming a clean hangup.";

// P1 (N-11): auf Modulebene wie PLACE_CALL_DESCRIPTION/CANCEL_CALL_DESCRIPTION/
// CHECK_INBOX_DESCRIPTION - haelt registerTools() klein statt wachsen zu lassen
// (Owner-Auflage, s. Kommentar bei CHECK_INBOX_DESCRIPTION). Der letzte Satz nennt den
// Schreibeffekt in Klartext: readOnlyHint: false stand bereits richtig, aber der
// Seiteneffekt (noteConsultPoll/markConsultAskDelivered, s. TOOL_ANNOTATIONS-Kommentar
// Punkt 2) war in der Beschreibung bisher unsichtbar. Kein Grossschreib-Marker in diesem
// Satz - test/p15-mcp-tool-descriptions-en.test.js pinnt die Emphase von await_call_event
// auf genau ["REPEATEDLY", "NEVER"], nach Anzahl UND Reihenfolge.
const AWAIT_CALL_EVENT_DESCRIPTION =
  "Waits briefly (up to ~20 seconds) for the next event of a running call and returns " +
  "either a question from the agent, the final result, or nothing. Call this REPEATEDLY " +
  "right after place_call and keep going until it returns event=\"done\" - that final " +
  "answer carries the complete result (summary and whether the objective was achieved), " +
  "so there is no need to call get_transcript separately. event=\"none\" simply means " +
  "nothing happened yet: call it again. This tool NEVER returns audio. Each call also " +
  "writes to the call record: it notes that you polled and marks a pending question as " +
  "delivered. Pass after_event_id so you do not receive the same question twice.";

// MCP-Annotations (Phase E2, P0-1, geschaerft P1/N-1/X-1/N-3/N-4): Nebenwirkungs-
// Kennzeichnung je Werkzeug, die ein Client OHNE Beschreibungs-Text lesen kann. Vier
// Festlegungen, die die naechste Sitzung sonst zurueckdreht:
// 1. OpenAI fuehrt readOnlyHint, destructiveHint und openWorldHint als Required (X-1/N-1);
//    die MCP-Spec fuehrt zwei davon als optional. Bei Widerspruch gewinnt die
//    OpenAI-Fassung - deshalb tragen ALLE zwoelf Werkzeuge alle drei Felder, auch die
//    reinen Lese-Werkzeuge mit destructiveHint: false. idempotentHint bleibt optional
//    (N-1 nennt es ausdruecklich so) und steht deshalb weiterhin nur dort, wo es etwas
//    aussagt - an einem Nur-Lese-Werkzeug waere es ein bedeutungsloser Wert.
// 2. openWorldHint entscheidet sich am ZUGRIFF des Werkzeugs, nicht am Thema seiner Daten
//    (N-4 woertlich: Zugriff auf das oeffentliche Internet oder offene externe Entitaeten).
//    get_call_status, get_transcript und await_call_event lesen (bzw. schreiben)
//    ausschliesslich den tenant-lokalen Store (GET /api/calls/:id, routes/api-read.js:98),
//    auch wenn sie ueber einen Anruf nach draussen berichten - deshalb false. place_call,
//    answer_consult und cancel_call wirken auf die echte Leitung bzw. den Carrier -
//    deshalb true.
// 3. answer_consult traegt destructiveHint: true, weil der eingespeiste Text am Telefon
//    ausgesprochen wird (routes/api-calls.js:690) und damit nicht zurueckholbar ist -
//    N-3 woertlich: "even ... through indirect side effects".
// 4. place_call behaelt idempotentHint: false, obwohl der Aufruf fuer eine bereits
//    laufende Nummer denselben Anruf zurueckgibt (deduplicated: true, PLACE_CALL_
//    DESCRIPTION oben): die Entdopplung gilt nur fuer die Dauer des laufenden Anrufs, ein
//    spaeterer Aufruf waehlt erneut. Untertreiben ist hier die sichere Richtung; die
//    Entdopplung selbst steht in der Beschreibung und ist damit nach N-11 offengelegt.
// N-02/N-03: das sind HINTS, keine Garantie - ein Client darf seine Nutzungsentscheidung
// nicht allein darauf stuetzen; die Beschreibungstexte bleiben die eigentliche Quelle.
// title steht weiterhin genau hier (annotations.title), wird aber von
// withOpenAiToolMetadata() zusaetzlich auf Top-Level gehoben (T-18, P2) - keine zweite,
// namensindizierte Tabelle. annotations.title bleibt als W-09-Rueckfall
// (title > annotations.title > name).
// Wie die Beschreibungen einsprachig Englisch (Systemgrenze O14 oben) - nur das
// Client-Modell liest das, keine Tenant-Sprache.
// EIN modulweiter Wahrheitstabelle statt zehn Inline-Literalen (Owner-Auflage
// "registerTools darf NICHT wachsen", s. Kommentar bei CHECK_INBOX_DESCRIPTION/
// CANCEL_CALL_DESCRIPTION) - dieselbe Auslagerung wie CALL_OUTPUT/CALENDAR_OUTPUT/
// MY_NUMBER_OUTPUT. Reihenfolge = Registrierreihenfolge (Vollstaendigkeit gegen die Datei
// abzaehlbar). await_call_event ist NICHT readOnly: seine Route schreibt zwei Felder
// (noteConsultPoll/markConsultAskDelivered, routes/api-calls.js + state-ops.js) - der
// Code widerspricht damit einer frueheren Einschaetzung, und der Code gewinnt.
const TOOL_ANNOTATIONS = {
  place_call: {
    title: "Place a phone call",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  await_call_event: {
    title: "Wait for call update",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  answer_consult: {
    title: "Answer call question",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  get_call_status: {
    title: "Get call status",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  get_transcript: {
    title: "Get call transcript",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  cancel_call: {
    title: "Cancel a call",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  get_my_number: {
    title: "Agent phone number",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  list_calls: {
    title: "List calls",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  check_inbox: {
    title: "Check inbox",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  list_action_items: {
    title: "List action items",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  get_calendar: {
    title: "Get calendar",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  get_agent_status: {
    title: "Get agent status",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

// T-22: Statuszeilen fuer den Moment "waehrend"/"nach" dem Tool-Aufruf, je <= 64 Zeichen
// (die Grenze prueft der Test, kein Laufzeit-Waechter - ein Waechter waere Code, der im
// Betrieb nie etwas tut). Reihenfolge = Registrierreihenfolge (Vollstaendigkeit gegen die
// Datei abzaehlbar, wie TOOL_ANNOTATIONS oben).
const OPENAI_INVOKING_KEY = "openai/toolInvocation/invoking";
const OPENAI_INVOKED_KEY = "openai/toolInvocation/invoked";
const TOOL_INVOCATION_STATUS = {
  place_call: { invoking: "Placing the call", invoked: "Call started" },
  await_call_event: {
    invoking: "Waiting for the next call event",
    invoked: "Call event received",
  },
  answer_consult: {
    invoking: "Sending your answer to the agent",
    invoked: "Answer delivered",
  },
  get_call_status: { invoking: "Checking the call status", invoked: "Call status read" },
  get_transcript: { invoking: "Reading the call transcript", invoked: "Transcript read" },
  // invoked bewusst "Cancellation requested", nicht "Call cancelled": der REST-Pfad
  // sichert seit S1-4 keinen bestaetigten Leitungsabbruch zu (dieselbe Wahrheit wie
  // CANCEL_CALL_DESCRIPTION). Eine Statuszeile darf nicht mehr behaupten als die
  // Beschreibung.
  cancel_call: { invoking: "Cancelling the call", invoked: "Cancellation requested" },
  get_my_number: { invoking: "Looking up the agent number", invoked: "Agent number read" },
  list_calls: { invoking: "Listing recent calls", invoked: "Recent calls listed" },
  check_inbox: { invoking: "Checking the call inbox", invoked: "Inbox checked" },
  list_action_items: {
    invoking: "Listing open action items",
    invoked: "Action items listed",
  },
  get_calendar: { invoking: "Reading the calendar", invoked: "Calendar read" },
  get_agent_status: { invoking: "Checking the agent status", invoked: "Agent status read" },
};

// T-18/T-22 (P2, DP-7): hebt title auf Top-Level und haengt die Statuszeilen an _meta an -
// fuer JEDES Werkzeug, ausserhalb der zwoelf Config-Literale. Grund: fuenf der Literale
// spreaden ...enableWidgetUi() als LETZTES Feld; ein vorher im Literal gesetztes _meta
// wuerde von diesem Spread still und vollstaendig ueberschrieben (Objekt-Literal-Semantik,
// kein Deep-Merge). Deshalb erst HIER, nachdem das Literal fertig gebaut ist.
// title kommt NUR aus config.annotations?.title (W-09: title > annotations.title > name)
// - keine zweite, namensindizierte Tabelle. Damit gibt es strukturell EINE Titel-Quelle,
// title und annotations.title koennen nicht auseinanderlaufen.
// _meta entsteht als { ...statusMeta, ...config._meta }: der Widget-Anteil steht HINTEN
// und gewinnt bei (heute unmoeglicher) Kollision - die Namensraeume sind disjunkt (ui /
// openai/outputTemplate vs. openai/toolInvocation/*).
// Fehlt ein Tool in TOOL_INVOCATION_STATUS, entstehen KEINE halben Schluessel (leeres
// Fragment statt throw) - eine fehlende Statuszeile ist kosmetisch, ein Wurf hier wuerde
// /mcp fuer alle Mandanten zerlegen. Die Luecke faengt der Vollstaendigkeitstest, der ueber
// die ausgelieferte Liste iteriert, nicht ueber eine Namensliste.
const withOpenAiToolMetadata = (name, config) => {
  const status = TOOL_INVOCATION_STATUS[name];
  const statusMeta = status
    ? { [OPENAI_INVOKING_KEY]: status.invoking, [OPENAI_INVOKED_KEY]: status.invoked }
    : {};
  return {
    ...config,
    title: config.annotations?.title,
    _meta: { ...statusMeta, ...config._meta },
  };
};

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
// consultAllowed (AL-P13) defaultet auf FALSE (nicht wie allowCalendar auf true): der
// stdio-Transport hat kein Client-Modell, das pollt, und ein Default-an wuerde die
// byte-gepinnte Beschreibungs-Inventur ohne Not verschieben.
export function registerTools(
  server,
  {
    identity = null,
    scopedTenant = null,
    allowCalendar = true,
    consultAllowed = false,
    uiHost = null,
    language = null,
  } = {},
) {
  const call = (method, path, body) => api({ method, path, body, identity, scopedTenant });
  // Eigener, benannter Zugang fuer den EINEN lange haltenden Aufruf (kein viertes
  // Positions-Argument an call(), keine zweite fetch-Implementierung). Ein Zeitablauf
  // ist das NORMALE Ergebnis eines Long-Polls und wird deshalb GEZIELT zu event="none" -
  // wrapHandler machte daraus sonst ein isError und braeche die Schleife ab.
  const pollConsult = async (path) => {
    try {
      return await api({
        method: "GET",
        path,
        identity,
        scopedTenant,
        timeoutMs: CONSULT_POLL_ABORT_MS,
      });
    } catch (err) {
      if (isAbortError(err)) return NO_CONSULT_EVENT;
      throw err;
    }
  };
  // E3: eigener, benannter Zugang fuer den EINEN Aufruf, der einen echten Anruf ausloest -
  // dasselbe Muster wie pollConsult (kein viertes Positions-Argument an call(), keine zweite
  // fetch-Implementierung). call() selbst bleibt unangetastet, die uebrigen Werkzeuge damit
  // byte-identisch. Der Zeitablauf wird hier NICHT geschluckt (anders als beim Long-Poll):
  // er wird zu einer stabilen Kennung, die wrapHandler in der Tenant-Sprache ausgibt.
  const placeCallHop = async (body) => {
    try {
      return await api({
        method: "POST",
        path: "/api/calls",
        body,
        identity,
        scopedTenant,
        timeoutMs: PLACE_CALL_HOP_TIMEOUT_MS,
      });
    } catch (err) {
      if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.CALL_START_UNCONFIRMED);
      throw err;
    }
  };
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
    // E4/P13: die servergerenderte Widget-Sprache ist die Agentensprache. Weitergereicht
    // wird die BEREITS aufgeloeste loc.language (nie das rohe language-Feld) - damit gilt
    // im Widget dieselbe eine Aufloesungsregel wie im Text- und im Anrufkanal.
    uiRenderer.registerResource(server, widgetId, loc.language);
    return { _meta: uiRenderer.toolMeta(widgetId) };
  };

  // AC6 per-handler Throw-Schutz (gilt stdio UND HTTP /mcp, da registerTools geteilt
  // ist): wickelt JEDEN Handler in ein catch. Ein Tool-Throw (Gateway-Fehler,
  // Result-Guard, Deref) wird zu einer sauberen MCP-Fehlerantwort (isError) statt
  // einer process-level unhandled rejection. requireFields-Meldungen sind bereits
  // generisch; alles andere bekommt eine stabile, provider-freie Meldung (kein Leak).
  // EINE Fehlerhuelle fuer uiTool() (G5/S2 - keine Duplizierung). Bis P2 (T-18/T-22) war
  // sie auch von der inzwischen entfernten tool()-Fabrik geteilt (Legacy-Registrierweg
  // server.tool, s. Kommentar an uiTool() unten).
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

  // Einziger Registrierweg: ueber registerTool(config) -> erlaubt outputSchema (Stufe 0
  // schema-validiert) und _meta.ui.resourceUri (Stufe 1). config ohne outputSchema/_meta
  // im Literal -> Stufe-0-only. withOpenAiToolMetadata() hebt title auf Top-Level und
  // haengt die T-22-Statuszeilen an (P2, s. Kommentar dort) - NACHDEM das Literal fertig
  // gebaut ist, damit ein spaeter gespreadetes Widget-_meta nichts ueberschreibt.
  const uiTool = (name, config, handler) =>
    server.registerTool(name, withOpenAiToolMetadata(name, config), wrapHandler(handler));

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
      description: placeCallDescription(consultAllowed),
      annotations: TOOL_ANNOTATIONS.place_call,
      inputSchema: {
        to: z
          .string()
          .describe(
            "Take the destination number over EXACTLY as the user gave it - copy the digits character by character, NEVER convert them or reshape them into E.164 (reshaping introduces digit errors; the server normalises deterministically). A national notation with a leading 0 is resolved by the server via the user's home country; international destinations need +XX/00XX - if a number looks like a foreign national format, ask the user for the international notation instead of guessing. Checked server-side by the safety gates (permission profile/allowlist, denylist, country).",
          ),
        // GQ-B1: Die Vorab-Rueckfrage gilt nur noch dem THEMA selbst - der Satz wird
        // woertlich vorgesprochen, ohne Thema gibt es keinen sprechbaren ersten Satz. Eine
        // fehlende Praeferenz traegt dagegen das Mandat oder die Live-Rueckfrage. Der neue
        // Nebensatz benennt den dritten Ausgang ("stays open") und ist BEWUSST durchgehend
        // klein geschrieben: jedes Grossbuchstaben-Wort mit zwei oder mehr Buchstaben
        // verschoebe die gepinnte Marker-Inventur dieses Feldes.
        objective: z
          .string()
          .describe(
            "The goal of the call as ONE speakable first-person sentence from the perspective of the calling assistant - it is read out VERBATIM to the called party right after the disclosure, BEFORE they answer. Phrase it the way a human states their concern on the phone, e.g. 'I would like to book a men's haircut for Max on Saturday morning.' NO bare-infinitive stub like 'Book an appointment'. ALWAYS name a concrete topic/occasion when it is known; if the topic itself is still unknown, ask the user FIRST, instead of sending off a vague task - a single missing detail is not a reason to ask, it belongs in the briefing or stays open. Background and details do NOT belong here, they belong in the briefing.",
          ),
        // GQ-B2 (Owner-Entscheidung 2026-08-19): der Auftraggeber ist waehrend des Anrufs
        // ABWESEND - das ist der Normalfall. Die GQ-B1-Pauschale ("nie vertroesten")
        // ueberschoss deshalb: sie verbrennt die eine gedeckelte Rueckfrage auf Fragen, die
        // auch der auftraggebende Assistent nicht beantworten kann. An ihre Stelle tritt die
        // Selbsteinschaetzung in drei Klassen - eigene Quellen (offen lassen + deklarieren),
        // Nur-Owner-Wissen (die ehrliche Prozess-Auskunft, KEINE erfundene Antwort),
        // oeffentlich pruefbar (nichts schreiben). Die Erfindungs-Sperre ("never script an
        // answer") bleibt woertlich stehen, sie ist weiterhin wahr. Der Text nennt bewusst
        // KEIN Werkzeug: das Feld ist immer registriert, waehrend die Rueckfrage am Kanal
        // haengt - die Anweisung dazu steht am kanalabhaengigen PLACE_CALL_CONSULT_LOOP.
        briefing: z
          .string()
          .optional()
          .describe(
            "Relevant context from the chat so far that the agent needs for the call: what it is about, the names involved, likes/preferences, history as well as the desired outcome and tone. SUMMARISE instead of copying in raw - only what counts for the conversation. NO secrets, passwords or payment data. Write only what you KNOW: never script an answer for a detail you are missing. For each gap, decide: could you answer it yourself during the call (calendar, mail, files, chat)? Then leave the gap open and declare that in one line. Can only the principal know it? Then write the honest line that they will get back on it. Can anyone look it up? Then write nothing. The agent speaks as the personal AI assistant of the principal (not as Claude/Gemini); phrase the context from their perspective.",
          ),
        constraints: z
          .string()
          .optional()
          .describe(
            "Hard limits the agent must not cross in the conversation, e.g. 'Not before 10 am, at most 40 euros, do not promise a deposit.'",
          ),
        // P6 (PLAN-CONVERSATION-QUALITY-V2): Vorab-Mandat. Ohne Eintrag im zod-Schema
        // erreichte das Feld /api/calls nie (zod strippt unbekannte Keys - dieselbe
        // Falle wie bei diagnostic). Kein Constraint-DSL: die Feld-BESCHREIBUNGEN sind
        // das Feature, nicht der Typ.
        mandate: z
          .object({
            // GQ-B1: Die zweite "Ask the user FIRST"-Anweisung ist gestrichen - die bedingte
            // Aufforderung im ELTERN-Feld mandate bleibt woertlich stehen und ist der
            // verbleibende Weg zu einem Rahmen. Die Erfindungs-Sperre bleibt (sie ist die
            // sicherheitsrelevante Haelfte); der Ausgang dreht von "Chat-Runde" auf "Feld
            // weglassen" und ist damit fail-closed: ohne Feld darf der Agent nichts zusagen,
            // genau das sagt der naechste Satz derselben Beschreibung bereits.
            decide_freely: z
              .string()
              .optional()
              .describe(
                "The authorisation - what the agent may commit to in the call WITHOUT asking back, e.g. 'appointment on any weekday between 9 and 12, up to 60 euros'. Phrase it concretely enough that a yes/no decision can be derived from it on the phone; vague frames ('flexible', 'sometime') do not help. Never invent one: take the frame from what the user has already said, otherwise leave the field out. WITHOUT this field the agent may commit to nothing and only passes every proposal on as a message. Hard prohibitions do NOT belong here, they belong in constraints.",
              ),
            fallback_order: z
              .string()
              .optional()
              .describe(
                "Preference order the agent works through on its own if the first choice does not work, e.g. 'Thursday morning first, otherwise Friday, otherwise next week'. Without this field it will not try any alternative on its own.",
              ),
            on_out_of_scope: z
              .enum(MANDATE_OUT_OF_SCOPE_VALUES)
              .optional()
              .describe(
                "What the agent does when an offer lies OUTSIDE decide_freely: 'take_message' (default) - record the offer with all details, pass it on and promise that the user will get back; 'decline' - politely refuse, without a counter-offer; 'accept_best' - accept and record the best offer made anyway. Set 'accept_best' ONLY when the user explicitly says that any option suits them.",
              ),
          })
          .optional()
          .describe(
            "Optional advance MANDATE: the frame within which the agent may decide ITSELF in the conversation, instead of returning every question as a message. Through this the agent books NOTHING and gets NO calendar access - it only commits verbally to what the user allowed in advance. Ask the user about their frame when an appointment or price question is to be expected in the call; without a mandate the agent can only answer 'When suits you?' with 'I will pass that on'. In a conflict with constraints, constraints ALWAYS win.",
          ),
        context: z
          .object({
            summary: z
              .string()
              .optional()
              .describe(
                "What the call is about, summarised in 1-3 sentences (not a raw dump of the chat).",
              ),
            key_facts: z
              .array(z.string())
              .optional()
              .describe(
                "A few (max. 10) short bullet points with facts relevant to the conversation (names, dates, preferences). NO secrets/passwords/payment data.",
              ),
            recipient_relationship: z
              .string()
              .optional()
              .describe("Relationship of the principal to the called party, e.g. 'regular hairdresser', 'new customer'."),
            desired_outcome: z
              .string()
              .optional()
              .describe("The desired outcome from the principal's perspective, phrased briefly."),
            open_questions: OPEN_QUESTIONS_FIELD,
          })
          .optional()
          .describe(
            "Optional structured BACKGROUND for the conversation (only for the agent's information, ADDITIONAL to the briefing). The agent speaks as the personal AI assistant of the principal, NEVER as Claude/Gemini; only pass on what the task requires. NO secrets.",
          ),
        // LANG-15 AUFGEHOBEN (Owner-Entscheidung F-2, 2026-09-06, PLAN-ANRUFDEFEKTE.md
        // Abschnitt 6): das Feld gibt es wieder - und es WIRKT. Bis dahin entschied allein
        // die Zielnummer; ein portugiesischer Auftrag an eine deutsche Nummer war nicht
        // ausdrueckbar und der Widerspruch wurde STILL ignoriert (W5, gemessen an
        // call_mtq08ett4l3o). Ohne Angabe gilt ab hier die Sprache des AUFTRAGGEBERS, nicht
        // mehr die des Ziellandes; ein nicht unterstuetzter Code wird mit 400
        // unsupported_language abgelehnt statt auf den Weltdefault gedreht.
        // WAS DIESES FELD NICHT KANN (hartes Gate, F-2 Punkt 4 / PM-2): die Sprache des
        // OFFENLEGUNGSSATZES bestimmen. Die folgt weiterhin dem ANGERUFENEN
        // (elevenlabs/call-locale.js) - eine client-gewaehlte Sprache darf nicht darueber
        // entscheiden, ob ein Mensch die Artikel-50-Aufklaerung versteht.
        // Der Katalog reist aus SUPPORTED_LANGUAGES in den Text, nicht getippt: sonst
        // veraltet die Beschreibung mit der naechsten Sprache (P4b).
        language: z
          .string()
          .optional()
          .describe(
            `The language the agent SPEAKS in this call - one of: ${SUPPORTED_LANGUAGES.join(", ")}. ` +
              "Leave it out unless the user asked for a particular language: without it the call " +
              "is held in the principal's own language. An unsupported code is REJECTED with an " +
              "error instead of being ignored. This does NOT change the language of the mandatory " +
              "AI disclosure - that always follows the person being called.",
          ),
        // S1-6 DiD: schema-seitig bereits positiv/ganzzahlig/gecappt (der eigentliche
        // Wurzelfix sitzt in outbound-gates.js resolveMaxDurationS, das JEDEN Body-Wert
        // - auch einen durch diese Zod-Grenze rutschenden - nochmal klemmt).
        max_duration_s: z
          .number()
          .int()
          .positive()
          .max(MAX_CALL_DURATION_CAP_S)
          .optional()
          .describe(
            "Optional upper bound for the call duration in seconds. The server derives the " +
              "effective limit from the remaining credit and only ever applies a SHORTER value " +
              "than that; it never extends a call.",
          ),
        // P2b + GQ-P11 (Diagnose-Retention): OPT-OUT statt Opt-in. Der Server entscheidet
        // selbst, ob das Roh-Transkript die Summary ueberlebt - und nur beim Ziel "eigene
        // verifizierte Nummer des Nutzers"; dieses Feld ist ausschliesslich der
        // Widerspruch dagegen. Der Grund fuer die Umkehrung steht in
        // src/diagnostic-retention.js. Ohne diesen Eintrag erreichte das Feld /api/calls
        // nie (Zod strippt unbekannte Keys).
        diagnostic: z
          .boolean()
          .optional()
          .describe(
            "Leave this unset in normal use. The server keeps the raw transcript of a call to the user's OWN verified number for a limited period on its own, so the conversation can be analysed afterwards - you do NOT have to ask for it. Set it to false ONLY when the user explicitly does not want that transcript kept. For any other destination the field has no effect.",
          ),
      },
      outputSchema: CALL_OUTPUT,
      ...enableWidgetUi(WIDGET_CALL),
    },
    async (args) => {
      const r = await placeCallHop(args);
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
        // E3: defensive Normalisierung wie normalizeContextReceived - ein Gateway-Body ohne
        // das additive Feld (aelterer Mock) darf nicht crashen; fail-closed auf false, nie
        // auf Verdacht "war schon da".
        deduplicated: !!r.deduplicated,
      };
      // AL-P13: der Berechtigungs-Hinweis haengt EINMAL JE ANRUF am place_call-Ergebnis,
      // NICHT an jedem Poll - ein einmaliger Einrichtungs-Schritt ist zumutbar, ein Klick
      // pro Rueckfrage nicht. Kanal aus -> Textblock byte-identisch zum Bestand.
      const started = JSON.stringify({ call_id: data.call_id, status: data.status }, null, 2);
      // E3 (N-11): der Dedup-Hinweis reist als eigene Zeile, NICHT im started-JSON-Block
      // (der bleibt byte-identisch gepinnt, test/mcp-ui.test.js).
      const hinweise = [
        data.deduplicated ? loc.mcp.callAlreadyRunningHint : null,
        consultAllowed ? loc.mcp.consultPermissionHint : null,
      ].filter(Boolean);
      return {
        content: [{ type: "text", text: [started, ...hinweise].join("\n") }],
        structuredContent: data,
      };
    },
  );

  // AL-P13: die zwei Werkzeuge des Consult-Kanals - NUR bei freigegebener Faehigkeit
  // (Schnittmenge Master-Schalter x Kontext-Kanal x Tenant, consult/gate.js). Nicht
  // freigegeben -> gar nicht erst registriert (fail-closed, Bestand byte-identisch).
  if (consultAllowed) {
    uiTool(
      "await_call_event",
      {
        description: AWAIT_CALL_EVENT_DESCRIPTION,
        annotations: TOOL_ANNOTATIONS.await_call_event,
        inputSchema: {
          call_id: z.string().describe("The call_id from place_call"),
          after_event_id: z
            .string()
            .optional()
            .describe(
              "The event_id you last handled. Pass it so you do not receive the same question twice.",
            ),
        },
        outputSchema: AWAIT_EVENT_OUTPUT,
      },
      async ({ call_id, after_event_id }) => {
        const query = after_event_id ? `?after=${encodeURIComponent(after_event_id)}` : "";
        const event = await pollConsult(`/api/calls/${call_id}/consult${query}`);
        const finished =
          event.event === CONSULT_EVENT.DONE ? await call("GET", `/api/calls/${call_id}`) : null;
        const data = awaitEventView({ callId: call_id, event, finished, texts: loc.mcp });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        };
      },
    );

    uiTool(
      "answer_consult",
      {
        // GQ-B2 Fix-Runde 1: der Owner ist waehrend des Anrufs ABWESEND (Normalfall) -
        // dieselbe Praemisse, die MCP_CONSULT_INSTRUCTIONS traegt. Eine unbedingte
        // "ask the user FIRST" waere an diesem naeheren Entscheidungspunkt die Anweisung,
        // die den Zieldefekt (Schweigen bis zum Timeout) erst ausloest. Der Satz spiegelt
        // jetzt denselben Unbekannt-Ausgang wie MCP_CONSULT_INSTRUCTIONS: ehrlich melden
        // statt erfinden, statt auf den abwesenden Menschen zu warten.
        description:
          "Answers a question the phone agent asked during a running call. " +
          // P2 (SCOPE 2): die Quittung ist die ERSTE Pflicht nach Erhalt der Frage - sie
          // ist zugleich der Berechtigungstest. Bleibt sie aus, bricht der Server den
          // Halt nach wenigen Sekunden ab, statt den Anrufer 47 s stumm warten zu lassen.
          "FIRST, the moment you receive the question, call this tool once with " +
          'status="working" and no answers - that tells the agent someone is on it. ' +
          'THEN send the real answer with status="final" (the default). ' +
          "Give SHORT factual answers - one entry per question, each at most " +
          KEY_FACTS_LIMITS.maxLen +
          " characters; longer answers are REJECTED and the question stays open. Do NOT invent " +
          "facts: if you do not know, say so honestly here instead of guessing. Answers reach " +
          "the agent as background information only.",
        annotations: TOOL_ANNOTATIONS.answer_consult,
        inputSchema: {
          call_id: z.string().describe("The call_id from place_call"),
          event_id: z.string().describe("The event_id from await_call_event"),
          status: z
            .enum([CONSULT_ANSWER_MODE.WORKING, CONSULT_ANSWER_MODE.FINAL])
            .optional()
            .describe(
              '"working" = acknowledge immediately, no answers needed. "final" (default) = the answer.',
            ),
          answers: z
            .array(z.string())
            .optional()
            .describe(
              "One short answer per open question, in the order the questions were given. " +
                'Required unless status is "working".',
            ),
        },
        outputSchema: ANSWER_CONSULT_OUTPUT,
      },
      async ({ call_id, event_id, status, answers }) => {
        try {
          const r = await call("POST", `/api/calls/${call_id}/consult/answer`, {
            event_id,
            status,
            answers,
          });
          if (status === CONSULT_ANSWER_MODE.WORKING) {
            return {
              content: [{ type: "text", text: loc.mcp.consultAckAccepted }],
              structuredContent: { accepted: true, merged_facts: 0 },
            };
          }
          const mergedFacts = typeof r?.merged_facts === "number" ? r.merged_facts : 0;
          return {
            content: [{ type: "text", text: loc.mcp.consultAnswerAccepted(mergedFacts) }],
            structuredContent: { accepted: true, merged_facts: mergedFacts },
          };
        } catch (err) {
          // Beide Faelle sind erwartbare Zustaende der Schleife, KEIN Werkzeugfehler:
          // das Modell soll weiterpollen statt abzubrechen. structuredContent bleibt
          // Pflicht (das Tool deklariert ein outputSchema) - accepted=false ist die
          // ehrliche Quittung. Alles andere bleibt der gemeinsamen Fehlerhuelle
          // (wrapHandler) ueberlassen.
          if (err?.httpStatus === CONSULT_ANSWER_REJECTED_STATUS)
            return notAccepted(loc.mcp.consultAnswerRejected);
          if (err?.httpStatus === CONSULT_ANSWER_CONFLICT_STATUS)
            return notAccepted(loc.mcp.consultNoLongerOpen);
          throw err;
        }
      },
    );
  }

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
        "Returns the live state of a call: status (dialing|in_progress|completed|failed|cancelled), duration and the last transcript lines. Some clients also show a live card that updates itself; call this tool regardless whenever the current state is needed, it always reflects it.",
      annotations: TOOL_ANNOTATIONS.get_call_status,
      inputSchema: { call_id: z.string().describe("The call_id from place_call") },
      outputSchema: CALL_STATUS_OUTPUT,
    },
    async ({ call_id }) => callStatusResult(call_id),
  );

  // Reines Stufe-0-Tool (W2): kein Widget-Anhang mehr - der Abschluss (Summary/Ziel-
  // Status) erscheint jetzt in der vereinten place_call-Karte (WIDGET_CALL), die
  // get_transcript beim Terminal-Status "completed" selbst ueber ihre Host-Bruecke
  // aufruft. Bleibt als Text-Tool erhalten (Fallback, falls die Widget-Bruecke nicht
  // antwortet). Handler/Whitelist (pickTranscript) unveraendert.
  //
  // Review-Runde 2 (P4): die alte Beschreibung ("call this only once status=completed")
  // war ENGER als der Handler (der lehnt einzig status==="active" ab, :1280) - ein nicht
  // platzierter Anruf ist status=failed, nicht completed, und wurde vom Modell deshalb
  // faelschlich uebersprungen. Jetzt am tatsaechlichen Handler-Verhalten ausgerichtet.
  uiTool(
    "get_transcript",
    {
      description:
        "After the call has ended, returns the result summary and whether the objective was achieved. This tool NEVER returns the raw transcript - whether the server keeps it afterwards on its own follows the diagnostic rule of place_call's diagnostic field and is independent of this response. Call this once get_call_status reports a final status - completed, failed or cancelled, not only completed - it carries the result summary for those too.",
      annotations: TOOL_ANNOTATIONS.get_transcript,
      inputSchema: { call_id: z.string().describe("The call_id from place_call") },
      outputSchema: TRANSCRIPT_OUTPUT,
    },
    async ({ call_id }) => {
      const c = await call("GET", `/api/calls/${call_id}`);
      // T-19/T-20: das Werkzeug deklariert ein outputSchema (:1263). text() (:79-81)
      // liefert weder structuredContent noch isError - der SDK-Validator wirft dann
      // "Output validation error", und der Client sieht die Systemmeldung statt des
      // Hinweises. "Anruf laeuft noch" IST ein Fehlerergebnis im MCP-Sinn, also errText.
      if (c.status === "active") return errText(loc.mcp.callStillRunning);
      // Validiert, dass ein echtes Call-Objekt zurueckkam (transcript-Feld vorhanden);
      // das Roh-Transkript selbst wird bewusst NICHT durchgereicht (Whitelist unten).
      requireFields(c, { transcript: "array" });
      const data = pickTranscript(call_id, c, loc.mcp); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
      // Textblock = Summary/Ziel-Sicht (kein call_id, analog get_call_status);
      // structuredContent ist die SSOT-Obermenge inkl. call_id (Whitelist). Roh-
      // Transkript taucht in KEINER Sicht auf (DSGVO).
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                result_summary: data.result_summary,
                objective_achieved: data.objective_achieved,
                ...resultCardView(c.result),
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: data,
      };
    },
  );

  // TEIL C (Owner-Auflage 15.08.2026, registerTools darf NICHT wachsen): der REST-Body wird
  // UNVERAENDERT durchgereicht statt eines hartkodierten {status:"cancelled"} - die Route
  // (routes/api-calls.js) traegt seit dieser Aenderung die ehrliche Auskunft (Datensatz vs.
  // Leitung, S1-4: zusaetzlich hangup_attempted) bereits selbst. Kein zweiter Wortlaut hier
  // (G5). Die Beschreibung selbst ist S1-2c-korrigiert (CANCEL_CALL_DESCRIPTION oben).
  uiTool(
    "cancel_call",
    {
      description: CANCEL_CALL_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.cancel_call,
      inputSchema: { call_id: z.string().describe("The call_id from place_call") },
      // KEIN outputSchema: der Handler liefert ausschliesslich text(...), nie
      // structuredContent (s. Schritt 12 P2-Spec, Beleg test/openai-p2-tool-metadaten.test.js).
    },
    async ({ call_id }) => text(await call("POST", `/api/calls/${call_id}/cancel`)),
  );

  // Stufe 0 (Text byte-identisch zum Bestand) + structuredContent (Whitelist) + Stufe 1
  // (my-number Widget) NUR bei faehigem Host. Der Textblock bleibt JSON.stringify ueber
  // den ROHEN agent.number (undefined -> "{}", byte-identisch); structuredContent
  // normalisiert auf null (Schema nullable), damit fehlende Nummer kein isError ist.
  uiTool(
    "get_my_number",
    {
      description: "Returns the phone number of the phone agent.",
      annotations: TOOL_ANNOTATIONS.get_my_number,
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
        "Lists the agent's most recent calls (inbound and outbound) with status and summary.",
      annotations: TOOL_ANNOTATIONS.list_calls,
      inputSchema: {},
      outputSchema: CALLS_OUTPUT,
      ...enableWidgetUi(WIDGET_CALLS),
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { calls: "array" });
      const entries = s.calls.map((c) => pickCall(c, formatDate)); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
      const txt = entries.length ? entries.map(callTextLine).join("\n") : loc.mcp.emptyCalls;
      return {
        content: [{ type: "text", text: txt }],
        structuredContent: { calls: entries },
      };
    },
  );

  // INBOX-P3 (E-5): der Konsum-Kanal der Anruf-Inbox. uiTool wegen outputSchema, aber
  // OHNE _meta/Widget - Stufe 0 genuegt, ein weiteres Widget waere Karten-Spam.
  // Der Handler PROJIZIERT NICHT: er reicht den fertigen REST-Eintrag durch und tauscht
  // nur started_at gegen das formatierte at (inboxEntryForModel). Die Whitelist lebt in
  // state-ops.inboxEntryView - hier gibt es keine zweite Feldliste (S2-1).
  // include_seen wird unveraendert durchgereicht; ueber fail-closed entscheidet der
  // Server (api-inbox.js: alles ausser strikt true ist false), nicht das Modell.
  // Kein Roh-Transkript, kein facts, kein evidence, kein Audio (Regel 5) - strukturell,
  // weil die Quelle sie gar nicht erst fuehrt.
  uiTool(
    "check_inbox",
    {
      description: CHECK_INBOX_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.check_inbox,
      inputSchema: { include_seen: INCLUDE_SEEN_FIELD },
      outputSchema: INBOX_OUTPUT,
    },
    async ({ include_seen: includeSeen = false } = {}) => {
      const polled = await call("POST", "/api/inbox/poll", { include_seen: includeSeen });
      requireFields(polled, { entries: "array", remaining: "number" });
      const entries = polled.entries.map((entry) => inboxEntryForModel(entry, formatDate));
      const txt = entries.length
        ? entries.map((entry) => inboxTextLine(entry, loc.mcp)).join("\n")
        : loc.mcp.emptyInbox;
      return {
        content: [{ type: "text", text: txt }],
        structuredContent: { entries, remaining: polled.remaining },
      };
    },
  );

  // Leertext und Termin-Praefix folgen der Tenant-Sprache (MCP-14): sie kommen aus
  // DEMSELBEN Locale-Buendel wie Rollen-Praefix, Fehler- und Leertexte (loc.mcp), kein
  // zweiter Lookup. DE bleibt byte-identisch zum Bestand.
  uiTool(
    "list_action_items",
    {
      description: "Lists open action items from all calls.",
      annotations: TOOL_ANNOTATIONS.list_action_items,
      inputSchema: {},
      // KEIN outputSchema: beide Rueckgabepfade sind text(...), nie structuredContent.
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { actionItems: "array" });
      const open = s.actionItems.filter((a) => !a.done);
      if (!open.length) return text(loc.mcp.emptyActionItems);
      return text(
        open
          .map(
            (a) =>
              `[${a.id}] ${a.type === "appointment" ? loc.mcp.appointmentPrefix : ""}${a.text}`,
          )
          .join("\n"),
      );
    },
  );

  // Kalender-Tool nur registrieren, wenn das Profil es erlaubt (Phase 2). Ein
  // restriktives Profil sieht get_calendar gar nicht erst. Stufe 0 (Text byte-identisch)
  // + structuredContent (Whitelist: title/start/end je Eintrag) + Stufe 1 (calendar
  // Widget) bei faehigem Host. Text UND structuredContent lesen dieselben gewhitelisteten
  // Eintraege (eine Quelle); leerer Kalender behaelt DE byte-identisch "Kalender ist
  // leer." + leere Liste.
  if (allowCalendar)
    uiTool(
      "get_calendar",
      {
        description: "Shows the owner's next calendar entries.",
        annotations: TOOL_ANNOTATIONS.get_calendar,
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
        // Auch die BEFUELLTE Zeile folgt der Tenant-Sprache (MCP-14), nicht nur der
        // Leertext: Verbinder und Interpunktion um den Zeitraum liegen im Locale-Buendel
        // (loc.mcp.calendarLine). Explizite Arrow statt punktfreiem map(loc.mcp.calendarLine),
        // damit map() nicht Index/Array als weitere Argumente durchreicht.
        const txt = entries.length
          ? entries.map((e) => loc.mcp.calendarLine(e)).join("\n")
          : loc.mcp.emptyCalendar;
        return {
          content: [{ type: "text", text: txt }],
          structuredContent: { calendar: entries },
        };
      },
    );

  // KS-P8: EINE Statuszeile fuer die Monatsnutzung. Ohne hinterlegtes Kontingent (null)
  // der fail-closed-Wortlaut aus dem Sprachbuendel statt einer erfundenen 0 %.
  function planUsageLine(percent, agentStatusTexts) {
    return percent === null ? agentStatusTexts.planUsageUnknown : agentStatusTexts.planUsage(percent);
  }

  // Stufe 0 (Text byte-identisch zum Bestand, Backward-Compat) + structuredContent
  // (Whitelist) + Stufe 1 (agent-status Widget) NUR bei faehigem Host (enableWidgetUi).
  // Der Textblock liest dieselben gewhitelisteten Daten (data.*) - eine Quelle, keine
  // Duplizierung der Formatierung (permissions).
  uiTool(
    "get_agent_status",
    {
      description:
        "Status of the phone agent: phone number, monthly usage, permissions.",
      annotations: TOOL_ANNOTATIONS.get_agent_status,
      inputSchema: {},
      outputSchema: AGENT_STATUS_OUTPUT,
      ...enableWidgetUi(WIDGET_AGENT_STATUS),
    },
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object", usage: "object", settings: "object" });
      const data = pickAgentStatus(s, loc.mcp); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
      const A = loc.mcp.agentStatus;
      return {
        content: [
          {
            type: "text",
            text:
              `${A.number}: ${data.number}\n${A.owner}: ${data.owner}\n` +
              `${A.calls}: ${data.calls}\n` +
              `${planUsageLine(data.planUsagePercent, A)}\n` +
              `${A.permissions}: ${data.permissions}`,
          },
        ],
        structuredContent: data,
      };
    },
  );
}
