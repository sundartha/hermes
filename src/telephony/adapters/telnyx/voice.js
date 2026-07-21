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
import { createMinuteWindowThrottle } from "./rate-limit.js";

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
// -> nicht abgefragt (Requests ohne Ertrag). EINE Quelle des Enums (G5/G25) - exportiert,
// damit Tests und der Boot-Guard gegen genau diese Menge koppeln statt gegen eine Kopie.
export const COST_RECORD_TYPES = Object.freeze([
  "sip-trunking", "call-control", "speech-to-text",
  "text-to-speech", "recording", "inference", "ai-voice-assistant",
]);
// Eine Seite je Typ, in der GEMESSENEN Maximalgroesse: page[size] deckelt hart bei 50 -
// angefordert 250/100/50 liefert meta.page_size immer 50 (Messung 2026-07-21, Telnyx-Doku
// nennt dasselbe Maximum). Genau daran war die fruehere 250 eine TOTE Sicherung: die
// Antwort konnte diese Laenge nie erreichen, der Vergleich nie greifen. Ob eine Seite die
// ganze Menge ist, entscheidet ab jetzt meta.total_pages AUS DER ANTWORT
// (isLastPage) - nie die selbst angeforderte Groesse. Ab KE-P3 traegt die Seitenschleife
// (fetchRecordTypePages) die Menge zusammen; eine nicht ausgeschoepfte Menge ist fail-closed.
const COST_RECORDS_PAGE_SIZE = 50;
// page[number] ist 1-BASIERT (Messung 2026-07-21: Seiten 1-3 mit page[size]=50 schliessen
// luecken- und ueberlappungsfrei aneinander an).
const FIRST_PAGE_NUMBER = 1;
// Obergrenze der Seitenschleife JE TYP. Herleitung: der groesste gemessene Typ liefert
// konto-weit und ohne Zeitschranke 212 Belege = 5 Seiten (Messung 2026-07-21); 10 Seiten
// sind das Doppelte (500 Belege je Typ) und damit Reserve bis zum naechsten Sweep. Kein
// Optimierungsknopf, sondern der Riegel gegen eine Schleife gegen einen Provider, der die
// letzte Seite nie meldet: ohne sie verbraucht ein einziger Sweep das gemessene
// Minutenkontingent (40 Anfragen je fixem UTC-Minutenfenster) und laeuft im Grenzfall
// unbegrenzt. Erreicht die Schleife sie, ist die Menge eine BEWIESENE Untermenge ->
// complete:false. Mehr Belege sind ein Fall fuer eine engere Zeitschranke (`since`,
// KE-P5), nicht fuer mehr Seiten.
const MAX_PAGES_PER_RECORD_TYPE = 10;
// GEMESSENES Kontingent von /v2/detail_records (Plan F1, Messung 2026-07-21): 40 Anfragen je
// FIXEM UTC-Minutenfenster (Header "x-ratelimit-limit: 40, 40;w=60"), der Reset faellt immer
// auf :00, das Fenster gleitet NICHT. Drei unabhaengige Messungen tragen die Aussage: die 41.
// Anfrage eines Bursts ist HTTP 429 (Telnyx-Code 10011), 39 s spaeter wieder 200 mit
// remaining=39, und 35 Anfragen ueber ein volles Fenster ergaben 0 x 429. Ohne Drossel sind
// 224 Anfragen ohne Pause live {"200":40,"429":184} - 184 verworfene Anfragen und ein Sweep
// ohne Messung.
const DETAIL_RECORDS_LIMIT_PER_MINUTE = 40;
// Bewusste Reserve UNTER dem gemessenen Limit. Sie deckt zwei UNBELEGTE Groessen ab: ob das
// Kontingent je Key, je Konto oder je Organisation zaehlt (Plan U5 - ein zweiter Prozess am
// selben Konto teilte es), und den Versatz zwischen unserer Uhr und der Fenstergrenze des
// Providers. Das Ausreizen spart Sekunden, das Sprengen kostet die ganze Messung.
const DETAIL_RECORDS_RESERVE_PER_MINUTE = 10;
const DETAIL_RECORDS_BUDGET_PER_MINUTE =
  DETAIL_RECORDS_LIMIT_PER_MINUTE - DETAIL_RECORDS_RESERVE_PER_MINUTE;
