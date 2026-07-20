// Telnyx-Adapter: VoiceControl (originateCall, endCall) ueber die TeXML-REST-API.
// Kein SDK/client.js: Base-URL + Key direkt aus config (kein Lazy-Init-Antipattern,
// P15). global fetch ist eingebaut (Node) - keine neue Dependency. Der Port spricht
// neutrale Felder (from/to/url/...), Telnyx erwartet Twilio-kompatible PascalCase-
// Form-Felder (Mapping hier). API-Key NIE in Fehlermeldungen leaken (Regel 4).
//
// Verifiziert gegen die Telnyx-Doku (2026-06-15), live UNBESTAETIGT (erste echte
// Telnyx-Voice-Verdrahtung -> mit dem Owner live fixen, falls die API abweicht):
//   originate: POST {base}/v2/texml/calls/{connection_id}  (form, From/To/Url/...)
//              -> Twilio-kompatible Call-Resource, sid = CallSid.
//   endCall:   POST {base}/v2/texml/Accounts/{account_sid}/Calls/{call_sid}
//              (form, Status=completed) -> beendet den Call (Twilio-kompatibel).
import { config } from "../../../config.js";
import { assertTelnyxOk } from "./errors.js";
import { voiceAttrs } from "./render.js";
import { elevenLabsVoiceName, hasElevenLabsVoice } from "./elevenlabs-voice.js";
import { parseDecimalToMicroCents, parseNonNegativeInteger } from "./cost-parse.js";

const TEXML_BASE = "/v2/texml";
// Call-Control-Basis (P4, AI-Assistant-Pfad): Origination/Hangup/ai_assistant_start laufen
// ueber /v2/calls + Action-Endpunkte, NICHT ueber TeXML. Der TeXML-Pfad bleibt daneben unveraendert.
const CALL_CONTROL_BASE = "/v2/calls";
const FORM_HEADERS_TYPE = "application/x-www-form-urlencoded";
const JSON_HEADERS_TYPE = "application/json";
// Call-Control-Action-Slugs (Teil des URL-Vertrags, benannt gegen Tippfehler; G25).
const HANGUP_ACTION = "hangup";
const ASSISTANT_START_ACTION = "ai_assistant_start";
const SPEAK_ACTION = "speak";

// ---- CDR/Ist-Kosten (PLAN-LIVE-COST-TRACING P1) ----
// Einzige Telnyx-Quelle mit Einzel-Call-Granularitaet (Kap. 2.6): GET /v2/detail_records.
// usage_reports aggregiert nur, der call.hangup-Webhook traegt kein Kostenfeld.
const DETAIL_RECORDS_BASE = "/v2/detail_records";
// HTTP-200-verifizierte record_type-Enumwerte (Messung 2026-07-20). "call" existiert NICHT
// (HTTP 400, code 10011). amd/conference/messaging/media-streaming sind gueltig, aber leer
// -> nicht abgefragt (Requests ohne Ertrag). EINE Quelle des Enums (G5/G25).
const COST_RECORD_TYPES = Object.freeze([
  "sip-trunking", "call-control", "speech-to-text",
  "text-to-speech", "recording", "inference", "ai-voice-assistant",
]);
// Eine Seite je Typ. Volle Seite = moeglicher Datenverlust -> fail-closed (ok:false)
// statt stiller Untermenge; eine Paginierungsschleife haette in P1 keinen Aufrufer.
const COST_RECORDS_PAGE_SIZE = 250;
// Kandidaten-Felder der Leg-Referenz. Welche record_types ueberhaupt eine tragen, ist
// UNBELEGT (Kap. 2.6) - P3 beantwortet das aus dem leg_unresolved-Zaehler. Kein Treffer
// -> Record faellt weg (konservativ: fehlende Records heissen spaeter 'incomplete',
// ein FREMDER Record waere eine Fehlbuchung).
const LEG_ID_FIELDS = Object.freeze(["leg_id", "call_leg_id"]);
// Kandidaten-Felder des Record-Zeitstempels fuer den zusaetzlichen CLIENT-seitigen
// Fensterfilter (Design-Entscheidung P1, s. getVoiceCostRecords) - der Feldname ist wie
// die Query-Parameternamen des Zeitfensters UNBELEGT (Kap. 2.6 belegt nur cost/rate/
// currency/rate_measured_in). Kein Treffer -> Fensterpruefung greift nicht (die strikte
// Leg-ID-Gleichheit bleibt der primaere Riegel; ein fehlendes Zeitstempel-Feld verwirft den
// Record NICHT - anders als eine fehlende Leg-Referenz, die IMMER verwirft, s. recordLegId).
const RECORD_TIMESTAMP_FIELDS = Object.freeze(["recorded_at", "created_at"]);
// SpeakRequest.voice_settings ist laut Telnyx-OpenAPI eine per `type` diskriminierte Union;
// ElevenLabsVoiceSettings verlangt type="elevenlabs" (das ASSISTANT-Objekt dagegen hat ein
// flaches voice_settings OHNE type - deshalb lebt der Token hier, nicht im Provisioner).
const ELEVENLABS_VOICE_SETTINGS_TYPE = "elevenlabs";

