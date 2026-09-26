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
import { UI_META_KEY } from "./ui/contract.js";
import { WIDGET_LOCALE_META_KEY } from "./ui/widget-i18n.js";
import { WIDGET_AGENT_STATUS } from "./ui/adapters/mcp-native.js";
// Neue Widgets aus der kanonischen Quelle (widget-catalog.js); der mcp-native-Re-Export
// oben ist historisch (siehe Datei-Kommentar dort).
import {
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
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
import { MCP_ERROR_CODE, MCP_TEXTS } from "./i18n/mcp-texts.js";
// T2-15 (O-14): reine Erkennung/Maskierung von Restricted Data (Zahlungskarte,
// beschriftete behoerdliche Kennnummer, Zugangsdaten) an der MCP-Grenze - EINE Quelle
// fuer Eingabepruefung UND Ausgabe-Maskierung (Umfang und Grenzen s. dort).
import { RESTRICTED_CATEGORY, firstRestrictedField, maskRestrictedText } from "./restricted-data.js";
// P5b (O-13 Teil 2): dieselbe Zerlegeregel wie der Erzeuger (Modul-Kopf dort) -
// nicht kopiert, nicht nachgebaut. Wiederverwendung an genau der Naht, an der
// failure_reason den Server verlaesst (callOutcomeView unten).
import { failureReasonBase } from "./telephony/failure-reason.js";
import { CALL_PURPOSE_RULE } from "./mcp-server-info.js";
import { CONFIRMATION_ALREADY_USED_REASON } from "./call-confirmation.js";

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
// T2-09: reiner 400-Eingabefehler (Formfehler des Aufrufers, s. api() unten) - benannt statt
// nackter Zahl (G25).
const BAD_REQUEST_STATUS = 400;

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
    // T2-09 (O-13/O-20): kein roher REST-Fehlertext mehr in der message - sie wird nirgends
    // mehr ausgegeben (toolErrorText in wrapHandler baut den Client-Text ausschliesslich aus
    // reason/inputHint/httpStatus, s.u.). httpStatus bleibt unveraendert (AL-P13: answer_consult
    // muss "verworfen" 400 von "nicht mehr offen" 409 unterscheiden). reason ist additiv aus
    // dem REST-Body (api-calls.js#denialResponseBody) - der maschinenlesbare Gate-Grund.
    // inputHint traegt NUR bei einem reinen 400-Eingabefehler (kein reason, also kein
    // Gate-Grund) den Bestandstext weiter: das ist ein Korrekturhinweis zur eigenen Eingabe
    // des Aufrufers (z.B. Laengengrenze von objective), das Modell braucht ihn, um die
    // Eingabe zu korrigieren (Entscheidung 3 der T2-09-Spec) - er traegt keine interne
    // Kennung, keinen Env-Namen, keinen Tarif-Hinweis.
    const err = new Error("upstream_status");
    err.httpStatus = res.status;
    if (typeof json.reason === "string") err.reason = json.reason;
    else if (res.status === BAD_REQUEST_STATUS && typeof json.error === "string")
      err.inputHint = json.error;
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
// Literal in dieser Datei. Fabrik statt drittem Argument an pickCall & Co.:
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
// Deref (`s.calls.length`, `r.callId`) crasht darauf mit TypeError. Geprueft wird
// Existenz/Typ, NICHT Nicht-Leere (leere Liste `[]` bleibt valide). Wirft eine
// generische, provider-freie Tool-Fehlermeldung (kein roher Gateway-Body, Regel 5).
// Tool-Fehler mit stabiler, sprachneutraler Kennung (P12): der Wurf legt NUR den Code
// fest, die Uebersetzung passiert an EINER Kante (wrapHandler). Vorher war der deutsche
// Klartext selbst das Format zwischen Wurf und Kante - jede Sprachverzweigung haette
// ihn an beiden Enden duplizieren muessen (G5).
// T2-15 (O-14): field ist OPTIONAL und traegt NIE einen Wert - nur einen Schluesselpfad
// (z.B. "objective", "context.key_facts"), fuer den wertfreien Restricted-Data-Text
// (knownToolErrorCodeText unten). Bestehende Aufrufer ohne field bleiben unveraendert
// (field bleibt undefined, wie vor dieser Erweiterung).
class ToolError extends Error {
  constructor(code, field) {
    super(code);
    this.code = code;
    this.field = field;
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
// vorbehalten: Datensatz und Log tragen es weiterhin unveraendert. Der Ausfall-Eimer
// (outage-detection.js#outageBucket) schneidet davon zusaetzlich den Carrier-Code ab -
// der verbleibende SIP-Code wird gebraucht, um zwei verschiedene not-placed-Ausfallarten
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
// Zeilen der Gegenseite (Rohtext, den der Angerufene gesagt hat) unveraendert durch.
// T2-15 (O-14): seit hier laeuft jede Zeile zusaetzlich durch maskRestrictedText -
// Zahlungskartennummern, beschriftete behoerdliche Kennnummern und Zugangsdaten werden
// maskiert (Grenzen der Erkennung s. restricted-data.js). Alles UEBRIGE (Namen, Adressen,
// sonstige woertliche Aeusserungen) bleibt unveraendert durch - bewusst offener Befund,
// noch nicht behoben (ausserhalb des O-14-Scopes dieser Phase).
function pickCallStatus(callId, c, texts) {
  return {
    call_id: callId,
    ...callOutcomeView(c),
    duration_s: durationS(c),
    last_transcript_lines: c.transcript
      .slice(-LAST_TRANSCRIPT_LINES)
      .map((t) => maskRestrictedText(`${t.role === "agent" ? texts.roleAgent : texts.roleCounterparty}: ${t.text}`)),
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

// Daten-Kontrakt get_call_result (Strategie Abschnitt 5.1, DSGVO): GENAU diese Felder
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
    result_summary: maskRestrictedText(c.summary || failureSummary || AWAIT_SUMMARY_PLACEHOLDER),
    objective_achieved: c.objectiveAchieved ?? "unclear",
    ...maskedResultCard(c.result),
  };
}

// T2-15 (O-14): resultCardView() + Maskierung an EINER Stelle. pickTranscript UND
// awaitEventView spreaden AUSSCHLIESSLICH ueber diese Funktion (nie resultCardView()
// direkt) - sonst laeuft eine der beiden Sichten an der Maskierung vorbei (W3).
// maskResultCardFields nimmt die bereits GEVIEWTE Karte (snake_case) entgegen, damit
// inboxEntryForModel (die Karte kommt dort schon fertig geviewt aus state-ops.js) sie
// ohne zweiten resultCardView()-Aufruf wiederverwenden kann.
function maskResultCardFields(card) {
  return {
    outcome: maskRestrictedText(card.outcome),
    commitments: card.commitments.map(maskRestrictedText),
    counterparty_commitments: card.counterparty_commitments.map(maskRestrictedText),
    open_points: card.open_points.map(maskRestrictedText),
    next_step: maskRestrictedText(card.next_step),
  };
}

function maskedResultCard(result) {
  return maskResultCardFields(resultCardView(result));
}

// AL-P11: die fuenf Karten-Felder als eigenes Schema-Fragment - von CALL_RESULT_OUTPUT
// gespreadet (G5), damit Sicht (resultCardView) und Schema nie auseinanderlaufen.
const RESULT_CARD_OUTPUT = {
  outcome: z.string().nullable(),
  commitments: z.array(z.string()),
  counterparty_commitments: z.array(z.string()),
  open_points: z.array(z.string()),
  next_step: z.string().nullable(),
};

// outputSchema fuer get_call_result: validiert GENAU die Whitelist. objective_achieved
// ist true|false|"unclear" (Bool oder String), daher union.
const CALL_RESULT_OUTPUT = {
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
    // T2-15 (O-14): questions traegt die Rueckfrage des Sprachagenten - Freitext wie
    // last_transcript_lines, deshalb maskiert.
    questions: Array.isArray(event.questions) ? event.questions.map(maskRestrictedText) : [],
    ...outcome,
    result_summary: done?.result_summary ?? null,
    objective_achieved: done?.objective_achieved ?? null,
    ...maskedResultCard(finished?.result),
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

// T2-08 (T-27): Frist fuer JEDEN UEBRIGEN MCP->REST-Hop (alles ausser pollConsult und
// placeCallHop, die eigene, oben begruendete Fristen behalten) - u.a. cancel_call,
// answer_consult, check_inbox, get_call_status, list_calls, die GET /api/state-Leser und
// der Abschluss-GET in await_call_event. KEIN Env-Knopf (Praezedenz PLACE_CALL_HOP_TIMEOUT_MS
// oben, E3): ein Operator-Knopf ist der Weg, die Frist abzuschalten.
// Wert-Herleitung am Seam, nicht geraten: der laengste begrenzte Serverweg der uebrigen
// Hops ist cancel_call auf einen GEBUNDENEN EL-Inbound-Anruf (elevenlabs/outbound.js,
// awaitAndPersistInboundElResult/pollConversationResult) - er wartet hoechstens
//   EL_TERMINATION_RESULT_ATTEMPTS (3) x EL_ABORT_PROVIDER_TIMEOUT_MS (10000)
// + (EL_TERMINATION_RESULT_ATTEMPTS - 1) x config.voice.elevenLabsOutbound.resultPollMs
//   (Default 5000)
// = 3*10000 + 2*5000 = 40000 ms. Alle anderen Ziel-Routen sind synchron (POST
// /api/inbox/poll, POST /consult/answer, GET /api/state, GET /api/calls/:id) und warten
// nicht auf einen Anbieter-Poll. 60000 ms laesst dem Default-Fall reichlich Kopf; wer
// ELEVENLABS_RESULT_POLL_MS anhebt, muss hier nachrechnen -
// test/openai-t2-08-hop-frist.test.js faellt dann rot (Ungleichungs-Test).
export const MCP_HOP_TIMEOUT_MS = 60000;

// T2-08 (T-27): der Hop, ueber den registerTools' call() JEDEN uebrigen MCP->REST-Aufruf
// fuehrt - mit MCP_HOP_TIMEOUT_MS statt gar keiner Frist (Befund: nur pollConsult/
// placeCallHop hatten bisher eine). Ein Zeitablauf ist HIER - anders als beim Long-Poll -
// kein normales Ereignis: er wird zu einer stabilen Kennung (HOP_TIMEOUT), die wrapHandler
// in der Tenant-Sprache ausgibt (Muster CALL_START_UNCONFIRMED). NIE "fehlgeschlagen": die
// Aktion kann serverseitig trotzdem gelaufen sein. Modul-Ebene statt inline in
// registerTools (Muster withWidgetLocale): der gepinnte registerTools-Befund
// (eslint-legacy-exceptions.json) waechst dadurch nicht.
async function boundedHop(request) {
  try {
    return await api({ ...request, timeoutMs: MCP_HOP_TIMEOUT_MS });
  } catch (err) {
    if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.HOP_TIMEOUT);
    throw err;
  }
}

// T2-09 (O-13/O-20): HTTP-Statusklassen fuer toolErrorText, benannt statt Magic Numbers.
const NOT_FOUND_STATUS = 404;
const NOT_PERMITTED_STATUS = 403;
const CLIENT_ERROR_STATUS_MIN = 400;
const CLIENT_ERROR_STATUS_MAX = 499;
// Safety-Review-Nachbesserung (Befund mcp-tools.js:435): Serverfehler-Bereich fuer die
// placeCallHop-Klassifikation unten - benannt statt Magic Number, dieselbe Grenzen-Form
// wie CLIENT_ERROR_STATUS_MIN/MAX oben.
const SERVER_ERROR_STATUS_MIN = 500;
const SERVER_ERROR_STATUS_MAX = 599;
// T2-13 (N-10): der eine Status, den confirmCallHop unten gesondert abfaengt (Betriebs-
// geheimnis fehlt, src/routes/api-call-confirmations.js).
const HTTP_SERVICE_UNAVAILABLE_STATUS = 503;
const CONFIRMATION_UNAVAILABLE_REASON = "confirmation_unavailable";

// Safety-Review-Nachbesserung (Befund mcp-tools.js:435): ein Originate-/Provider-
// Fehlschlag (api-calls.js originate-catch, 500 ohne providerStatus ODER 502 MIT
// providerStatus) traegt KEIN err.reason (das ist ausschliesslich den Gate-Ablehnungen
// vorbehalten, s. denialResponseBody in api-calls.js). NUR dieser Fall - 5xx ohne
// bekannten Gate-Grund - wird unten zu CALL_START_REJECTED umgemuenzt; ein 5xx MIT
// reason (z.B. gate_error, ani_not_owned) bleibt unangetastet und laeuft weiterhin ueber
// denialReasonText (Schritt 2 in toolErrorText), NICHT ueber diese Funktion.
function isServerErrorWithoutReason(err) {
  return (
    typeof err?.reason !== "string" &&
    typeof err?.httpStatus === "number" &&
    err.httpStatus >= SERVER_ERROR_STATUS_MIN &&
    err.httpStatus <= SERVER_ERROR_STATUS_MAX
  );
}

// E3: eigener, benannter Zugang fuer den EINEN Aufruf, der einen echten Anruf ausloest -
// dasselbe Muster wie pollConsult (kein viertes Positions-Argument an call(), keine zweite
// fetch-Implementierung). Modul-Ebene statt Closure in registerTools() (haelt deren
// Zeilenzahl klein - der Pin in eslint-legacy-exceptions.json haengt daran, wie bei
// PLACE_CALL_DESCRIPTION/CHECK_INBOX_DESCRIPTION oben begruendet). Der Zeitablauf wird HIER
// NICHT geschluckt (anders als beim Long-Poll pollConsult): er wird zu einer stabilen
// Kennung, die wrapHandler in der Tenant-Sprache ausgibt. Safety-Review-Nachbesserung
// (Befund mcp-tools.js:435): ein Originate-Fehlschlag OHNE Gate-Grund (5xx ohne err.reason,
// s. isServerErrorWithoutReason) fiele sonst auf UPSTREAM_UNREACHABLE ("try again later") -
// das laedt bei einer dauerhaften Provider-Ablehnung (falsche Absender-DID, Telnyx 403) zu
// einem zweiten Anruf an dieselbe Person ein. CALL_START_REJECTED verweist stattdessen auf
// list_calls, ohne den Anlass zu benennen (kein Provider-/Secret-Leak, der bleibt
// serverseitig in api-calls.js).
async function placeCallHop({ identity, scopedTenant, body }) {
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
    if (isServerErrorWithoutReason(err)) throw new ToolError(MCP_ERROR_CODE.CALL_START_REJECTED);
    throw err;
  }
}

// T2-13 (N-10): fehlt das Betriebsgeheimnis (CALL_CONFIRMATION_SECRET), antwortet die
// Route 503 reason=confirmation_unavailable - kein Gate-Ablehnungsgrund (denialReasonText
// kennt ihn nicht), deshalb hier explizit auf eine eigene ToolError-Kennung abgebildet
// (Muster isServerErrorWithoutReason oben), statt beim generischen DENIAL_UNKNOWN zu
// landen.
function isConfirmationUnavailable(err) {
  return err?.httpStatus === HTTP_SERVICE_UNAVAILABLE_STATUS && err?.reason === CONFIRMATION_UNAVAILABLE_REASON;
}

// T2-15 (O-14): Kategorie (restricted-data.js) -> stabile Fehler-Kennung (mcp-texts.js).
// EINE Abbildungsstelle fuer beide Aufrufer unten (confirmCallHop und der
// answer_consult-Handler, der rejectRestrictedData direkt inline aufruft - keine eigene
// benannte Hop-Funktion).
const RESTRICTED_CATEGORY_ERROR_CODE = Object.freeze({
  [RESTRICTED_CATEGORY.PAYMENT_CARD]: MCP_ERROR_CODE.RESTRICTED_PAYMENT_CARD,
  [RESTRICTED_CATEGORY.GOVERNMENT_ID]: MCP_ERROR_CODE.RESTRICTED_GOVERNMENT_ID,
  [RESTRICTED_CATEGORY.CREDENTIAL_SECRET]: MCP_ERROR_CODE.RESTRICTED_CREDENTIAL,
});

// prepare_call/place_call: `to` (Anrufziel, kann zufaellig Luhn-gueltig sein), der
// Bestaetigungscode selbst und `language` sind vom Scan ausgenommen - alles UEBRIGE
// (objective/briefing/context/...) wird geprueft, AUCH kuenftige Felder (fail-closed,
// s. firstRestrictedField).
const CALL_ARGS_EXEMPT_KEYS = Object.freeze(["to", "confirmation_code", "language"]);

// Wirft VOR jedem Hop, der einen Bestaetigungscode ausstellt/verbraucht oder eine
// Consult-Antwort weiterreicht (Pre-Mortem #1/#2: EINE Stelle fuer prepare_call UND
// place_call). Die Argumente werden NICHT veraendert (keine Maskierung der Eingabe -
// sonst zeigt die Karte etwas anderes, als woran der Bestaetigungscode gebunden wird).
function rejectRestrictedData(body, exemptKeys) {
  const hit = firstRestrictedField(body, exemptKeys);
  if (hit) throw new ToolError(RESTRICTED_CATEGORY_ERROR_CODE[hit.category], hit.field);
}

// T2-13 (N-10): geteilter Hop zu POST /api/call-confirmations - prepare_call (ohne Code)
// UND place_call (mit Code) rufen ihn mit demselben Body-Muster (EINE Quelle, kein
// zweiter Fetch-Aufbau). MCP_HOP_TIMEOUT_MS/HOP_TIMEOUT wie jeder uebrige Hop (die Route
// ist synchron, kein Long-Poll) - NUR die 503-Sonderlage bekommt eine eigene Kennung.
// T2-15 (O-14): die Restricted-Data-Pruefung ist die ERSTE Anweisung, VOR dem try - ein
// Treffer erreicht damit weder diesen Hop noch /api/calls (kein Code, kein Anruf-
// Datensatz, keine Reservierung).
async function confirmCallHop({ identity, scopedTenant, body }) {
  rejectRestrictedData(body, CALL_ARGS_EXEMPT_KEYS);
  try {
    return await api({
      method: "POST",
      path: "/api/call-confirmations",
      body,
      identity,
      scopedTenant,
      timeoutMs: MCP_HOP_TIMEOUT_MS,
    });
  } catch (err) {
    if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.HOP_TIMEOUT);
    if (isConfirmationUnavailable(err)) throw new ToolError(MCP_ERROR_CODE.CONFIRMATION_UNAVAILABLE);
    throw err;
  }
}

// Ein unbekannter Ablehnungsgrund darf den Server-Log weder sprengen noch mit Steuerzeichen
// fuellen (Log-Injection) - deshalb auf [a-z_] und diese Laenge bereinigt, BEVOR er geloggt wird.
const DENIAL_WARN_MAX_LEN = 40;

// Bereinigt einen unbekannten Ablehnungsgrund fuer den Server-Log (NIE fuer den Client-Text -
// der bekommt ausschliesslich texts.errors[DENIAL_UNKNOWN]).
function sanitizedDenialReason(reason) {
  return String(reason)
    .toLowerCase()
    .replace(/[^a-z_]/g, "")
    .slice(0, DENIAL_WARN_MAX_LEN);
}

// Schritt 1 (Vertrag s. toolErrorText unten): ein ToolError mit bekannter Kennung geht IMMER
// vor - diese Zustaende koennen "die Aktion lief serverseitig trotzdem" bedeuten.
// T2-15 (O-14): ein Tabellen-Eintrag kann statt eines festen Strings eine Funktion
// (field) => string sein (Muster consultAnswerAccepted in mcp-texts.js) - fuer die
// Restricted-Data-Texte, die den Feldpfad, aber NIE einen Wert nennen.
function knownToolErrorCodeText(err, texts) {
  const entry = err?.code ? texts.errors[err.code] : undefined;
  return typeof entry === "function" ? entry(err.field) : entry;
}

// Schritt 2: ein Gate-Ablehnungsgrund (err.reason, additiv aus dem REST-Body via api()).
// Bekannter Grund -> der neutrale Text aus texts.denials; unbekannter/kuenftiger Grund -> der
// Client bekommt DENIAL_UNKNOWN (NIE eine rohe Kennung), der Server-Log die bereinigte Kennung
// als Warnung (console.warn, NIE console.log - stdout ist im stdio-Transport das Protokoll).
function denialReasonText(err, texts) {
  if (typeof err?.reason !== "string") return undefined;
  const denialText = texts.denials[err.reason];
  if (denialText) return denialText;
  console.warn("[mcp] unbekannter Ablehnungsgrund:", sanitizedDenialReason(err.reason));
  return texts.errors[MCP_ERROR_CODE.DENIAL_UNKNOWN];
}

// Schritt 4: der HTTP-Status ohne bekannten Grund und ohne inputHint.
function httpStatusClassText(httpStatus, texts) {
  if (httpStatus === NOT_FOUND_STATUS) return texts.errors[MCP_ERROR_CODE.NOT_FOUND];
  if (httpStatus === NOT_PERMITTED_STATUS) return texts.errors[MCP_ERROR_CODE.NOT_PERMITTED];
  const isClientError =
    typeof httpStatus === "number" &&
    httpStatus >= CLIENT_ERROR_STATUS_MIN &&
    httpStatus <= CLIENT_ERROR_STATUS_MAX;
  return isClientError ? texts.errors[MCP_ERROR_CODE.REQUEST_REJECTED] : undefined;
}

// T2-09 (O-13/O-20, Pre-Mortem 2/3/5): EINE Abbildung Fehler -> Client-Text, modul-weit
// (Muster boundedHop), damit der gepinnte registerTools-Befund (eslint-legacy-exceptions.json)
// nicht waechst. Reihenfolge ist Vertrag (Schritte 1-2/4 in eigenen Funktionen oben, wegen der
// Komplexitaetsgrenze): 1. ToolError-Kennung, 2. Gate-Ablehnungsgrund, 3. err.inputHint (NUR
// ein reiner 400-Eingabefehler ohne reason, s. api()) - wird an das Client-Modell
// durchgereicht, das seine eigene Eingabe sonst nicht korrigieren koennte, 4. HTTP-Statusklasse,
// 5. alles andere (5xx, Netzfehler wie "fetch failed", ein TypeError aus einem Handler) ->
// UPSTREAM_UNREACHABLE; console.error mit err.name/err.message (secret-frei wie im Bestand)
// landet NUR serverseitig, nie beim Client.
function resolvedToolErrorText(err, texts) {
  const known = knownToolErrorCodeText(err, texts);
  if (known) return known;
  const denial = denialReasonText(err, texts);
  if (denial) return denial;
  if (typeof err?.inputHint === "string") return err.inputHint;
  const statusText = httpStatusClassText(err?.httpStatus, texts);
  if (statusText) return statusText;
  console.error("[mcp] Tool-Fehler ohne bekannte Kennung:", err?.name, err?.message);
  return texts.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE];
}