// HTTP 429 = Kontingent erschoepft (Telnyx-Code 10011). Telnyx nennt KEIN Retry-After, nur
// x-ratelimit-reset: SEKUNDEN bis zur naechsten vollen Minute (gemessen 15 s im
// Normalbetrieb, 17 s unmittelbar nach dem 429).
const RATE_LIMITED_STATUS = 429;
const RATE_LIMIT_RESET_HEADER = "x-ratelimit-reset";
const MS_PER_SECOND = 1000;
// EINE Drossel je Prozess: das Kontingent gehoert dem ENDPUNKT, nicht dem einzelnen Aufruf.
// Sie gilt AUSSCHLIESSLICH fuer den Belegabruf - Origination, Assistant-Start, speak und
// Nummernkauf laufen NICHT hierdurch, weil die Kontingente pro Endpunkt konfiguriert sind
// (gemessen: /v2/usage_reports traegt "5, 5;w=1"). Ein gedrosselter Origination-Pfad wuerde
// einen echten Anruf um bis zu eine Minute verzoegern - genau das darf nie passieren.
const detailRecordsThrottle = createMinuteWindowThrottle({
  budget: DETAIL_RECORDS_BUDGET_PER_MINUTE,
});
// Zuordnung Beleg -> Call, ZWEISTUFIG (LCT-FIX-1). Die frueheren Kandidaten leg_id/
// call_leg_id liefert Telnyx nicht bzw. nur als UUID eines ANDEREN ID-Systems - damit wurde
// live JEDER Beleg verworfen (297 Belege, Messung 2026-07-21).
//
// Stufe 1 (Anker): DAS Feld, das die Belege mit der uebergebenen Leg-Referenz verbindet.
// providerLegIdOf(call) liefert in BEIDEN Pfaden eine `v3:`-Token (twilioSid im TeXML-/
// Budget-Pfad, callControlId im Assistant-Pfad) - genau die Form traegt call_control_id.
const ANCHOR_ID_FIELD = "call_control_id";
// Stufe 2 (Aufspannen): die zwei Feldnamen, unter denen Belege eine Provider-Session
// fuehren - sip-trunking/call-control/recording/ai-voice-assistant schreiben
// telnyx_session_id, speech-to-text/text-to-speech call_session_id; kein Beleg traegt
// beide. NICHT dabei: telnyx_leg_id/call_leg_id - sie sind UUIDs eines zweiten, mit der
// `v3:`-Token unvereinbaren ID-Systems und als Zuordnungsquelle wertlos.
//
// UNBELEGTE ANNAHME, bewusst NICHT als bewiesen gefuehrt: dass beide Feldnamen denselben,
// CALL-LOKALEN Wert bezeichnen. Diese Invariante ist GEMESSEN, nicht angenommen: read-only
// ueber das gesamte Telnyx-Konto (2026-07-21, 297 Belege / 54 Sessions) trug KEINE Session
// mehr als einen Anker (call_control_id). Mehrere LEGS je Session (bis 3) sind normal - das
// sind die Beine desselben Anrufs. Der Rohauszug liegt NICHT im Repo, die Tests spielen die
// Belegformen daher nach; die Invariante selbst haengt an der Messung, nicht an den Tests.
// GRENZE: in der Stichprobe liefen nie zwei Calls GLEICHZEITIG - genau Parallelitaet wuerde
// sie stressen. Faellt sie doch, kippt die Zuordnung von fail-closed nach fail-OPEN: fremde
// Belege landeten auf dem eigenen Tenant. Beobachtbar ohne Codeaenderung am PII-freien Log
// dieser Methode: es zaehlt je Zuordnungsweg GETRENNT (via_anchor / via_<Session-Feld>). Die
// ueber ein Session-Feld - und NICHT ueber den Anker - angenommenen Belege sind genau die,
// die eine nicht call-lokale ID hereinliesse; real sind das 4 von 7 bzw. 9 von 10. Auffaellig
// ist deshalb nicht ihre Existenz, sondern ein SPRUNG gegen diese Groessenordnung.
const SESSION_ID_FIELDS = Object.freeze(["telnyx_session_id", "call_session_id"]);
// Der Anker als Zuordnungsweg (Stufe 1) neben den Session-Feldern (Stufe 2). Die Wege sind
// die Schluessel des Zaehlers im Log; sie werden IMMER alle gemeldet, auch mit 0 - ein je
// nach Datenlage verschwindender Schluessel machte die Sonde unlesbar.
const ANCHOR_ROUTE = "anchor";
const ASSIGNMENT_ROUTES = Object.freeze([ANCHOR_ROUTE, ...SESSION_ID_FIELDS]);
// Belegtypen, die STRUKTURELL nie einem Call zugeordnet werden koennen: sie tragen weder
// den Anker noch eine Session-Referenz. `inference` fuehrt ausschliesslich conversation_id
// (Messung 2026-07-21). EINE Quelle dieser Aussage (G5).
export const UNASSIGNABLE_COST_RECORD_TYPES = Object.freeze(["inference"]);
// Die Gegenmenge: die Belegtypen, die ueberhaupt als PFLICHT-Typ taugen
// (COST_TRUING_REQUIRED_RECORD_TYPES). Der Boot-Guard prueft gegen DIESE Allowlist, nicht
// gegen die Deny-Liste darueber - eine Deny-Liste laesst jeden Wert durch, der kein realer
// record_type ist (Case-Drift `Inference`, das nicht existierende "call", jeder Tippfehler),
// und der Schaden ist derselbe: die Pflicht-Menge waere dauerhaft unerfuellbar, jeder Call
// bliebe 'incomplete' - keine Rueckerstattung mehr, jede Nachforderung gebucht (einseitige
// Korrektur zulasten des Kunden, Deckungsquote dauerhaft 0 %). Struktur statt Konvention
// (G27): abgeleitet, nicht von Hand gepflegt.
export const ASSIGNABLE_COST_RECORD_TYPES = Object.freeze(
  COST_RECORD_TYPES.filter((t) => !UNASSIGNABLE_COST_RECORD_TYPES.includes(t)),
);
// GEMESSENE Zeitfelder je record_type (Messung 2026-07-21): drei Namensfamilien ohne
// Schnittmenge, kein Feldname existiert auf allen Typen. AUSSCHLIESSLICH fuer die
// Seitenschleife - sie entscheidet, ob eine GANZE Seite aelter als `since` ist. NICHT fuer
// die Zuordnung: dort bleibt RECORD_TIMESTAMP_FIELDS unveraendert (zwei getrennte Fragen -
// "wie weit blaettern wir" gegen "gehoert dieser Beleg in das Anrufsfenster").
// Der Feldname wird NIE geraten: filter[started_at] auf speech-to-text (Zeitfeld heisst
// dort start_time) lieferte 0 Treffer trotz 89 Datensaetzen. Ein falscher Name beendet die
// Schleife zu frueh und verliert Belege still. Die Schluesselmenge ist an
// ASSIGNABLE_COST_RECORD_TYPES gekoppelt (testgepinnt) - exportiert genau dafuer, wie das
// Enum darueber, statt eine Kopie im Test zu pflegen.
export const COST_RECORD_TIME_FIELDS = Object.freeze({
  "sip-trunking": Object.freeze(["started_at", "finished_at"]),
  "call-control": Object.freeze(["started_at"]),
  recording: Object.freeze(["started_at"]),
  "speech-to-text": Object.freeze(["start_time", "end_time"]),
  "text-to-speech": Object.freeze(["created_at"]),
  "ai-voice-assistant": Object.freeze(["created_at", "completed_at"]),
});
// Kandidaten-Felder des Record-Zeitstempels fuer den zusaetzlichen CLIENT-seitigen
// Fensterfilter (Design-Entscheidung P1, s. getVoiceCostRecords) - der Feldname ist wie
// die Query-Parameternamen des Zeitfensters UNBELEGT (Kap. 2.6 belegt nur cost/rate/
// currency/rate_measured_in). Kein Treffer -> Fensterpruefung greift nicht (die ZUORDNUNG
// ueber Anker/Session ist der EINZIGE wirksame Riegel, s. assignmentOutcome; ein fehlendes
// Zeitstempel-Feld verwirft den Record NICHT - anders als eine fehlende Session-Referenz,
// die IMMER verwirft). AUF DEN GEMESSENEN BELEGFORMEN TRAEGT KEIN BELEG eines dieser
// Felder: der Filter ist heute wirkungslos und ausdruecklich KEINE zweite Linie hinter der
// Zuordnung (testgepinnt in test/telnyx-cost-records.test.js).
// Warum `started_at` (das EINZIGE gemessene Zeitfeld, Messung 2026-07-21) trotzdem nicht
// aufgenommen ist: es trat nur an sip-trunking auf - genau dem Typ, der den Anker traegt und
// damit ueber Identitaetsgleichheit bereits bewiesen ist. Es aufzunehmen verwuerfe im
// Grenzfall (Uhren-Versatz gegen unsere eigenen startedAt/endedAt aus dem Store) einen
// BEWIESENEN Beleg, ohne die nur ueber die Session zugeordneten Typen zu schuetzen - die
// tragen kein gemessenes Zeitfeld. Mehr Risiko, keine zweite Linie.
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
// Der allowlistete Telnyx-Code liegt dort zusaetzlich strukturiert als err.providerCode an
// (Quelle der Fehler-Spur des Belegabrufs, s. logCostRecordsFailure).
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
//
// EINE Auswertung, ZWEI Projektionen (Muster telnyxErrorEnvelope in ./errors.js): `data`
// ist die Nutzlast wie bisher, `meta` das Seiten-Objekt einer LISTEN-Antwort
// ({total_results, total_pages, page_size}, Messung 2026-07-21). Das blosse Unwrappen
// wirft meta strukturell weg - und genau dort haengt die Vollstaendigkeits-Aussage des
// Belegabrufs. Kein zweiter Unwrap-Ausdruck daneben (G5).
async function parseTelnyxBody(res) {
  const json = await res.json().catch(() => ({}));
  return { data: json.data || json, meta: json.meta };
}