// STT-Sprach-Hint pro Call (RCA-Wurzel R2). Modell MUSS mitgesendet werden - TranscriptionConfig.model
// hat laut Telnyx-OpenAPI den Default "distil-whisper/distil-large-v2" (ENGLISCH-ONLY, non-streaming);
// ein transcription-Block ohne model koennte die STT still auf Englisch kippen. Der Wert spiegelt das
// STT-Modell des Assistant-Objekts (deepgram/flux = das einzige Telnyx-Modell mit Turn-Taking-Features).
const STT_MODEL = "deepgram/flux";
// Von deepgram/flux unterstuetzte Sprach-Hints (Telnyx-OpenAPI, TranscriptionConfig.language).
// "auto" = Telnyx-Spracherkennung setzt den Hint. "multi" bedeutet dort woertlich "no language hint"
// und ist der LIVE-DEFEKT (R2: Deutsch kam als NL/EN-Kauderwelsch an) - dieser Adapter sendet es NIE.
const STT_FLUX_HINTS = Object.freeze(["en", "es", "fr", "de", "hi", "ru", "pt", "ja", "it", "nl"]);
const STT_LANGUAGE_AUTO = "auto";

// HTTP-Fehler werfen MIT Status (P8) und - falls vorhanden - dem Telnyx-Fehlercode/-titel,
// damit der echte Ablehnungsgrund (z.B. Caller-ID nicht zugewiesen, Land im Voice-Profil
// gesperrt) im Log steht statt nacktem "HTTP 403". STRIKT allowlisted: NUR errors[].code +
// errors[].title; NIE der rohe Body/detail (koennte Auth-/Nummern-Fragmente tragen, daher
// includeDetail=false), NIE der API-Key (Regel 4/5). attachStatus haengt err.providerStatus
// an, damit der Aufrufer (server.js) die Ablehnung kategorisieren kann. Gemeinsamer Parser
// in ./errors.js (G5) - eine konsistente Telnyx-Envelope-Entscheidung im Provider-Package.
const ATTACH_STATUS = { attachStatus: true };

// Bearer-Header + Content-Type. Eine Stelle (G5) = EINE Quelle fuer den geheimen Bearer-Key.
// Default form-urlencoded haelt die TeXML-Bestandsaufrufer byte-identisch; die Call-Control-
// Methoden reichen JSON durch (contentType ist ein Wert-Parameter, KEIN Verhaltens-Flag).
function headers(contentType = FORM_HEADERS_TYPE) {
  return { Authorization: `Bearer ${config.telephony.telnyxApiKey}`, "Content-Type": contentType };
}

// OBS-2: PII-freie Erfolgs-Spur pro Call-Control-Op (Op-Name + HTTP-Status + call_control_id-
// PRAESENZ als Boolean). NIE der callControlId-WERT, NIE der API-Key (Regel 4). Eine Stelle (G5)
// als EINZIGE Quelle des Erfolgs-Log-Formats, von den Action-Posts (postCallControlAction) und der
// Origination geteilt. Nur auf dem Erfolgspfad erreichbar (assertTelnyxOk wirft vorher).
function logCallControlOk(op, status, ccidPresent) {
  console.log(`[telnyx/voice] ${op} ok status=${status} ccid=${ccidPresent}`);
}