// T2-09-Nachbesserung (Safety-Review, Befund mcp-tools.js:1095): der Client-Text haengt seit
// T2-09 an der aufgeloesten Sprache (loc.mcp), nicht mehr am immer nicht-leeren err.message.
// Letzte Rueckfallebene, falls dieses Buendel einen Text nicht traegt (fehlende Uebersetzung,
// fehlendes errors-/denials-Objekt): der neutrale EN-Text aus DERSELBEN Quelle (G5) - nie
// undefined, nie leer, nie ein interner Bezeichner. EN, weil er ohne Sprachbezug fuer die
// meisten Nutzer lesbar ist; der Regelfall bleibt die Tenant-Sprache.
const LAST_RESORT_ERROR_TEXT = MCP_TEXTS.en.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE];

function withTextTables(texts) {
  return { errors: texts?.errors ?? {}, denials: texts?.denials ?? {} };
}

function isNonEmptyText(text) {
  return typeof text === "string" && text.trim() !== "";
}

// Fail-safe Huelle um resolvedToolErrorText: fehlende Tabellen werfen nicht (sonst entkaeme
// ein TypeError aus dem catch in wrapHandler), ein fehlender/leerer Text faellt auf
// LAST_RESORT_ERROR_TEXT. Exportiert fuer den Test genau dieses Rueckfalls.
export function toolErrorText(err, texts) {
  const text = resolvedToolErrorText(err, withTextTables(texts));
  return isNonEmptyText(text) ? text : LAST_RESORT_ERROR_TEXT;
}

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
// aus dem get_call_result-Kontrakt (result_summary/objective_achieved), hier initial NULL
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