// Bestands-Projektion fuer EINZEL-Ressourcen (originateCall, originateViaCallControl):
// nur die Nutzlast, Verhalten und Rueckgabeform unveraendert.
async function parseTelnyxResource(res) {
  return (await parseTelnyxBody(res)).data;
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

// Session-Referenzen EINES Roh-Belegs (G5: eine Stelle, ein Feldvertrag) - geteilt von der
// Anker-Sammlung (Stufe 1) und der Zuordnungspruefung (Stufe 2). Jede Referenz traegt den
// Feldnamen mit: ueber WELCHES Feld ein Beleg hereinkam, ist die Falsifikations-Groesse der
// unbelegten Session-Annahme (s. SESSION_ID_FIELDS) - eine nackte ID-Liste verloere sie.
function recordSessionRefs(raw) {
  const refs = [];
  for (const field of SESSION_ID_FIELDS) {
    if (raw[field]) refs.push({ field, id: String(raw[field]) });
  }
  return refs;
}

// Stufe 1: zeigt der Beleg DIREKT auf die uebergebene Leg-Referenz? Exakte Gleichheit auf
// einer global eindeutigen Provider-ID - der staerkste Zugehoerigkeitsbeweis hier.
function matchesAnchor(raw, legId) {
  return Boolean(raw[ANCHOR_ID_FIELD]) && String(raw[ANCHOR_ID_FIELD]) === legId;
}

// Stufe 1, aufgesammelt: die Provider-Sessions, die beweisbar zu diesem Call gehoeren.
// LEERE Menge = kein Anker in der Antwort; dann akzeptiert Stufe 2 NICHTS. Genau diese
// Asymmetrie ist gewollt: ein fehlender Beleg heisst spaeter nur 'incomplete', ein FREMDER
// Beleg waere eine Fehlbuchung auf einen fremden Tenant. Waehrung, Zeitfenster und Kosten
// spielen hier bewusst keine Rolle - diese Stufe beantwortet nur "welche Session ist unsere",
// nicht "ist der Beleg buchbar" (das entscheidet toCostRecord, je Beleg).
function anchoredSessionIds(rawRecords, legId) {
  const sessionIds = new Set();
  for (const raw of rawRecords) {
    if (!matchesAnchor(raw, legId)) continue;
    for (const ref of recordSessionRefs(raw)) sessionIds.add(ref.id);
  }
  return sessionIds;
}

// Stufe 2: gehoert der Beleg zum Call? { via } = ja, und zwar ueber DIESEN Weg (Anker oder
// konkretes Session-Feld); { reason } = nein, mit dem PII-freien Ablehnungsgrund. Der Weg
// wird mitgegeben, nicht nur das Ja: nur getrennt gezaehlt zeigt das Log, wie viele Belege
// allein an einem Session-Feld haengen - die Groesse, die bei einer nicht call-lokalen ID
// von fail-closed nach fail-OPEN kippt.
// BEWUSSTE GRENZE: die Typen aus UNASSIGNABLE_COST_RECORD_TYPES tragen weder Anker noch
// Session (heute `inference`: nur conversation_id). Sie bleiben unzuordenbar
// (session_unresolved) und fehlen in der Summe; im Messfenster 2026-07-21 waren das
// 0,000000 USD. Die Zuordnung dafuer aufzuweichen waere der teure Fehler, nicht der
// fehlende Beleg - deshalb verbietet der Boot-Guard sie stattdessen als Pflicht-Typ.
function assignmentOutcome(raw, { legId, sessionIds }) {
  if (matchesAnchor(raw, legId)) return { via: ANCHOR_ROUTE };
  const refs = recordSessionRefs(raw);
  if (refs.length === 0) return { reason: "session_unresolved" };
  const hit = refs.find((ref) => sessionIds.has(ref.id));
  return hit ? { via: hit.field } : { reason: "session_mismatch" };
}

// Client-seitiger Zusatzfilter gegen das Anrufsfenster (Design-Entscheidung P1): kein
// aufloesbares/parsebares Zeitstempel-Feld -> NICHT ablehnen (die Zuordnung ueber Anker/
// Session in toCostRecord bleibt der primaere Riegel; ein fehlendes Feld ist keine
// Erkenntnis ueber die Zeit, konservativ = durchlassen statt raten).
function withinRecordWindow(raw, startedAt, endedAt) {
  const rawTimestamp = RECORD_TIMESTAMP_FIELDS.map((field) => raw[field]).find(Boolean);
  if (!rawTimestamp) return true;
  const t = Date.parse(rawTimestamp);
  if (Number.isNaN(t)) return true;
  return t >= Date.parse(startedAt) && t <= Date.parse(endedAt);
}

// Roh-Record -> Port-Record (mit dem Zuordnungsweg `via`) oder Ablehnungsgrund (beides fuer
// die PII-freien Zaehler in getVoiceCostRecords). EINE Gueltigkeitsquelle je Record, in
// dieser Reihenfolge: Waehrung, Zuordnung (Anker/Session), Zeitfenster, Kosten - jeder
// Zweig mit eigenem Grund.
function toCostRecord(raw, { legId, sessionIds, startedAt, endedAt }) {
  const currency = String(raw.currency || "").trim().toUpperCase();
  const expectedCurrency = String(config.billing.providerCurrency).trim().toUpperCase();
  if (!currency || currency !== expectedCurrency) return { reason: "currency_mismatch" };

  const assignment = assignmentOutcome(raw, { legId, sessionIds });
  if (assignment.reason) return { reason: assignment.reason };

  if (!withinRecordWindow(raw, startedAt, endedAt)) return { reason: "out_of_window" };

  const costMicroCents = parseDecimalToMicroCents(raw.cost);
  if (costMicroCents === null) return { reason: "cost_unparsable" };

  return {
    via: assignment.via,
    record: {
      recordType: raw.record_type,
      costMicroCents,
      currency,
      billedSec: parseNonNegativeInteger(raw.billed_sec),
      legId,
    },
  };
}

// Platzhalter, wenn der Fehler gar keine HTTP-Antwort hatte (Netzfehler/Timeout): die Zeile
// erscheint trotzdem - "kein Status" ist selbst ein Befund (Netz statt Provider-Ablehnung),
// und eine fehlende Zeile waere von "kein Fehler" nicht zu unterscheiden.
const MISSING_PROVIDER_FIELD = "none";

// PII-freie FEHLER-Spur des Belegabrufs (Gegenstueck zu logCostRecordsOk): Op-Name, der
// abgefragte record_type, Provider-Status und der allowlistete Telnyx-Code. Der Code kommt
// STRUKTURIERT vom Error (err.providerCode aus ./errors.js) - den Meldungstext zu parsen
// waere brittle, und der Text ist kein Vertrag. NIE der API-Key, NIE eine Rufnummer, NIE der
// Roh-Body, NIE eine Session-/Leg-ID: record_type ist ein Enumwert, Status und Code sind
// Provider-Metadaten. console.warn (nicht error) wie die uebrigen Kosten-Befunde in
// billing/cost-truing.js: der Abruf degradiert, der Call bleibt unvollstaendig - es bewegt
// sich kein Geld (G11).
function logCostRecordsFailure(recordType, err) {
  const status = err?.providerStatus ?? MISSING_PROVIDER_FIELD;
  const code = err?.providerCode ?? MISSING_PROVIDER_FIELD;
  console.warn(
    `[telnyx/voice] getVoiceCostRecords fehler typ=${recordType} status=${status} code=${code}`,
  );
}

// War das die LETZTE Seite dieses Typs? Autoritativ ist meta.total_pages AUS DER ANTWORT,
// nie die selbst angeforderte page[size]: gegen die eigene Anforderung zu pruefen
// bestaetigt nur, was man selbst gesendet hat - das war die tote Sicherung. Gemessen:
// meta = {total_results:212, total_pages:5, page_size:50} mit total_pages =
// ceil(total_results / page_size), bei leerer Menge 0.
// Kein brauchbares total_pages (fehlt, kein Zahlwert, Provider-Drift): eine KURZE Seite
// kann keine Fortsetzung haben - der Provider haette sie sonst gefuellt; eine VOLLE Seite
// ist unbewiesen und wird weitergeblaettert, bis eine kurze Seite oder die
// Seitenobergrenze entscheidet. Bis KE-P1 war genau dieser Fall sofort ok:false - die
// Seitenschleife beantwortet ihn EMPIRISCH statt ihn zu vermuten, das ist mehr Wissen,
// nicht weniger.
// Die umgekehrte Regel ("kurze Seite gewinnt gegen meta") waere die fail-OPEN-Richtung:
// sie beendete den Einzug zu frueh und lieferte eine stille Untermenge als vollstaendig.
function isLastPage(records, meta, pageNumber) {
  const totalPages = parseNonNegativeInteger(meta?.total_pages);
  if (totalPages !== null) return pageNumber >= totalPages;
  return records.length < COST_RECORDS_PAGE_SIZE;
}

// Wartehinweis einer Kontingent-Ablehnung: x-ratelimit-reset traegt die SEKUNDEN bis zur
// naechsten vollen Minute (Plan F1; ein Retry-After gibt es bei Telnyx nicht). Fehlender,
// leerer oder unbrauchbarer Header -> null; dann rechnet die Drossel dieselbe Groesse aus
// der eigenen Uhr. parseNonNegativeInteger ist derselbe strenge Zahl-Parser wie fuer
// billed_sec (G5) - ein "17,5" oder "bald" darf nie als Wartezeit durchgehen.
function rateLimitResetHintMs(res) {
  const seconds = parseNonNegativeInteger(res?.headers?.get?.(RATE_LIMIT_RESET_HEADER));
  return seconds === null ? null : seconds * MS_PER_SECOND;
}

// Eine Typ-/SEITEN-Abfrage gegen /v2/detail_records. Wirft NICHT: Ergebnis-Objekt wie die
// Port-Methode selbst (G31). Erlaubte Server-Parameter sind AUSSCHLIESSLICH
// filter[record_type], page[size] und page[number] - mehr nicht. JEDER weitere
// filter[...]-Parameter ist verboten, solange keine Messung ihn belegt: ein falscher
// Filtername liefert HTTP 200 mit 0 Treffern, KEINEN Fehler (gemessen 2026-07-21:
// filter[created_at][gte] auf sip-trunking -> 200/0, obwohl das Feld dort nicht existiert;
// filter[started_at] auf speech-to-text -> 0 Treffer trotz 89 Datensaetzen, weil das
// Zeitfeld dort start_time heisst) - stiller Datenverlust, der wie eine leere Menge
// aussieht. Das Zeitfenster geht deshalb NIE als Query hinaus: `since` bindet allein, wie
// weit geblaettert wird (fetchRecordTypePages), die Fensterpruefung je Beleg bleibt
// client-seitig in toCostRecord.
// Jeder Wurf und jedes rejectende fetch (Netzfehler/Timeout) wird zu
// { ok:false, reason:"provider_error" } - unveraendert; SICHTBAR seit KE-P0 ueber
// logCostRecordsFailure (Status + Telnyx-Code, PII-frei).
// KE-P4: JEDE Anfrage reserviert vorher einen Slot der Drossel (gemessenes Kontingent, s.
// DETAIL_RECORDS_BUDGET_PER_MINUTE). Die Reservierung steht INNERHALB des try - der Port
// WIRFT NIE, auch nicht, wenn die injizierte Uhr/das Warten scheitert.
// Rueckgabe ist ein Zwei-Feld-Umschlag: `page` ist das Ergebnis wie bisher, `rateLimit`
// ({hintMs} | null) ist ALLEIN die Wiederholungs-Entscheidung des direkten Aufrufers und
// verlaesst diese Datei nie. Der Hinweis wird VOR assertTelnyxOk aus den Headern gelesen:
// der Wurf traegt nur Status und Telnyx-Code (strikte Allowlist in ./errors.js), die
// Antwort selbst ist danach nicht mehr erreichbar.
async function attemptCostRecordPage(recordType, pageNumber, throttle) {
  const q = new URLSearchParams();
  q.set("filter[record_type]", recordType);
  q.set("page[size]", String(COST_RECORDS_PAGE_SIZE));
  q.set("page[number]", String(pageNumber));
  let rateLimit = null;
  try {
    await throttle.reserveSlot();
    const res = await fetch(`${config.telephony.telnyxApiBase}${DETAIL_RECORDS_BASE}?${q}`, {
      headers: headers(),
    });
    if (res.status === RATE_LIMITED_STATUS) rateLimit = { hintMs: rateLimitResetHintMs(res) };
    await assertTelnyxOk(res, "getVoiceCostRecords", ATTACH_STATUS);
    const { data, meta } = await parseTelnyxBody(res);
    if (!Array.isArray(data)) return { page: { ok: false, reason: "shape_unexpected" }, rateLimit: null };
    return { page: { ok: true, raw: data, lastPage: isLastPage(data, meta, pageNumber) }, rateLimit: null };
  } catch (err) {
    logCostRecordsFailure(recordType, err);
    return { page: { ok: false, reason: "provider_error" }, rateLimit };
  }
}

// Eine Seite mit GENAU EINER Wiederholung nach einer Kontingent-Ablehnung: nach dem Reset
// auf :00 ist das Fenster frei, ein zweiter Fehlschlag ist dann kein Timing-Problem mehr,
// sondern ein fremder Verbraucher am selben Kontingent (Plan U5). Danach fail-closed
// ok:false - eine Wiederholungs-SCHLEIFE gegen ein Kontingent ist genau der Mechanismus,
// der live 184 von 224 Anfragen verbrannt hat. Der Fehlerpfad bleibt unveraendert
// ({ok:false, reason:"provider_error"}), er wird nur je Versuch geloggt.
async function fetchCostRecordPage(recordType, pageNumber, throttle) {
  const attempt = await attemptCostRecordPage(recordType, pageNumber, throttle);
  if (!attempt.rateLimit) return attempt.page;
  await throttle.waitForWindowReset(attempt.rateLimit.hintMs);
  return (await attemptCostRecordPage(recordType, pageNumber, throttle)).page;
}

// Neuester GEMESSENER Zeitstempel eines Belegs in Millisekunden, oder null. Nur die je Typ
// gemessenen Feldnamen zaehlen (COST_RECORD_TIME_FIELDS) - ein generischer Feld-Scan waere
// genau die Fehlerklasse, an der diese Kette zweimal gestorben ist. NEUESTER, nicht
// erster: ein Beleg, der vor `since` beginnt und danach endet, gehoert noch ins Fenster.
// Nicht-Strings werden verworfen (Date.parse(123) ergaebe sonst eine Jahreszahl).
function newestRecordTimestampMs(raw, recordType) {
  let newest = null;
  for (const field of COST_RECORD_TIME_FIELDS[recordType] || []) {
    if (typeof raw[field] !== "string") continue;
    const ms = Date.parse(raw[field]);
    if (Number.isNaN(ms)) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

// Darf die Seitenschleife hier enden? NUR wenn die GANZE Seite beweisbar aelter als
// `since` ist. Der Abbruch am ERSTEN Beleg ausserhalb waere eine Sortier-Annahme: die
// Sortierreihenfolge ist fuer 6 von 7 Typen UNBELEGT (nur sip-trunking ist als absteigend
// gemessen, und sort= ist dort wirkungslos). Ein Beleg OHNE gemessenes Zeitfeld gilt als
// innerhalb - ein fehlendes Feld ist keine Erkenntnis ueber die Zeit (dieselbe Regel wie
// withinRecordWindow). Leere Seite = kein Beleg = kein Beweis.
// RESTRISIKO, bewusst benannt: liegt eine Seite vollstaendig ausserhalb und eine spaetere
// doch wieder innerhalb, endet der Einzug zu frueh. Das setzt eine grob monotone
// Sortierung voraus - die deutlich schwaechere Annahme gegenueber "erster Beleg
// ausserhalb", und sie greift ueberhaupt erst, wenn ein Aufrufer `since` setzt (KE-P5).
function isPageBeforeSince(rawPage, recordType, sinceMs) {
  if (sinceMs === null || rawPage.length === 0) return false;
  return rawPage.every((raw) => {
    const ms = newestRecordTimestampMs(raw, recordType);
    return ms !== null && ms < sinceMs;
  });
}

// Alle Seiten EINES Typs, aufsteigend ab FIRST_PAGE_NUMBER. Drei Ausgaenge, alle explizit:
// (1) letzte Seite erreicht ODER die ganze Seite liegt vor `since` -> complete:true;
// (2) Seitenobergrenze erreicht -> complete:false, eine BEWIESENE Untermenge;
// (3) eine Seite scheitert -> ok:false, kein Teil-Erfolg.
// `since` filtert den Pool NIE - es bindet nur, wie weit geblaettert wird. Was geholt
// wurde, kommt vollstaendig in den Pool; ueber die Zugehoerigkeit entscheidet allein die
// Zuordnung (assignCostRecords), unveraendert.
async function fetchRecordTypePages(recordType, sinceMs, throttle) {
  const raw = [];
  const lastAllowedPage = FIRST_PAGE_NUMBER + MAX_PAGES_PER_RECORD_TYPE - 1;
  for (let pageNumber = FIRST_PAGE_NUMBER; pageNumber <= lastAllowedPage; pageNumber++) {
    const page = await fetchCostRecordPage(recordType, pageNumber, throttle);
    if (!page.ok) return page;
    raw.push(...page.raw);
    if (page.lastPage || isPageBeforeSince(page.raw, recordType, sinceMs))
      return { ok: true, raw, complete: true };
  }
  return { ok: true, raw, complete: false };
}

// Alle Roh-Belege der ZUORDENBAREN Typen einsammeln - die Zuordnung entscheidet erst auf
// der VOLLEN Antwort (Stufe 1 findet den Anker moeglicherweise erst im letzten Typ).
// Die Typenliste ist aus ASSIGNABLE_COST_RECORD_TYPES ABGELEITET, nicht von Hand gepflegt
// (G27) - dieselbe Menge, gegen die der Boot-Guard die Pflicht-Typen prueft. Die Belege
// der uebrigen Typen (heute `inference`: nur conversation_id) werden ausnahmslos als
// session_unresolved verworfen; sie zu holen ist eine Anfrage ohne jeden Ertrag.
// KEIN Teil-Erfolg: der erste nicht-ok-Ausgang bricht ab. Auch der erste UNVOLLSTAENDIGE
// Typ bricht ab - complete:false macht den ganzen Pool unbrauchbar (bookablePool in
// billing/cost-truing.js uebersetzt es an genau EINER Stelle in ok:false), die restlichen
// Typen zu holen waere reine Verschwendung.
async function fetchAllCostRecords(sinceMs, throttle) {
  const rawRecords = [];
  for (const recordType of ASSIGNABLE_COST_RECORD_TYPES) {
    const pages = await fetchRecordTypePages(recordType, sinceMs, throttle);
    if (!pages.ok) return pages;
    rawRecords.push(...pages.raw);
    if (!pages.complete) return { ok: true, raw: rawRecords, complete: false };
  }
  return { ok: true, raw: rawRecords, complete: true };
}

// Zuordnungswege als feste Spalten, in ASSIGNMENT_ROUTES-Reihenfolge und immer vollzaehlig
// (fehlender Weg = 0). An diesem Format haengt die laufende Beobachtung der Session-
// Invariante (tasks/lct-DEPLOY-CHECKLIST.md) und es ist deshalb testgepinnt.
function formatAssignmentRoutes(acceptedByRoute) {
  return ASSIGNMENT_ROUTES.map((route) => `via_${route}=${acceptedByRoute[route] || 0}`).join(" ");
}

// PII-freier Erfolgs-Log fuer getVoiceCostRecords (OBS-2-Linie wie logCallControlOk): Op-Name,
// Anzahl akzeptierter Records, dieselbe Anzahl je Zuordnungsweg + Ablehnungsgruende. Alles
// Zaehler, nie Werte: NIE eine call_control_id, NIE eine Session-ID, NIE legId, NIE eine
// Rufnummer, NIE der Key (Regel 4/5). via_anchor=0 bei records=0 heisst "kein Beleg kam ueber
// den Anker herein" (Anker fehlte oder fiel vorher an Waehrung/Zeitfenster); jede Zahl in
// einer via_<Session-Feld>-Spalte zaehlt Belege, die AUSSCHLIESSLICH die Session-Annahme
// hereingelassen hat - genau die Groesse, die die Auflage vor dem ersten Deploy gegen das
// Telnyx-Portal gegenprueft.
function logCostRecordsOk({ recordCount, acceptedByRoute, rejectedByReason }) {
  console.log(
    `[telnyx/voice] getVoiceCostRecords ok records=${recordCount} ${formatAssignmentRoutes(acceptedByRoute)} rejected=${JSON.stringify(rejectedByReason)}`,
  );
}

// `since` bindet AUSSCHLIESSLICH die Seitenschleife - es filtert NIE den Pool und geht NIE
// als Query-Parameter hinaus (s. attemptCostRecordPage). Fehlend oder unbrauchbar -> null =
// keine Schranke: das kostet Anfragen, kann aber keinen Beleg verlieren. Die
// fail-OPEN-Richtung waere ein zu SPAETES since, nicht ein fehlendes.
function parseSinceMs(since) {
  if (typeof since !== "string") return null;
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? null : ms;
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

  // Roh-Belege EINES Sweeps (KE-P2). Der Abruf ist SCHLEIFENINVARIANT: die Query kennt nur
  // filter[record_type] + page[size] + page[number] - kein legId. Jeder Kandidat holte
  // bisher exakt dieselben Daten. Deshalb laeuft er EINMAL je Sweep VOR der
  // Kandidatenschleife (billing/cost-truing.js); die ZUORDNUNG bleibt je Call
  // (assignCostRecords). OPTIONAL am Port, Telnyx-only (Twilios price deckt nur
  // Connectivity - dieselbe Signatur mit anderer Semantik waere schlimmer als keine).
  //
  // WIRFT NIE. Rueckgabe ist ein ERGEBNIS-OBJEKT (G31): ok:false heisst NIEMALS "Kosten = 0".
  //
  // `since` ist ab KE-P3 WIRKSAM: es bindet die Seitenschleife (parseSinceMs), nie die
  // Query und nie den Pool-Inhalt. Bis KE-P5 setzt es kein Aufrufer - ohne Schranke wird
  // je Typ bis zur letzten Seite oder bis zur Seitenobergrenze geblaettert.
  // complete:false heisst "bewiesene Untermenge" und ist fuer den Verbraucher dasselbe wie
  // ok:false (bookablePool) - nie eine Rueckerstattungsgrundlage.
  //
  // KE-P4: jede Anfrage laeuft durch die Drossel am gemessenen Minutenfenster. `throttle`
  // ist ein Konstruktions-Parameter mit Produktions-Default (Muster src/llm.js: sleep/
  // random/now injizierbar, Default eingebaut): produktive Aufrufer setzen ihn NIE, der
  // Test injiziert eine Sprung-Uhr, statt eine reale Minute zu warten (F.I.R.S.T.).
  async fetchCostRecordPool({ since, throttle = detailRecordsThrottle } = {}) {
    if (!config.telephony.telnyxApiKey) return { ok: false, reason: "config_missing" };
    return fetchAllCostRecords(parseSinceMs(since), throttle);
  },

  // Ordnet die Roh-Belege EINES Pools genau EINEM Call zu. SYNCHRON und ohne Netz - zwischen
  // Pool-Abruf und Buchungsschleife darf kein weiteres Netz-await liegen (PM-5). Die Logik ist
  // aus der frueheren getVoiceCostRecords VERSCHOBEN, nicht veraendert.
  //
  // ZWEISTUFIGE Zuordnung: Stufe 1 sucht die Belege mit call_control_id === legId und sammelt
  // deren Session-IDs, Stufe 2 akzeptiert alles, was in dieser Session liegt. KEIN Anker
  // gefunden -> leere Session-Menge -> LEERE Record-Liste bei ok:true (fail-closed, nie ein
  // lockererer Fallback). Das Zeitfenster ist dahinter KEINE zweite Linie: seine Query-
  // Parameternamen sind unbelegt (Kap. 2.6), und der client-seitige Filter
  // (withinRecordWindow) findet auf den gemessenen Belegformen nicht jeden Beleg erreicht.
  // Bei PARALLEL laufenden Calls traegt deshalb allein die Call-Lokalitaet der Session (s.
  // SESSION_ID_FIELDS) - konto-weit gemessen, aber nie unter Parallelverkehr. Die via_-
  // Zaehler im Log machen den Anteil der rein ueber die Session angenommenen Belege
  // dauerhaft sichtbar (s. tasks/lct-DEPLOY-CHECKLIST.md).
  //
  // Das Op-/Log-Token beider Methoden bleibt "getVoiceCostRecords" (logCostRecordsOk/
  // logCostRecordsFailure/assertTelnyxOk): an dieser Zeichenkette haengen die laufende
  // Beobachtung der Session-Invariante und die Live-Abnahme (tasks/lct-DEPLOY-CHECKLIST.md).
  // Das FORMAT wird ergaenzt, nie umgebaut - ein Rename waere Kosmetik gegen eine
  // geld-relevante Sonde.
  assignCostRecords(pool, { legId, startedAt, endedAt } = {}) {
    if (!legId || !startedAt || !endedAt) return { ok: false, reason: "params_missing" };
    // Ein Pool ohne Rohbelege ist keine Messung, sondern eine fehlende Messung: ok:false
    // statt Wurf (der Port WIRFT NIE) und NIEMALS eine leere Record-Liste, die wie
    // "gemessen, 0 Kosten" aussaehe.
    if (!Array.isArray(pool?.raw)) return { ok: false, reason: "pool_missing" };

    const sessionIds = anchoredSessionIds(pool.raw, legId);
    const records = [];
    const acceptedByRoute = {};
    const rejectedByReason = {};
    for (const raw of pool.raw) {
      const outcome = toCostRecord(raw, { legId, sessionIds, startedAt, endedAt });
      if (outcome.record) {
        records.push(outcome.record);
        acceptedByRoute[outcome.via] = (acceptedByRoute[outcome.via] || 0) + 1;
      } else {
        rejectedByReason[outcome.reason] = (rejectedByReason[outcome.reason] || 0) + 1;
      }
    }
    logCostRecordsOk({ recordCount: records.length, acceptedByRoute, rejectedByReason });
    return { ok: true, records };
  },
};