// Telnyx-v2 wrappt manche Antworten in {data}, andere nicht - beide Formen abdecken (G5:
// EINE Unwrap-Stelle). Body nicht lesbar/kein JSON -> {} (Aufrufer liest nur optionale
// Felder). Non-destruktiv, nur auf dem Erfolgspfad (assertTelnyxOk hat !ok bereits verworfen).
async function parseTelnyxResource(res) {
  const json = await res.json().catch(() => ({}));
  return json.data || json;
}

// Gemeinsames Fetch-Skelett fuer Call-Control-Actions (G5): endCallViaCallControl und
// startAssistant posten beide auf {base}/v2/calls/{callControlId}/actions/{action} mit
// JSON-Body und pruefen ueber denselben assertTelnyxOk-Helper. action/body/op als EIN
// Optionsobjekt (F1, sonst 4 lose Argumente). originateViaCallControl bleibt separat -
// andere URL-Form (kein callControlId/actions-Pfad) und eigenes Response-Parsing.
async function postCallControlAction(callControlId, { action, body, op }) {
  const res = await fetch(
    `${config.telephony.telnyxApiBase}${CALL_CONTROL_BASE}/${callControlId}/actions/${action}`,
    { method: "POST", headers: headers(JSON_HEADERS_TYPE), body: JSON.stringify(body) },
  );
  await assertTelnyxOk(res, op, ATTACH_STATUS);
  logCallControlOk(op, res.status, Boolean(callControlId));
}

// Voice-Felder des speak-Bodys (eine Aufgabe, eine Abstraktionsebene: G30/G34).
// ElevenLabs-Zweig = dieselbe Stimme, die der AI-Assistant danach spricht (RCA-Wurzel R5:
// EINE Stimme im ganzen Call). KEIN `language`: im SpeakRequest optional (required =
// payload+voice), es steuert die Azure-/Telnyx-TTS-Sprache; ElevenLabs-Modelle sind
// multilingual und folgen dem Text (gleiche Entscheidung wie der TeXML-Say in render.js).
// Fail-SAFE (Fallback a): unvollstaendige ElevenLabs-Config -> Azure-Bestand byte-identisch.
function speakVoiceFields({ voiceProfile, useAssistantVoice }) {
  const el = config.telnyx.telnyxElevenLabs;
  if (useAssistantVoice && hasElevenLabsVoice(el))
    return {
      voice: elevenLabsVoiceName(el),
      voice_settings: { type: ELEVENLABS_VOICE_SETTINGS_TYPE, api_key_ref: el.apiKeyRef },
    };
  return voiceAttrs(voiceProfile); // { voice, language } - Bestand
}

// Observability: EINE Quelle fuer "ist die Assistant-Stimme ueberhaupt konfiguriert?"
// - der Ingest-Log-Marker kann damit nie von dem abweichen, was speak wirklich sendet (G5).
export function assistantVoiceConfigured() {
  return hasElevenLabsVoice(config.telnyx.telnyxElevenLabs);
}

// Neutrale Gespraechssprache (call.language: de|fr|en) -> Telnyx-transcription-Felder. Das Mapping
// lebt ADAPTER-INTERN (kein Provider-String durch den Port) in startAssistant (G5), das von
// Ingest- UND Inbound-Pfad genutzt wird - reicht call.language aber nur der Ingest-Pfad durch.
// Der Inbound-Pfad ruft startAssistant ohne language (BYTE-IDENTISCH, STT-Hint dort P6-Scope),
// hier greift der Ohne-language-Zweig. Ohne language -> KEIN transcription-Feld, Body
// byte-identisch zum Bestand (Grenzfall, z.B. call.language nicht aufloesbar).
// Sprache ausserhalb der flux-Hint-Liste (auch "multi") -> "auto": Telnyx-Detection statt Hint-los.
function transcriptionFields(language) {
  if (!language) return {};
  const hint = STT_FLUX_HINTS.includes(language) ? language : STT_LANGUAGE_AUTO;
  return { transcription: { model: STT_MODEL, language: hint } };
}