// T2-13 (N-10): outputSchema von prepare_call - spiegelt genau die gebundenen Felder aus
// src/routes/api-call-confirmations.js#buildPreview (status/to/objective immer gesetzt,
// der Rest nur wenn im Aufruf mitgegeben). mandate/context bleiben lose typisiert
// (z.record) statt einer zweiten Kopie ihrer verschachtelten Form aus
// PLACE_CALL_REQUEST_SCHEMA - die Vorschau ist ein reiner Spiegel, keine zweite
// Validierungsflaeche.
const PREPARE_CALL_OUTPUT = {
  status: z.string(),
  to: z.string(),
  objective: z.string(),
  language: z.string().optional(),
  max_duration_s: z.number().optional(),
  briefing: z.string().optional(),
  constraints: z.string().optional(),
  mandate: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  diagnostic: z.boolean().optional(),
};

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

// Daten-Kontrakt get_agent_number: GENAU das eine Eigen-Feld number. Whitelist, keine
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
  if (c.summary) entry.summary = maskRestrictedText(c.summary); // T2-15 (O-14)
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
// die fuenf Karten-Felder kommen aus demselben RESULT_CARD_OUTPUT wie get_call_result
// und await_call_event (G5/S2, ein Spread statt einer Redefinition).
// at (statt started_at) ist der EINZIGE Unterschied zur REST-Sicht: server-seitig in
// der Tenant-Sprache formatiert, derselbe Formatter wie list_calls.
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
// T2-15 (O-14): summary/Ergebniskarte/action_items maskiert - rest traegt die
// GEVIEWTE Karte (state-ops.inboxEntryView spreadet bereits resultCardView), deshalb
// maskResultCardFields statt maskedResultCard (kein zweiter resultCardView()-Aufruf).
function inboxEntryForModel(entry, formatDate) {
  const { started_at: startedAt, ...rest } = entry;
  return {
    ...rest,
    ...maskResultCardFields(rest),
    at: startedAt ? formatDate(startedAt) : null,
    summary: maskRestrictedText(rest.summary),
    action_items: rest.action_items.map(maskRestrictedText),
  };
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

// T2-15 (O-14, LECK-STELLE 2): list_action_items baute seinen Text bisher INLINE in
// registerTools statt ueber eine View - Modul-Funktion (Muster inboxTextLine), die
// zugleich maskiert UND den gepinnten registerTools-Befund klein haelt.
function actionItemsText(items, texts) {
  return items
    .map(
      (item) =>
        `${item.type === "appointment" ? texts.appointmentPrefix : ""}${maskRestrictedText(item.text)}`,
    )
    .join("\n");
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

// AL-P13, der Eroeffnungs-Consult: das Feld war das einzige der fuenf Kontext-Felder, das
// dieses Schema NICHT deklarierte - und zod strippt undeklarierte Schluessel STILL. Ueber
// place_call erreichte es den Server also nie, obwohl HTTP-Validierung (routes/
// _validation.js, CONTEXT_FIELDS) und Auswertung (routes/api-calls.js, emitOpeningConsult)
// dafuer gebaut sind. Form und Deckel wie beim Geschwisterfeld key_facts (maxItems 10,
// routes/_validation.js OPEN_QUESTIONS_LIMITS).
//
// Auf Modulebene wie CALL_LIST_ENTRY daneben, NICHT inline wie die
// Geschwisterfelder: die Schema-Definition von place_call ist bereits so tief
// verschachtelt, dass jede weitere inline gekettete Feld-Definition die Demeter-Grenze
// (G36) reisst. Ein benannter Wert an dieser Stelle haelt die Kette flach.
const OPEN_QUESTIONS_FIELD = z
  .array(z.string())
  .optional()
  .describe(
    "A few (max. 10) short questions that are still open BEFORE the call and that only the principal can answer. They are asked while the phone is ringing, so the agent starts the conversation with the answers.",
  );

// T2-13 (N-10): confirmation_code ist jetzt PFLICHT (nur im Handler, s. Schema-Kommentar
// oben) - der erste Satz nennt die Sequenz, bevor er sagt, was der Anruf kostet.
// Beschreibung von place_call, sonst byte-identisch aus dem Tool-Deskriptor herausgeloest
// (AL-P13 haengt bei aktivem Consult-Kanal genau EINEN Satz an).
// KORRIGIERT (T2-13-Nachbesserung, Safety-Review): der letzte Satz sagte frueher nur
// "calling it again ... returns that same call", ohne zu nennen, dass jeder Aufruf (auch
// eine Wiederholung) sein eigenes frisches prepare_call braucht - ein Code wird nach
// Gebrauch sofort verbraucht (Einmal-Verbrauch, s. call-confirmation.js) und ist danach kein
// gueltiger Code mehr fuer irgendeinen Aufruf. Ein erneutes prepare_call mit denselben
// Argumenten liefert dabei einen neuen Code (Slot-Register in api-call-confirmations.js) -
// erst der erreicht ueberhaupt die Dedup-Pruefung in POST /api/calls. Keine neuen
// GROSSBUCHSTABEN-Woerter im Nachtrag (Test p15-mcp-tool-descriptions-en.test.js pinnt die
// Emphase von place_call auf genau ["REQUIRES","FIRST","NOT","NOT","NOT","ALWAYS"]).
// KORRIGIERT (Safety-Review T2-13, zweite Runde): der erste Satz sagte "pass the code the
// user confirmed" - ohne zu sagen, WOHER der Code kommt. Jetzt: der Nutzer bestaetigt in der
// Karte, die Karte sendet den Code; nie raten/erfinden (keine Selbstbestaetigung).
// KORRIGIERT (T2-14-Nachbesserung, Safety-Review): "die Karte sendet den Code" liess weiter
// offen, ob das MODELL den Code danach entgegennimmt - es tut es nie. Die Hermes-Karte ruft
// place_call fuer einen bestaetigten Anruf SELBST auf (ueber die Host-Tool-Bruecke, s.
// src/ui/widgets/call.html); der Code steckt dafuer nur in prepare_call's Ergebnis-`_meta`,
// das der Karte vorbehalten ist. Das Modell ruft dieses Werkzeug fuer einen bestaetigten
// Anruf deshalb nicht mehr selbst auf, sondern wartet auf die Chat-Nachricht der Karte mit
// der call_id (s. PREPARE_CALL_DESCRIPTION, MCP_BASE_INSTRUCTIONS). Emphase-Pin unveraendert
// (["REQUIRES","FIRST","NOT","NOT","NOT","ALWAYS"]).
// Zweckbindung (Kurzfassung): der letzte Satz ist eine NUTZUNGSREGEL an das Modell, keine
// Pruefung - der Server prueft den Zweck eines Anrufs nicht, der Satz darf deshalb kein
// Durchsetzungs-Verb tragen. Die volle, eng gefasste Regel (mit Positivliste, damit das
// Modell Termin-, Rueckfrage- und Reklamationsanrufe NICHT verweigert) ist CALL_PURPOSE_RULE
// (src/mcp-server-info.js) in PREPARE_CALL_DESCRIPTION und in MCP_BASE_INSTRUCTIONS; hier
// nur die Kurzfassung, weil
// der Zeichen-Deckel der place_call-Texte (test/gq-b1-briefing-openness.test.js) knapp
// ist. Klein geschrieben: der Emphase-Pin oben bleibt unveraendert.
const PLACE_CALL_DESCRIPTION =
  "REQUIRES a confirmation_code that only the Hermes card can supply - call prepare_call FIRST with the same arguments so the user can confirm there; once they do, the card places the call itself and reports the call_id back in a chat message, so you never call this tool for that call and never guess or invent its code. Without a code from the card the call is NOT placed. Starts a real phone call by the AI agent to a phone number, pursuing the given objective, and is NOT reversible once placed; billed per minute to the caller's account. Which destinations are allowed is decided by the server through its safety gates (permission profile/allowlist, denylist, country, limits). A live-updating card is NOT guaranteed on every host - ALWAYS track the call via the call_id from that chat message, using get_call_status until it reports a final status. Not for telemarketing, unsolicited advertising or political campaign calls.";

// T2-13 (N-10): Beschreibung von prepare_call - reine Vorschau, KEIN Anruf, KEINE Kosten.
// Nennt ausdruecklich, dass der Code nur auf einem Host mit Kartenfaehigkeit ankommt (s.
// Plan Abschnitt 5, "Weg ohne Karte" ist bewusst ausgeschlossen) - sonst versucht das
// Modell auf einem Host ohne UI wiederholt, einen Code zu "finden", der nie erscheint.
// KORRIGIERT (Safety-Review T2-13, zweite Runde): "reveals a confirmation code" und "unless
// the host forwards it to you" liessen offen, ob das Modell den Code selbst aus der Karte
// nehmen darf. Jetzt: die Karte sendet den Code nach der Nutzerbestaetigung, vorher kein
// place_call, nie raten/erfinden; ohne Karte ehrlich sagen, dass kein Anruf moeglich ist.
// Der Server erkennt KEINE Host-Faehigkeit - nur den Schalter MCP_UI_ENABLED.
// KORRIGIERT (T2-14-Nachbesserung, Safety-Review): "Do not call place_call before that code
// arrives" implizierte weiter, das Modell riefe place_call spaeter SELBST mit dem Code auf.
// Tatsaechlich ruft die Karte place_call fuer einen bestaetigten Anruf komplett selbst auf -
// das Modell ruft es fuer diesen Anruf nie, unabhaengig davon, ob/wann ein Code eintrifft.
// Emphase-Pin unveraendert (["WITHOUT","EVERY"]).
// Zweckbindung + sensible Bereiche: prepare_call ist seit der Karten-Bestaetigung der
// Einstieg des Modells in jeden Anruf, deshalb stehen die beiden letzten Saetze HIER.
// Beide sind NUTZUNGSREGELN an das Modell, keine Pruefung: der Server prueft weder den
// Zweck eines Anrufs noch den Bereich eines Mandats - kein Satz darf deshalb ein
// Durchsetzungs-Verb tragen (Test openai-t2-16-place-call-texte). Der Zwecksatz ist
// CALL_PURPOSE_RULE (wortgleich mit den Server-Instructions, Begruendung der engen Fassung
// dort). Der zweite Satz nennt BEIDE Mandats-Wege, ueber die der Agent etwas zusagen kann:
// decide_freely und den Ausgang 'accept_best' (der auf dem Budget-Weg auch ohne
// decide_freely zusagt, s. mandateSection in src/claude.js). Er beschraenkt nur ZUSAGEN zu
// Bedingungen, nicht die Terminwahl: eine Wohnungsbesichtigung oder ein
// Vorstellungsgespraech zu verschieben bleibt mit Zeitrahmen in decide_freely moeglich.
// Die Wiederholungs-Pflicht steht einmal (Satz mit EVERY) statt zweimal - das haelt den
// Deckel der Top-Beschreibung (GQ-B1-04b). Klein geschrieben - der Emphase-Pin bleibt.
const PREPARE_CALL_DESCRIPTION =
  `Prepares a phone call for confirmation WITHOUT placing it: no cost, no call, nothing irreversible. Takes the exact same arguments as place_call. When card confirmation is switched on for this server, the host can show a Hermes card where the user reviews and confirms the call; if they confirm, the card places the call itself with the confirmation code and reports the call_id back in a chat message - you never call place_call for that call, and never guess or invent its code. The confirmation covers every argument, briefing and context included. If this host does not show the Hermes card, or card confirmation is switched off for this server, no call can be placed from here - tell the user so honestly and do not ask them for a code they cannot see. Call prepare_call again EVERY time any argument changes or a confirmation expired, and let the user confirm again. ${CALL_PURPOSE_RULE} For contracts, loans, insurance, tenancy, employment or legal matters, let decide_freely cover appointment times only and do not set 'accept_best', so the agent agrees to no terms there.`;

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
  "so there is no need to call get_call_result separately. event=\"none\" simply means " +
  "nothing happened yet: call it again. This tool NEVER returns audio. Each call also " +
  "writes to the call record: it notes that you polled and marks a pending question as " +
  "delivered. Pass after_event_id so you do not receive the same question twice.";

// T2-11 (N-13): auf Modulebene wie die anderen *_DESCRIPTION-Konstanten - haelt
// registerTools() klein (Lint-Pin s. eslint-legacy-exceptions.json). Der Verneinungssatz
// ("This tool NEVER returns the raw transcript...") bleibt woertlich (er ist in
// docs/OPENAI-POLICY-ABGLEICH.md zitiert und per Test gepinnt); NEU nennt der erste Satz
// jedes der acht Antwortfelder beim Namen (N-13: die Antwort traegt acht Felder, die alte
// Beschreibung nannte nur zwei).
const CALL_RESULT_DESCRIPTION =
  "After the call has ended, returns call_id, result_summary, objective_achieved and the " +
  "result card: outcome, commitments, counterparty_commitments, open_points, next_step. " +
  "This tool NEVER returns the raw transcript - whether the server keeps it afterwards on " +
  "its own follows the diagnostic rule of place_call's diagnostic field and is independent " +
  "of this response. Call this once get_call_status reports a final status - completed, " +
  "failed or cancelled, not only completed - it carries the result summary for those too.";

// T2-11 (N-13): auf Modulebene wie CALL_RESULT_DESCRIPTION (Lint-Pin). Nennt jedes Feld
// des outputSchema (AGENT_STATUS_OUTPUT, s.o.) beim Namen mit Bedeutung. "so far" statt
// "this month" fuer calls: der Zaehler ist ein Lebenszeit-Zaehler (state-ops.js, keine
// Monats-Reset-Logik gefunden) - "this month" waere eine neue N-13-Unwahrheit.
const AGENT_STATUS_DESCRIPTION =
  "Returns the status of the phone agent with these fields: number (the agent's phone " +
  "number, or null), owner (the account owner's name, or null), calls (number of calls so " +
  "far), planUsagePercent (share of the monthly minute quota used, in percent, or null if " +
  "no quota is set), permissions (what the agent may share: summaries, personal data, bank " +
  "data).";

// T2-11 (N-11): auf Modulebene wie CALL_RESULT_DESCRIPTION/AGENT_STATUS_DESCRIPTION
// (Lint-Pin). GQ-B2 Fix-Runde 1 (Kommentar zieht mit): der Owner ist waehrend des
// Anrufs ABWESEND (Normalfall) - dieselbe Praemisse wie MCP_CONSULT_INSTRUCTIONS. Eine
// unbedingte "ask the user FIRST" waere an diesem naeheren Entscheidungspunkt die
// Anweisung, die den Zieldefekt (Schweigen bis zum Timeout) erst ausloest. Der letzte
// Satz nennt den Seiteneffekt jetzt vollstaendig (N-11): die Antwort landet nicht nur im
// Store, sondern kann am Telefon an den Angerufenen weitergegeben werden - "only" faellt,
// weil es dieser zutreffenden Aussage widerspraeche (destructiveHint/openWorldHint sind
// schon true). p15-Emphase-Pin ["FIRST","THEN","SHORT","REJECTED","NOT"] bleibt gueltig -
// kein neues Grossbuchstaben-Wort.
const ANSWER_CONSULT_DESCRIPTION =
  "Answers a question the phone agent asked during a running call. " +
  "FIRST, the moment you receive the question, call this tool once with " +
  'status="working" and no answers - that tells the agent someone is on it. ' +
  'THEN send the real answer with status="final" (the default). ' +
  "Give SHORT factual answers - one entry per question, each at most " +
  KEY_FACTS_LIMITS.maxLen +
  " characters; longer answers are REJECTED and the question stays open. Do NOT invent " +
  "facts: if you do not know, say so honestly here instead of guessing. Answers reach " +
  "the agent as background information. The agent may relay your answer to the person " +
  "on the call.";

// MCP-Annotations (Phase E2, P0-1, geschaerft P1/N-1/X-1/N-3/N-4): Nebenwirkungs-
// Kennzeichnung je Werkzeug, die ein Client OHNE Beschreibungs-Text lesen kann. Vier
// Festlegungen, die die naechste Sitzung sonst zurueckdreht:
// 1. OpenAI fuehrt readOnlyHint, destructiveHint und openWorldHint als Required (X-1/N-1);
//    die MCP-Spec fuehrt ALLE Annotation-Felder als optional (SDK `ToolAnnotationsSchema`,
//    jedes Feld `.optional()`). Bei Widerspruch gewinnt die OpenAI-Fassung - deshalb tragen
//    ALLE Werkzeuge alle drei Felder, auch die reinen Lese-Werkzeuge mit
//    destructiveHint: false. idempotentHint bleibt optional (N-1 nennt es ausdruecklich so)
//    und steht deshalb weiterhin nur dort, wo es etwas aussagt - an einem Nur-Lese-Werkzeug
//    waere es ein bedeutungsloser Wert.
// 2. openWorldHint folgt der Dreiteilung O1-O3 aus docs/OPENAI-TOOL-INVENTORY.md ("The
//    openWorldHint rule") - DIESE Datei ist die verbindliche Fassung, hier nicht
//    wiederholt (G5). Kurzfassung: O1 = das Werkzeug kontaktiert selbst eine externe
//    Partei (place_call, cancel_call - waehlt bzw. beendet eine echte Telefonverbindung).
//    O2 = was das Werkzeug schreibt, geht an einen externen Empfaenger weiter
//    (answer_consult: die Antwort landet zwar im eigenen Store, wird aber waehrend des
//    laufenden Anrufs an den Gespraechspartner ausgesprochen). O3 = alles andere, auch
//    wenn es inhaltlich um einen Anruf nach draussen geht (get_call_status,
//    get_call_result, await_call_event lesen/schreiben ausschliesslich den tenant-lokalen
//    Store, GET /api/calls/:id, routes/api-read.js:98) - der Hint richtet sich nach dem
//    ZUGRIFF des Werkzeugs, nicht nach dem Thema seiner Daten.
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
// CANCEL_CALL_DESCRIPTION) - dieselbe Auslagerung wie CALL_OUTPUT/MY_NUMBER_OUTPUT.
// Reihenfolge = Registrierreihenfolge (Vollstaendigkeit gegen die Datei
// abzaehlbar). await_call_event ist NICHT readOnly: seine Route schreibt zwei Felder
// (noteConsultPoll/markConsultAskDelivered, routes/api-calls.js + state-ops.js) - der
// Code widerspricht damit einer frueheren Einschaetzung, und der Code gewinnt.
const TOOL_ANNOTATIONS = {
  // T2-13 (N-10): reine Vorschau + Code-Ausstellung, KEIN Anruf und KEIN Aufruf nach
  // aussen (die Route schreibt nichts in den Store, ruft kein audit(), faehrt keine
  // Gate-Kette) - deshalb readOnlyHint:true/destructiveHint:false/openWorldHint:false,
  // anders als place_call direkt darunter. idempotentHint:true: ein wiederholter Aufruf
  // hat keine zusaetzliche Wirkung auf die Welt (kein Anruf, kein Datensatz, keine
  // Kosten). KORRIGIERT (Safety-Review T2-13): "dieselben Argumente liefern denselben
  // Code" stimmt seit dem Slot-Register nur noch BIS zum ersten Verbrauch - danach liefert
  // dieselbe Anfrage im selben Fenster einen NEUEN Code (api-call-confirmations.js).
  prepare_call: {
    title: "Preview a phone call",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
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
  get_call_result: {
    title: "Get call result",
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
  get_agent_number: {
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
  prepare_call: { invoking: "Preparing the call for confirmation", invoked: "Call preview ready" },
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
  get_call_result: { invoking: "Reading the call result", invoked: "Call result read" },
  // invoked bewusst "Cancellation requested", nicht "Call cancelled": der REST-Pfad
  // sichert seit S1-4 keinen bestaetigten Leitungsabbruch zu (dieselbe Wahrheit wie
  // CANCEL_CALL_DESCRIPTION). Eine Statuszeile darf nicht mehr behaupten als die
  // Beschreibung.
  cancel_call: { invoking: "Cancelling the call", invoked: "Cancellation requested" },
  get_agent_number: { invoking: "Looking up the agent number", invoked: "Agent number read" },
  list_calls: { invoking: "Listing recent calls", invoked: "Recent calls listed" },
  check_inbox: { invoking: "Checking the call inbox", invoked: "Inbox checked" },
  list_action_items: {
    invoking: "Listing open action items",
    invoked: "Action items listed",
  },
  get_agent_status: { invoking: "Checking the agent status", invoked: "Agent status read" },
};

// T-18/T-22 (P2, DP-7): hebt title auf Top-Level und haengt die Statuszeilen an _meta an -
// fuer JEDES Werkzeug, ausserhalb der elf Config-Literale. Grund: vier der Literale
// spreaden ...enableWidgetUi() als LETZTES Feld; ein vorher im Literal gesetztes _meta
// wuerde von diesem Spread still und vollstaendig ueberschrieben (Objekt-Literal-Semantik,
// kein Deep-Merge). Deshalb erst HIER, nachdem das Literal fertig gebaut ist.
// title kommt NUR aus config.annotations?.title (W-09: title > annotations.title > name)
// - keine zweite, namensindizierte Tabelle. Damit gibt es strukturell EINE Titel-Quelle,
// title und annotations.title koennen nicht auseinanderlaufen.
// _meta entsteht als { ...statusMeta, ...config._meta }: der Widget-Anteil steht HINTEN
// und gewinnt bei (heute unmoeglicher) Kollision - die Namensraeume sind disjunkt
// (ui.resourceUri vs. openai/toolInvocation/*).
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

// ctx (Phase 2): { identity, scopedTenant }. identity wird per Closure
// an jeden REST-Aufruf gehaengt (X-Internal-Identity); scopedTenant (AM6) ebenso als
// X-Internal-Tenant (am /mcp-Gateway aufgeloest). stdio ruft registerTools(server)
// ohne ctx -> identity/scopedTenant null (Owner).
// language (P12): die BEREITS aufgeloeste Tenant-Sprache. Aufgeloest wird sie am
// Transport (routes/mcp.js) mit derselben Funktion wie im Anrufpfad (views.tenantLanguage
// -> resolveCallLanguage) - hier gibt es KEINE zweite Aufloesungsregel. Fehlt sie
// (stdio-Transport, der keinen Store hat), faellt localeFor() fail-safe auf den
// Weltdefault zurueck (R7) - derselbe eine Fallback wie ueberall sonst.
// consultAllowed (AL-P13) defaultet auf FALSE: der stdio-Transport hat kein
// Client-Modell, das pollt, und ein Default-an wuerde die byte-gepinnte
// Beschreibungs-Inventur ohne Not verschieben.
// uiHost.chatgptEgress (T2-01 Nachbau): true NUR, wenn routes/mcp.js die Anfrage ueber
// die veroeffentlichten ChatGPT-Egress-IP-Bereiche als ChatGPT erkannt hat (chatgpt-
// egress.js) - steuert AUSSCHLIESSLICH, ob die Widget-Resource zusaetzlich zum Alias
// openai/widgetDomain auch `_meta.ui.domain` traegt (contract.js uiResourceMeta). Reist
// AM uiHost mit statt als eigenes registerTools-Argument (uiHost und chatgptEgress
// beschreiben denselben Host-Kontext, ein weiteres Positionsargument waere Willkuer,
// G32) - aufgeloest in widgetResourceOptions() unten. stdio (mcp-server.js) liefert
// uiHost ohne dieses Feld -> uiHost?.chatgptEgress ist undefined -> setzt `ui.domain`
// NIE (Owner-Vorgabe).
//
// Baut die Rendering-Optionen fuer EINE Widget-Resource (T2-01 Nachbau). Eigene,
// modulweite Funktion statt Inline-Objekt in enableWidgetUi - dieselbe EINE Baustelle
// fuer alle Widget-Tools (G5) und AUSSERHALB von registerTools, damit das
// chatgptEgress-Feld dessen Zeilenzahl nicht anhebt (G30, registerTools liegt an der
// gepinnten Altlast-Grenze, s. eslint-legacy-exceptions.json).
// T2-02/T-34: KEIN language-Feld mehr - die Resource ist seit dieser Phase EINE
// sprachneutrale Fassung (s. contract.js registerResource); die Agentensprache
// reist stattdessen ueber withWidgetLocale am Ergebnis der Widget-Werkzeuge (s.u.).
function widgetResourceOptions(uiHost) {
  return { chatgptEgress: uiHost?.chatgptEgress === true };
}

// S6 (T2-02/T-34): traegt die servergerenderte Widget-Sprache am ERGEBNIS der
// Widget-Werkzeuge (NICHT in structuredContent, s. T2-02-Spec Kernentscheidung 4) -
// nur Werkzeuge mit einer Widget-Resource am faehigen Host (config._meta.ui.
// resourceUri gesetzt) bekommen den Schluessel; jedes andere Werkzeug bleibt
// unveraendert. Grund fuer `_meta` statt `structuredContent`: `_meta` ist laut
// OpenAI nur fuer die Komponente bestimmt (das Modell liest es nicht), und MCP
// Apps reicht das CallToolResult per `ui/notifications/tool-result` als `params`
// durch - `params._meta` traegt den Wert also unveraendert weiter. Das Widget
// liest ihn NUR ueber diese Bruecke (widget-i18n.js), NIE ueber die globale
// OpenAI-Bruecke (UI-03). Fehlerergebnisse bleiben unveraendert - der Host
// zeigt dann ohnehin kein Widget (s. Aufrufer uiTool, VOR wrapHandler eingehaengt).
function withWidgetLocale(config, handler, language) {
  const resourceUri = config._meta?.[UI_META_KEY]?.resourceUri;
  if (!resourceUri) return handler;
  return async (...args) => {
    const result = await handler(...args);
    if (result?.isError) return result;
    return { ...result, _meta: { ...result?._meta, [WIDGET_LOCALE_META_KEY]: language } };
  };
}

// T2-13 (N-10): die zwei _meta-Schluessel, unter denen prepare_call den Bestaetigungs-Code
// und seinen Ablauf an die Hermes-Karte reicht - benannt statt Literal an zwei Stellen
// (Ausstellung im Handler, Kriteriums-Test am Draht). Namensraum "hermes/..." wie die
// bestehenden Widget-Metas (ui.*), aber ausserhalb des ui.-Namensraums: der Wert ist KEIN
// Rendering-Detail, sondern das Geheimnis selbst. T2-14: dupliziert in call.html (dort), eine Aenderung NUR hier deaktiviert den Bestaetigen-Knopf lautlos.
const CONFIRMATION_CODE_META_KEY = "hermes/confirmation_code";
const CONFIRMATION_EXPIRES_META_KEY = "hermes/confirmation_expires_at";
// T2-14-Nachbesserung: Maschinenfeld im place_call-Fehlerergebnis fuer einen schon
// verbrauchten Code (Route-Grund CONFIRMATION_ALREADY_USED_REASON). Die Karte (call.html,
// dort dupliziert) erkennt daran sprachunabhaengig, dass ihr Anruf schon abgeschickt wurde,
// und bietet keinen zweiten Klick an. Traegt weder Code noch Register-Interna.
const CONFIRMATION_USED_STATUS = "confirmation_used";

function confirmationUsedResult(loc) {
  return { ...errText(loc.mcp.confirmationAlreadyUsed), structuredContent: { status: CONFIRMATION_USED_STATUS } };
}

// Ergebnis fuer ein nicht bestaetigtes place_call: schon verbrauchter Code -> eigenes Ergebnis
// (confirmationUsedResult), sonst der generische Hinweis confirmationRequired.
function unconfirmedResult(loc, confirmResult) {
  if (confirmResult.reason === CONFIRMATION_ALREADY_USED_REASON) return confirmationUsedResult(loc);
  return errText(loc.mcp.confirmationRequired(confirmResult.preview.to, confirmResult.preview.objective));
}

// T2-13 (N-10, Schritt 6): woertlich verschoben aus dem place_call-inputSchema-Literal -
// prepare_call und place_call teilen sich JETZT dieses eine Schema (confirmation_code
// kommt nur bei place_call dazu, s.u.). Modul-Konstante statt Closure: haelt registerTools
// klein (der gepinnte Zeilen-Pin in eslint-legacy-exceptions.json haengt daran).
export const PLACE_CALL_REQUEST_SCHEMA = {
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
  // Minimierung + Neutralitaet (OpenAI "fair play" und "no broad contextual fields"): der
  // Text fordert nur noch den Kontext DIESES Anrufs an, nicht "den Chat bisher", nennt
  // keine fremden Werkzeugklassen mehr (vorher "calendar, mail, files, chat") und keinen
  // Markennamen eines Chat-Modells (vorher "not as Claude/Gemini" - jetzt "not as you").
  // Gesundheitsangaben sind fuer Arzttermine noetig und deshalb nicht verboten, sondern auf
  // das Noetige begrenzt (Restricted-Data-Pruefung lehnt sie bewusst nicht ab).
  briefing: z
    .string()
    .optional()
    .describe(
      "Only the context this call needs: what it is about, the names involved, relevant preferences and history, the desired outcome and tone. SUMMARISE instead of copying in raw. NO secrets, passwords or payment data. Health details only as needed. Write only what you KNOW: never script an answer for a detail you are missing. For each gap, decide: could you answer it yourself during the call from your own tools and context? Then leave the gap open and declare that in one line. Can only the principal know it? Then write the honest line that they will get back on it. Can anyone look it up? Then write nothing. The agent speaks as the principal's personal AI assistant, not as you; phrase the context from their perspective.",
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
      // Ehrlicher Zusatz (letzter Satz): der Sprach-Agenten-Weg hat fuer diese Enum-Achse
      // keinen Platz (src/elevenlabs/outbound.js, mandateText) - nur der Budget-Weg wendet
      // sie an (src/claude.js, mandateSection). Die Beschreibung darf kein Verhalten
      // versprechen, das nicht jeder Anrufweg liefert; das Verhalten selbst bleibt
      // unveraendert. Klein geschrieben: der Emphase-Pin ["OUTSIDE","ONLY"] bleibt.
      on_out_of_scope: z
        .enum(MANDATE_OUT_OF_SCOPE_VALUES)
        .optional()
        .describe(
          "What the agent does when an offer lies OUTSIDE decide_freely: 'take_message' (default) - record the offer with all details, pass it on and promise that the user will get back; 'decline' - politely refuse, without a counter-offer; 'accept_best' - accept and record the best offer made anyway. Set 'accept_best' ONLY when the user explicitly says that any option suits them. Not applied on every call path.",
        ),
    })
    .optional()
    .describe(
      "Optional advance MANDATE: the frame within which the agent may decide ITSELF in the conversation, instead of returning every question as a message. Through this the agent books NOTHING and gets NO calendar access - it only commits verbally to what the user allowed in advance. Ask the user about their frame when an appointment or price question is to be expected in the call; without a mandate the agent can only answer 'When suits you?' with 'I will pass that on'. In a conflict with constraints, constraints ALWAYS win.",
    ),
  // Minimierung: context ist kein zweiter Sammeltrichter mehr ("ADDITIONAL to the briefing"
  // lud dazu ein, neben dem Briefing noch mehr abzulegen) - ein Unterfeld nur, wenn der
  // Anruf es braucht, ohne das Briefing zu wiederholen. Kein Markenname eines Chat-Modells
  // ("NEVER as you" statt "NEVER as Claude/Gemini"). Gesundheitsangaben begrenzt, nicht
  // verboten (Arzttermine). Jedes Unterfeld nennt seinen engen Zweck - wofuer der Agent es
  // im Gespraech braucht (Hintergrund-Zeile im Prompt, src/claude.js assistantContextSection
  // bzw. src/elevenlabs/outbound.js backgroundText) - statt einer offenen Sammelkategorie;
  // die Notwendigkeit je Feld begruendet docs/OPENAI-TOOL-INVENTORY.md. Die Texte sind so
  // kurz gehalten, dass die Summe unter dem Deckel von GQ-B1-04 bleibt.
  context: z
    .object({
      summary: z
        .string()
        .optional()
        .describe(
          "Only so the agent can state why it calls: 1-3 sentences, not a copy of the chat.",
        ),
      key_facts: z
        .array(z.string())
        .optional()
        .describe(
          "Only facts the agent must state correctly, e.g. names, dates; max. 10 short items. NO secrets/passwords/payment data.",
        ),
      recipient_relationship: z
        .string()
        .optional()
        .describe("Only if it sets the tone: how the principal knows the called party, e.g. 'regular hairdresser'."),
      desired_outcome: z
        .string()
        .optional()
        .describe("Only so the agent knows when it is done: the result the principal wants, briefly."),
      open_questions: OPEN_QUESTIONS_FIELD,
    })
    .optional()
    .describe(
      "Optional structured BACKGROUND for the agent: fill a subfield only when this call needs it, without repeating the briefing. The agent speaks as the principal's personal AI assistant, NEVER as you. NO secrets; health details only as needed.",
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
};

export function registerTools(
  server,
  {
    identity = null,
    scopedTenant = null,
    consultAllowed = false,
    uiHost = null,
    language = null,
  } = {},
) {
  // T2-08 (T-27): JEDER Hop ueber call() hat eine Frist - s. boundedHop (Modul-Ebene).
  const call = (method, path, body) => boundedHop({ method, path, body, identity, scopedTenant });
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
  // E3/Safety-Review-Nachbesserung: placeCallHop lebt auf Modul-Ebene (s.o., haelt
  // registerTools() klein - der Zeilen-Pin in eslint-legacy-exceptions.json haengt daran).
  // Dieser Ein-Zeiler bindet nur identity/scopedTenant aus dem registerTools-Aufruf ein.
  const placeCallHopCall = (body) => placeCallHop({ identity, scopedTenant, body });
  const loc = localeFor(language); // Namensgleich zu claude.js promptInputs
  const formatDate = makeDateFormatter(loc.dateLocale);
  const uiRenderer = uiRendererFor(uiHost); // null = Stufe-0-only (fail-closed)

  // Stufe 1 fuer EIN Widget aktivieren - geteilt von ALLEN UI-Tools (G5/S2, keine
  // Duplizierung der Anhang-Logik). Registriert die statische ui://-Resource am Server
  // UND liefert das _meta-Fragment fuer den Tool-Deskriptor - aber NUR wenn der
  // Renderer das Widget kennt und der Host faehig ist. Sonst {} (kein _meta, keine
  // Resource = fail-closed Stufe-0-only, AC3). Der Name nennt den Seiteneffekt
  // (Registrierung, N7). NICHT idempotent (T2-13-Korrektur, s.u. bei callWidgetUi): ein
  // zweiter Aufruf mit DERSELBEN widgetId wirft beim SDK ("Resource ... is already
  // registered"). Deshalb je Widget-ID genau EIN Aufruf je registerTools()-Durchlauf -
  // "stateless: frischer Server je Request" gilt fuer den PROZESS (stdio/HTTP-Request),
  // schuetzt aber nicht vor einem zweiten Aufruf INNERHALB desselben Durchlaufs.
  const enableWidgetUi = (widgetId) => {
    if (!uiRenderer || !uiRenderer.hasWidget(widgetId)) return {};
    // T2-02/T-34: die Resource selbst traegt keine Sprache mehr (s.
    // widgetResourceOptions) - die Agentensprache reist stattdessen ueber
    // withWidgetLocale am Ergebnis des Werkzeugs (s.u., uiTool).
    uiRenderer.registerResource(server, widgetId, widgetResourceOptions(uiHost));
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
        // T2-09 (O-13/O-20): err.message traegt seit api() nichts Nutzerlesbares mehr (kein
        // roher REST-Fehlertext, kein "HTTP 500", kein "fetch failed") - der Client-Text
        // entsteht ausschliesslich ueber toolErrorText (P12 ToolError-Kennung, Gate-Grund,
        // 400-Eingabehinweis oder HTTP-Statusklasse, in dieser Reihenfolge, s. dort). Die
        // Uebersetzung passiert damit weiterhin an EINER Kante.
        return errText(toolErrorText(err, loc.mcp));
      }
    };

  // Einziger Registrierweg: ueber registerTool(config) -> erlaubt outputSchema (Stufe 0
  // schema-validiert) und _meta.ui.resourceUri (Stufe 1). config ohne outputSchema/_meta
  // im Literal -> Stufe-0-only. withOpenAiToolMetadata() hebt title auf Top-Level und
  // haengt die T-22-Statuszeilen an (P2, s. Kommentar dort) - NACHDEM das Literal fertig
  // gebaut ist, damit ein spaeter gespreadetes Widget-_meta nichts ueberschreibt.
  // withWidgetLocale (T2-02/S6) haengt VOR wrapHandler ein - sie liest config._meta
  // (das rohe Literal, nicht das von withOpenAiToolMetadata angereicherte) und traegt
  // die Sprache nur bei Nicht-Fehler-Ergebnissen an; wrapHandler faengt weiterhin
  // JEDEN Throw, unveraendert.
  const uiTool = (name, config, handler) =>
    server.registerTool(
      name,
      withOpenAiToolMetadata(name, config),
      wrapHandler(withWidgetLocale(config, handler, loc.language)),
    );

  // T2-13 (N-10): EINMAL berechnet, an prepare_call UND place_call gespreadet.
  // enableWidgetUi(WIDGET_CALL) ist NICHT idempotent - ein zweiter Aufruf wirft beim
  // SDK ("Resource ... is already registered", node_modules/@modelcontextprotocol/sdk/
  // dist/esm/server/mcp.js:456/476), der Kommentar "idempotent pro Server-Instanz" weiter
  // unten an der alten Stelle war irrefuehrend (s. Korrektur dort).
  const callWidgetUi = enableWidgetUi(WIDGET_CALL);

  // prepare_call: reine Vorschau + Code-Ausstellung VOR place_call (T2-13, N-10). readOnly
  // (kein Anruf, kein Store-Schreiben, kein audit() - s. src/routes/api-call-confirmations.js).
  // Teilt sich PLACE_CALL_REQUEST_SCHEMA UND callWidgetUi mit place_call (EINE Quelle,
  // s.o.), damit Vorschau und Aufruf niemals aus unterschiedlichen Schemas/Widgets
  // auseinanderlaufen koennen.
  uiTool(
    "prepare_call",
    {
      description: PREPARE_CALL_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.prepare_call,
      inputSchema: PLACE_CALL_REQUEST_SCHEMA,
      outputSchema: PREPARE_CALL_OUTPUT,
      ...callWidgetUi,
    },
    async (args) => {
      const previewResult = await confirmCallHop({ identity, scopedTenant, body: args });
      requireFields(previewResult, { preview: "object" });
      // KORREKTUR (Safety-Review T2-13): mcpUiEnabled prueft NUR den globalen Master-Schalter
      // MCP_UI_ENABLED (callWidgetUi._meta ist bei aktivem Schalter fuer JEDEN Host
      // gesetzt, s. enableWidgetUi/uiRendererFor - es gibt keine Pruefung, ob der
      // konkret verbundene Host _meta tatsaechlich vor dem Modell verbirgt). Bei
      // aktivem Schalter erreicht der Code also JEDEN Host in _meta - ob daraus ein
      // menschlicher Schritt wird, haengt allein davon ab, ob dieser Host den
      // MCP-Apps-Vertrag einhaelt und _meta nicht an das Modell weiterreicht (Zitat
      // Primaerquelle: "Treat `_meta` as hidden from the model, not as a substitute
      // for authorization"). Ein Host, der dagegen verstoesst, liest den Code selbst;
      // Rueckfall in dem Fall: PLAN-SECURITY.md Abschnitt OpenAI-T2-13. Bei
      // MCP_UI_ENABLED=false bleibt previewResult.confirmation ungenutzt: kein Client
      // bekommt je einen Code, place_call ist dann fuer niemanden moeglich.
      // Name = was geprueft wird (der Schalter), NICHT "Host hat Karte" - das weiss der
      // Server nicht; prepareCallCardHint sagt dem Modell deshalb auch, was ohne Karte gilt.
      const mcpUiEnabled = Boolean(callWidgetUi._meta);
      const meta =
        mcpUiEnabled && previewResult.confirmation
          ? {
              [CONFIRMATION_CODE_META_KEY]: previewResult.confirmation.code,
              [CONFIRMATION_EXPIRES_META_KEY]: previewResult.confirmation.expires_at,
            }
          : undefined;
      return {
        content: [
          { type: "text", text: mcpUiEnabled ? loc.mcp.prepareCallCardHint : loc.mcp.prepareCallNoCardHint },
        ],
        structuredContent: previewResult.preview,
        ...(meta ? { _meta: meta } : {}),
      };
    },
  );

  // place_call: EINZIGE Karte fuer den gesamten Anruf-Lebenszyklus (W2, Spam-Wurzel
  // beseitigt). uiTool statt tool(): initiales structuredContent (dialing, alle Felder
  // auf Start-Werte) + Widget-Anhang (WIDGET_CALL) NUR bei faehigem Host - das Widget
  // pollt sich selbst (get_call_status/get_call_result ueber die Host-Bruecke), das
  // Modell NICHT mehr (kein Karten-Spam). Safety-Gates (Permit/OUTBOUND_FROZEN/Denylist/
  // Land/Stundenlimit/Kostendecke/Max-Dauer/Signaturpruefung) sitzen UNVERAENDERT in
  // routes/api-calls.js + telephony/outbound-gates.js (NICHT src/server.js - der
  // Kommentar hier nannte bis T2-13 faelschlich server.js und eine tote Allowlist).
  // T2-13 (N-10): ZUSAETZLICH vor jedem Hop die Bestaetigung - sie ersetzt KEIN Gate,
  // POST /api/calls faehrt seine Kette unveraendert.
  uiTool(
    "place_call",
    {
      description: placeCallDescription(consultAllowed),
      annotations: TOOL_ANNOTATIONS.place_call,
      inputSchema: {
        ...PLACE_CALL_REQUEST_SCHEMA,
        // SDK-Grund (node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:125,
        // 166-178): ein PFLICHTFELD im zod-Schema wuerde bei Fehlen als "Input validation
        // error" enden, OHNE dass der Handler (und damit toolErrorText/loc.mcp) je laeuft -
        // der Client saehe nie den Kartensatz. Deshalb optional im SCHEMA, Pflicht erst im
        // HANDLER (s.u., confirmCallHop/confirmationRequired).
        // KORRIGIERT (T2-14-Nachbesserung, Safety-Review): "From the Hermes card" liess
        // offen, ob das Modell dieses Feld je selbst befuellt - es kann es nicht, der Code
        // erreicht das Modell nie (nur `_meta`). Nur die Karte selbst setzt dieses Feld, beim
        // eigenen place_call-Aufruf ueber die Host-Bruecke. Emphase-Pin unveraendert
        // (["SAME","REQUIRED","NOT"]).
        confirmation_code: z
          .string()
          .optional()
          .describe(
            "Only the Hermes card can supply this, once the user confirms prepare_call (SAME arguments incl. briefing/context) - never guess or invent it. REQUIRED - without it the call is NOT placed.",
          ),
      },
      outputSchema: CALL_OUTPUT,
      ...callWidgetUi,
    },
    async (args) => {
      // T2-13 (N-10): confirmation_code darf NICHT im Body an POST /api/calls
      // ankommen (er hat dort nichts verloren und liefe sonst mit in den
      // Call-Datensatz) - destrukturiert raus, BEVOR irgendein Hop laeuft.
      const { confirmation_code, ...request } = args;
      const confirmResult = await confirmCallHop({
        identity,
        scopedTenant,
        body: { ...request, confirmation_code },
      });
      requireFields(confirmResult, { preview: "object" });
      if (!confirmResult.confirmed) {
        return unconfirmedResult(loc, confirmResult);
      }
      const r = await placeCallHopCall(request);
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
        // P2 (SCOPE 2): die Quittung ist die ERSTE Pflicht nach Erhalt der Frage - sie
        // ist zugleich der Berechtigungstest. Bleibt sie aus, bricht der Server den
        // Halt nach wenigen Sekunden ab, statt den Anrufer 47 s stumm warten zu lassen.
        // Kommentar zur GQ-B2/N-11-Begruendung: s. ANSWER_CONSULT_DESCRIPTION oben.
        description: ANSWER_CONSULT_DESCRIPTION,
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
        // T2-15 (O-14): wirft AUSSERHALB des try/catch - ein Treffer darf NICHT als
        // "nicht angenommen" (400/409, notAccepted unten) getarnt werden, sondern muss
        // als echter Tool-Fehler bei wrapHandler landen. Kein Ausnahme-Schluessel: JEDE
        // Antwort wird geprueft (answer_consult nimmt kein `to`/`language` entgegen).
        rejectRestrictedData({ answers }, []);
        try {
          const r = await call("POST", `/api/calls/${call_id}/consult/answer`, { event_id, status, answers });
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
  // get_call_result beim Terminal-Status "completed" selbst ueber ihre Host-Bruecke
  // aufruft. Bleibt als Text-Tool erhalten (Fallback, falls die Widget-Bruecke nicht
  // antwortet). Handler/Whitelist (pickTranscript) unveraendert.
  //
  // Review-Runde 2 (P4): die alte Beschreibung ("call this only once status=completed")
  // war ENGER als der Handler (der lehnt einzig status==="active" ab, :1280) - ein nicht
  // platzierter Anruf ist status=failed, nicht completed, und wurde vom Modell deshalb
  // faelschlich uebersprungen. Jetzt am tatsaechlichen Handler-Verhalten ausgerichtet.
  // T2-11 (N-12): der fruehere Toolname versprach ein Transkript, das dieses Werkzeug
  // nie lieferte - Name/Titel/Statuszeilen jetzt umbenannt (Owner-Entscheidung
  // 2026-09-22, Breaking Change gewollt, kein Alias).
  // Kopplung: die WIDGET_CALL-Karte (src/ui/widgets/call.html) ruft dieses Werkzeug per
  // Host-Bruecke unter eigenem Konstantennamen ab (TOOL_GET_CALL_RESULT). Ein Rename hier
  // ohne Nachzug dort macht die Ergebnis-Karte stumm; eine geaenderte Karte braucht
  // zusaetzlich eine neue Pin-Version (src/ui/widget-versions.json). Test T11-f in
  // test/openai-t2-11-werkzeugtexte.test.js prueft jede Widget-Referenz gegen tools/list.
  uiTool(
    "get_call_result",
    {
      description: CALL_RESULT_DESCRIPTION,
      annotations: TOOL_ANNOTATIONS.get_call_result,
      inputSchema: { call_id: z.string().describe("The call_id from place_call") },
      outputSchema: CALL_RESULT_OUTPUT,
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
      // T2-15 (O-14, LECK-STELLE 1): die FELDER von data (schon maskiert), NICHT
      // resultCardView(c.result) direkt - sonst stuende die Ergebniskarte im Text-Block
      // weiterhin roh, obwohl structuredContent bereits maskiert ist.
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                result_summary: data.result_summary,
                objective_achieved: data.objective_achieved,
                outcome: data.outcome,
                commitments: data.commitments,
                counterparty_commitments: data.counterparty_commitments,
                open_points: data.open_points,
                next_step: data.next_step,
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
  // T2-11 (N-12): der fruehere Toolname begann mit "my" und suggerierte die Nummer des
  // Nutzers, das Werkzeug liefert aber die Nummer des Telefon-Agenten - jetzt umbenannt
  // (Owner-Entscheidung 2026-09-22, Breaking Change gewollt, kein Alias). Titel/Statuszeilen/Beschreibung
  // bleiben woertlich - nur der Name aendert sich. Die Widget-Bindung laeuft ueber die
  // Widget-Kennung WIDGET_MY_NUMBER, nicht ueber den Toolnamen, und loest unveraendert auf.
  uiTool(
    "get_agent_number",
    {
      description: "Returns the phone number of the phone agent.",
      annotations: TOOL_ANNOTATIONS.get_agent_number,
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
      const open = s.actionItems.filter((item) => !item.done);
      return open.length ? text(actionItemsText(open, loc.mcp)) : text(loc.mcp.emptyActionItems);
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
      description: AGENT_STATUS_DESCRIPTION,
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