// ---- CDR/Ist-Kosten Helfer (PLAN-LIVE-COST-TRACING P1) ----

// Erste aufloesbare Leg-Referenz eines Roh-Records (G5: eine Stelle, ein Feldvertrag).
function recordLegId(raw) {
  for (const field of LEG_ID_FIELDS) {
    if (raw[field]) return String(raw[field]);
  }
  return null;
}

// Client-seitiger Zusatzfilter gegen das Anrufsfenster (Design-Entscheidung P1): kein
// aufloesbares/parsebares Zeitstempel-Feld -> NICHT ablehnen (die strikte Leg-ID-
// Gleichheit in toCostRecord bleibt der primaere Riegel; ein fehlendes Feld ist keine
// Erkenntnis ueber die Zeit, konservativ = durchlassen statt raten).
function withinRecordWindow(raw, startedAt, endedAt) {
  const rawTimestamp = RECORD_TIMESTAMP_FIELDS.map((field) => raw[field]).find(Boolean);
  if (!rawTimestamp) return true;
  const t = Date.parse(rawTimestamp);
  if (Number.isNaN(t)) return true;
  return t >= Date.parse(startedAt) && t <= Date.parse(endedAt);
}

// Roh-Record -> Port-Record oder Ablehnungsgrund (fuer den PII-freien Zaehler in
// getVoiceCostRecords). EINE Gueltigkeitsquelle je Record, in dieser Reihenfolge:
// Waehrung, Leg, Zeitfenster, Kosten - jeder Zweig mit eigenem Grund.
function toCostRecord(raw, { legId, startedAt, endedAt }) {
  const currency = String(raw.currency || "").trim().toUpperCase();
  const expectedCurrency = String(config.billing.providerCurrency).trim().toUpperCase();
  if (!currency || currency !== expectedCurrency) return { reason: "currency_mismatch" };

  const recordLeg = recordLegId(raw);
  if (recordLeg === null) return { reason: "leg_unresolved" };
  if (recordLeg !== legId) return { reason: "leg_mismatch" };

  if (!withinRecordWindow(raw, startedAt, endedAt)) return { reason: "out_of_window" };

  const costMicroCents = parseDecimalToMicroCents(raw.cost);
  if (costMicroCents === null) return { reason: "cost_unparsable" };

  return {
    record: {
      recordType: raw.record_type,
      costMicroCents,
      currency,
      billedSec: parseNonNegativeInteger(raw.billed_sec),
      legId,
    },
  };
}

// Eine Typ-Abfrage gegen /v2/detail_records. Wirft NICHT: Ergebnis-Objekt wie die Port-
// Methode selbst (G31). Server-Filter sind NUR filter[record_type] + page[size] (Kap. 2.6
// belegt genau diese zwei) - das Zeitfenster wird NICHT als Query-Parameter geraten (die
// Parameternamen sind UNBELEGT); die Fensterpruefung laeuft ausschliesslich client-seitig
// in toCostRecord. Jeder Wurf und jedes rejectende fetch (Netzfehler/Timeout) wird zu
// { ok:false, reason:"provider_error" } - kein Timeout-Aufrufer in P1 (s. Phasen-Report).
async function fetchCostRecordPage(recordType) {
  const q = new URLSearchParams();
  q.set("filter[record_type]", recordType);
  q.set("page[size]", String(COST_RECORDS_PAGE_SIZE));
  try {
    const res = await fetch(`${config.telephony.telnyxApiBase}${DETAIL_RECORDS_BASE}?${q}`, {
      headers: headers(),
    });
    await assertTelnyxOk(res, "getVoiceCostRecords", ATTACH_STATUS);
    const raw = await parseTelnyxResource(res);
    if (!Array.isArray(raw)) return { ok: false, reason: "shape_unexpected" };
    return { ok: true, raw };
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}

// PII-freier Erfolgs-Log fuer getVoiceCostRecords (OBS-2-Linie wie logCallControlOk): Op-
// Name, Anzahl akzeptierter Records + Ablehnungsgruende. NIE legId, NIE eine Rufnummer,
// NIE der Key (Regel 4/5).
function logCostRecordsOk(recordCount, rejectedByReason) {
  console.log(
    `[telnyx/voice] getVoiceCostRecords ok records=${recordCount} rejected=${JSON.stringify(rejectedByReason)}`,
  );
}

/** @type {import("../../ports.js").VoiceControl} */
export const telnyxVoice = {
  // Outbound-Call starten. connection_id (TeXML-Application) haelt die Voice-URL
  // beim Provider; From/To/Url/StatusCallback steuern den konkreten Call.
  async originateCall({ from, to, url, statusCallback, statusCallbackEvent, method, timeLimit }) {
    if (!config.telephony.telnyxApiKey)
      throw new Error("Telnyx originateCall: TELNYX_API_KEY fehlt");
    if (!config.telephony.telnyxConnectionId)
      throw new Error("Telnyx originateCall: TELNYX_CONNECTION_ID fehlt");
    const form = new URLSearchParams({ From: from, To: to, Url: url });
    if (statusCallback) form.set("StatusCallback", statusCallback);
    if (method) {
      form.set("UrlMethod", method);
      form.set("StatusCallbackMethod", method);
    }
    for (const ev of statusCallbackEvent || []) form.append("StatusCallbackEvent", ev);
    // Defense-in-Depth: Telnyx-Honorierung von TimeLimit ist unbestaetigt, deshalb
    // setzt server.js zusaetzlich den harten Max-Dauer-Timer (Absolute Regel). Das
    // Feld wird trotzdem mitgegeben (schadet nicht, greift falls unterstuetzt).
    if (timeLimit) form.set("TimeLimit", String(timeLimit));
    const res = await fetch(
      `${config.telephony.telnyxApiBase}${TEXML_BASE}/calls/${config.telephony.telnyxConnectionId}`,
      {
        method: "POST",
        headers: headers(),
        body: form,
      },
    );
    await assertTelnyxOk(res, "originateCall", ATTACH_STATUS);
    // Twilio-kompatible Call-Resource. sid = CallSid (Fallback call_sid).
    const data = await parseTelnyxResource(res);
    return { sid: data.sid || data.call_sid };
  },

  // Laufenden Call beenden (Twilio-kompatibel: Status=completed). Braucht den
  // account_sid (config.telephony.telnyxAccountSid) zusaetzlich zum CallSid - account-weite
  // Konstante, daher aus config statt durch den Port-Vertrag gereicht (endCall
  // bekommt nur den CallSid, byte-identisch zum Twilio-Adapter).
  async endCall(callSid) {
    if (!config.telephony.telnyxApiKey) throw new Error("Telnyx endCall: TELNYX_API_KEY fehlt");
    if (!config.telephony.telnyxAccountSid)
      throw new Error("Telnyx endCall: TELNYX_ACCOUNT_SID fehlt");
    const res = await fetch(
      `${config.telephony.telnyxApiBase}${TEXML_BASE}/Accounts/${config.telephony.telnyxAccountSid}/Calls/${callSid}`,
      { method: "POST", headers: headers(), body: new URLSearchParams({ Status: "completed" }) },
    );
    await assertTelnyxOk(res, "endCall", ATTACH_STATUS);
  },

  // --- Call-Control-Variante (P4, AI-Assistant-Pfad) ---
  // Verifiziert gegen die Telnyx-Call-Control-Doku, live UNBESTAETIGT (erste Call-Control-
  // Verdrahtung -> mit dem Owner in P5/P7 live fixen, falls die API abweicht). Feldnamen
  // und die ai_assistant_start-Body-Form sind Doku-Stand, kein Live-Beweis.

  // Outbound-Call ueber Call Control originieren (statt TeXML). Liefert die call_control_id
  // als EIGENES Feld (callControlId) - NICHT sid ueberladen: die Boot-Recovery (P6) adressiert
  // den Hangup ueber genau diese ID-Form. KEINE Store-Persistenz hier (Caller/P5 persistiert).
  //
  // connection_id ist hier die ID einer Call-Control-Application, NICHT die TeXML-Application
  // aus telnyxConnectionId - Telnyx fuehrt beide als getrennte Objekttypen. Die TeXML-ID zu
  // senden lehnt Telnyx deterministisch ab: HTTP 422 "10015 Invalid value for connection_id
  // (Call Control App ID)" (Live-Bug 2026-07-10, tasks/rca-place-call-422.md). Der TeXML-Pfad
  // (originateCall, Nummern-Routing) benutzt weiterhin telnyxConnectionId.
  async originateViaCallControl({ from, to, webhookUrl, method, timeLimit }) {
    if (!config.telephony.telnyxApiKey)
      throw new Error("Telnyx originateViaCallControl: TELNYX_API_KEY fehlt");
    if (!config.telnyx.telnyxAssistant.callControlAppId)
      throw new Error("Telnyx originateViaCallControl: TELNYX_CALL_CONTROL_APP_ID fehlt");
    const payload = { connection_id: config.telnyx.telnyxAssistant.callControlAppId, to, from };
    if (webhookUrl) payload.webhook_url = webhookUrl;
    if (method) payload.webhook_url_method = method;
    // Defense-in-Depth wie originateCall: server.js setzt zusaetzlich den harten Max-Dauer-
    // Timer (Absolute Regel). time_limit_secs greift zusaetzlich, falls Telnyx es honoriert.
    if (timeLimit) payload.time_limit_secs = timeLimit;
    const res = await fetch(`${config.telephony.telnyxApiBase}${CALL_CONTROL_BASE}`, {
      method: "POST",
      headers: headers(JSON_HEADERS_TYPE),
      body: JSON.stringify(payload),
    });
    await assertTelnyxOk(res, "originateViaCallControl", ATTACH_STATUS);
    const data = await parseTelnyxResource(res);
    // OBS-2: ccid-PRAESENZ hier = ob die Antwort eine call_control_id trug (nie der Wert).
    logCallControlOk("originateViaCallControl", res.status, Boolean(data.call_control_id));
    return { callControlId: data.call_control_id };
  },

  // Laufenden Call-Control-Call beenden: POST /v2/calls/{callControlId}/actions/hangup.
  // GETRENNTE Methode neben der TeXML-endCall(callSid) - die bleibt byte-identisch fuer den
  // Budget-/TeXML-Hangup-Pfad. Adressiert den call_control_id-Endpunkt, NICHT TeXML
  // (Regel 1/Befund c: falscher Endpunkt/ID = Kostenexplosion). Leere ID -> fail-closed.
  async endCallViaCallControl(callControlId) {
    if (!config.telephony.telnyxApiKey)
      throw new Error("Telnyx endCallViaCallControl: TELNYX_API_KEY fehlt");
    if (!callControlId) throw new Error("Telnyx endCallViaCallControl: callControlId fehlt");
    await postCallControlAction(callControlId, {
      action: HANGUP_ACTION,
      body: {},
      op: "endCallViaCallControl",
    });
  },

  // Telnyx-AI-Assistant an den laufenden Call-Control-Call anhaengen (ai_assistant_start).
  // Provider-neutraler Transport: assistantId liefert der Caller (P5/P7); der Adapter erzeugt/
  // persistiert KEINE Assistant-Config/Secrets. Voice/Greeting/interruption_settings sind
  // Assistant-Config (P7), NICHT hier. Der per-Call-transcription-Block gewinnt laut
  // Telnyx-OpenAPI ueber das Assistant-Objekt; language ist OPTIONAL - fehlt sie, sendet der
  // Adapter KEIN transcription-Feld und der Body bleibt Bestand. Nur telnyx-call-control-ingest.js
  // reicht call.language durch; telnyx-inbound.js ruft startAssistant OHNE language (Inbound
  // bleibt in dieser Phase BYTE-IDENTISCH, STT-Sprach-Hint dort ist P6-Scope).
  async startAssistant({ callControlId, assistantId, language }) {
    if (!config.telephony.telnyxApiKey)
      throw new Error("Telnyx startAssistant: TELNYX_API_KEY fehlt");
    if (!callControlId) throw new Error("Telnyx startAssistant: callControlId fehlt");
    if (!assistantId) throw new Error("Telnyx startAssistant: assistantId fehlt");
    await postCallControlAction(callControlId, {
      action: ASSISTANT_START_ACTION,
      body: { assistant: { id: assistantId }, ...transcriptionFields(language) },
      op: "startAssistant",
    });
  },

  // Deterministischer Call-Control-Speak-Node (P4.5): server-seitiges TTS EINES Textes
  // VOR ai_assistant_start (Pflicht-Offenlegung, Regel 2). voiceProfile -> Telnyx-Voice/
  // Language ueber dieselbe Map wie der TeXML-Renderer (voiceAttrs, G5), sofern useAssistantVoice
  // fehlt/false ODER die ElevenLabs-Config unvollstaendig ist (Azure-Neural, byte-identisch zum
  // Bestand). useAssistantVoice=true + vollstaendige Config -> dieselbe ElevenLabs-Stimme, die
  // der AI-Assistant danach spricht (RCA-Wurzel R5, speakVoiceFields). Der fruehere ElevenLabs-
  // LIVE-RELAY-Befund (unterdrueckt den Inbound-Track) gilt fuer den TeXML-Gather-Pfad
  // (Inbound-Track, render.js), NICHT fuer diesen Call-Control-speak: hier folgt kein Gather,
  // sondern ai_assistant_start - es gibt keinen Inbound-Track zu unterdruecken. Body-Feldform
  // live UNBESTAETIGT (wie P4) -> mit Owner in P5/P11 fixen. Leere ID/Text -> fail-closed.
  async speak({ callControlId, text, voiceProfile, useAssistantVoice = false }) {
    if (!config.telephony.telnyxApiKey) throw new Error("Telnyx speak: TELNYX_API_KEY fehlt");
    if (!callControlId) throw new Error("Telnyx speak: callControlId fehlt");
    if (!text) throw new Error("Telnyx speak: text fehlt");
    await postCallControlAction(callControlId, {
      action: SPEAK_ACTION,
      body: { payload: text, ...speakVoiceFields({ voiceProfile, useAssistantVoice }) },
      op: "speak",
    });
  },

  // Ist-Kosten-Datensaetze EINES Calls abrufen (PLAN-LIVE-COST-TRACING P1). OPTIONAL am
  // Port, Telnyx-only wie originateViaCallControl: Twilios price-Feld deckt nur
  // Connectivity - dieselbe Signatur mit anderer Semantik waere schlimmer als keine.
  //
  // WIRFT NIE. Rueckgabe ist ein ERGEBNIS-OBJEKT, nie eine nackte Zahl: die
  // Unterscheidung "gemessen 0" vs. "nicht gemessen" ist im Typ erzwungen, nicht per
  // Konvention (G31). ok:false heisst NIEMALS "Kosten = 0".
  //
  // Server-Filter + zusaetzliche CLIENT-seitige Pruefung auf legId und Zeitfenster: die
  // Query-Parameternamen des Zeitfilters sind UNBELEGT (Kap. 2.6 belegt filter[record_type]
  // + page[size]). Ignoriert Telnyx den Filter, holen wir zu viel - durchgelassen wird
  // trotzdem nichts Falsches.
  async getVoiceCostRecords({ legId, startedAt, endedAt } = {}) {
    if (!config.telephony.telnyxApiKey) return { ok: false, reason: "config_missing" };
    if (!legId || !startedAt || !endedAt) return { ok: false, reason: "params_missing" };

    const records = [];
    const rejectedByReason = {};
    for (const recordType of COST_RECORD_TYPES) {
      const page = await fetchCostRecordPage(recordType);
      if (!page.ok) return page; // kein Teil-Erfolg (P1-Risiko/G31)
      if (page.raw.length === COST_RECORDS_PAGE_SIZE) return { ok: false, reason: "page_truncated" };
      for (const rawRecord of page.raw) {
        const outcome = toCostRecord(rawRecord, { legId, startedAt, endedAt });
        if (outcome.record) records.push(outcome.record);
        else rejectedByReason[outcome.reason] = (rejectedByReason[outcome.reason] || 0) + 1;
      }
    }
    logCostRecordsOk(records.length, rejectedByReason);
    return { ok: true, records };
  },
};
