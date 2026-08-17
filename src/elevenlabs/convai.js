// ---- ElevenLabs Convai: der EINE HTTP-Zugang des Anrufstart-Zweigs -------------------
// Drei Endpunkte, mehr braucht der Weg nicht: den Anrufstart (POST), den ziehenden
// Ergebnisabruf (GET) und den Beende-Versuch (DELETE, Owner-Auftrag 15.08.2026). Rein
// IO-injiziert (fetchImpl kommt vom Aufrufer, DIP wie src/tts/synth.js) - der Zweig
// laesst sich damit gegen eine Attrappe fahren, ohne dass je ein echter Anruf entsteht.
//
// KEIN RETRY, bewusst (Absolute Regel 1): ein wiederholter Anrufstart ist ein zweiter
// ECHTER Anruf beim selben Menschen. Der Fehlschlag gehoert deshalb dem Aufrufer, der
// den Call sauber beendet - nicht einer Schleife hier. Der Ergebnisabruf wiederholt sich
// sehr wohl, aber als Takt des Aufrufers (ELEVENLABS_RESULT_POLL_MS), nicht als
// verborgener Retry in diesem Modul. Der Beende-Versuch (endConversation) wiederholt sich
// NIE - er ist selbst schon fail-soft (s. dort) und braucht keinen zweiten Anlauf.
//
// TIMEOUT dagegen ist Pflicht: fetch kennt von sich aus keins. Ein stummer Anbieter
// hielte sonst den /api/calls-Request unbegrenzt offen - der Aufrufer bekaeme weder eine
// Antwort noch einen beendeten Call.
//
// Der Fehler-RUMPF des Anbieters wird NIE gelesen und NIE weitergereicht (Absolute Regel
// 4/5): er kann Nummern-/Auth-Fragmente tragen, und fuer die Kategorisierung reicht der
// Status. Weitergegeben wird ausschliesslich err.providerStatus.

const OUTBOUND_CALL_PATH = "/v1/convai/sip-trunk/outbound-call";
const CONVERSATION_PATH = "/v1/convai/conversations/";
const API_KEY_HEADER = "xi-api-key";

// Interner Transport-Bound, kein Operator-Knopf (Praezedenz ERROR_DETAIL_MAX_LEN in
// telephony/adapters/telnyx/errors.js): grosszuegig genug fuer einen SIP-Anrufstart,
// klein genug, dass ein stummer Anbieter keinen Aufrufer haengen laesst.
//
// GEMESSEN am 15.08.2026, nicht geraten: der Anrufstart ist BLOCKIEREND ueber die ganze
// Klingelphase - er antwortet erst, wenn der SIP-INVITE seine endgueltige Antwort hat.
// Zwei Messungen:
//   - unerreichbares Ziel (+15550000000, SIP 404): Antwort nach 1,05 s;
//   - echter Anruf call_msu77zi51zxw: unser Request lief 09:53:50,7Z los, das Ziel hob
//     erst 09:54:31Z ab - 40,3 s blosses Klingeln. Bei 15 s hatte der Anbieter noch
//     nicht geantwortet, wir brachen WAEHREND des Klingelns ab, und das Gespraech kam
//     danach trotzdem zustande (conv_6801m02df3tfett9vv6jwn8fw8q0, 7 s). Der Abbruch
//     verhindert den Anruf also nicht, er kappt nur unsere Kennung: der Record wurde
//     failed und abgerechnet, ohne conversation_id und ohne je einen Ergebnisabruf.
// 15 s waren damit kuerzer als das blosse Klingeln. Der Wert muss die Klingelphase
// tragen, und deren Obergrenze ist die Waehlfrist der Plattform (telnyxDialTimeoutSecs,
// Default 60 s) - nicht die Gespraechsdauer. 120 s = diese 60 s plus Reserve, und
// weiterhin ein Vielfaches unter der Max-Gespraechsdauer (1800 s): ein stummer Anbieter
// kann einen Aufrufer damit nie ueber ein ganzes Gespraech haengen lassen.
//
// Bleibt der DEFAULT fuer jeden Aufruf, der keine eigene Frist mitbringt (Anrufstart, der
// regulaere Poll-Takt). Exportiert, damit ein kuerzerer Override (s. timeoutMs unten,
// gebraucht von elevenlabs/outbound.js#endActiveCall fuer BEIDE Anbieter-Aufrufe des
// Abbruch-Pfades - Ergebnisabruf UND Loeschversuch, S1-C) sich gegen DIESEN Wert bezeugen
// laesst, statt eine zweite Zahl zu raten.
export const REQUEST_TIMEOUT_MS = 120000;

// Wirft MIT Status: routes/api-calls.js unterscheidet daran die Anbieter-Ablehnung (502)
// vom Transportfehler (500) - genau wie beim Telnyx-Adapter (attachStatus).
function assertConvaiOk(res, op) {
  if (res.ok) return;
  const err = new Error(`ElevenLabs ${op} fehlgeschlagen: HTTP ${res.status}`);
  err.providerStatus = res.status;
  throw err;
}

// ---- Weisse Liste: conversation_config_override (Owner-Entscheidung 16.08.2026) -------
// Ersetzt den bisherigen Wortlaut "conversation_config_override wird nicht benutzt".
// PRO ANRUF duerfen an diesem Anbieter-Feld AUSSCHLIESSLICH zwei Dinge gesetzt werden -
// die Sprache (agent.language) und die Stimme (tts.voice_id). Jede andere Ueberschreibung
// ist verboten. Die geschuetzte EIGENSCHAFT ist nicht der Pfad, sondern: NIEMAND darf den
// Agenten pro Anruf unbemerkt umbauen (Systemprompt, Werkzeuge, ASR-Keywords,
// Text-only-Modus, ...) - dieselbe Eigenschaft wie bisher, nur genauer durchgesetzt.
// Pfadnamen aus dem Anbieter-Schema (ConversationConfigClientOverride, s.
// elevenlabs-openapi.json, 16.08.2026 gemessen), nicht geraten.
//
// NUR DER WAECHTER, NICHT DIE FUNKTION: dieses Modul WAEHLT keine Sprache/Stimme - kein
// Aufrufer setzt heute ein Override-Objekt (elevenlabs/outbound.js#dynamicVariables baut
// keins). Der Waechter sitzt trotzdem bereits hier, direkt vor dem einzigen Netzzugriff
// dieses Wegs, damit jeder KUENFTIGE Aufrufer ihn automatisch durchlaeuft - ein Waechter,
// der erst mit der Funktion zusammen entstuende, liesse genau das Zeitfenster offen, in
// dem hier schon zwei Defekte entstanden sind.
//
// FAIL-CLOSED, NICHT FILTERND: ein verbotener Pfad wird NICHT still entfernt und der Rest
// trotzdem gesendet (ein stiller Filter ist derselbe Fehler wie einst bei
// context.open_questions) - er bricht den GESAMTEN Anrufstart ab, bevor der Anbieter den
// Koerper sieht.
// EXPORTIERT (TEIL 3, Owner-Auftrag 16.08.2026): die EINE Quelle, gegen die
// test/elevenlabs-override-whitelist.test.js die Besitz-Karte des Anbieters
// (elevenlabs/agent_configs/outbound-agent.template.json,
// platform_settings.overrides.conversation_config_override) haelt - zwei getippte
// Kopien derselben zwei Pfade koennten sonst auseinanderlaufen, ohne dass irgendein Test
// es bemerkt (G5).
export const OVERRIDE_ALLOWED_LEAF_PATHS = Object.freeze(["agent.language", "tts.voice_id"]);
const OVERRIDE_PATH_SEPARATOR = ".";

function isPlainObject(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

// Alle BLATT-Pfade eines Override-Objekts, punktgetrennt. "Blatt" = kein weiteres
// Objekt darunter (ein Array-Wert wie asr.keywords zaehlt selbst als Blatt - kein
// Array-Pfad steht auf der Whitelist, ein Aufloesen der Eintraege braechte nichts). Ein
// leeres Objekt traegt keinen Blatt-Pfad: nichts gesetzt, nichts zu verbieten.
function overrideLeafPaths(wert, prefix) {
  if (!isPlainObject(wert)) return prefix.length ? [prefix.join(OVERRIDE_PATH_SEPARATOR)] : [];
  return Object.entries(wert).flatMap(([schluessel, kind]) =>
    overrideLeafPaths(kind, [...prefix, schluessel]),
  );
}

// Wirft, wenn der Anfragekoerper ETWAS AUSSER den zwei erlaubten Pfaden setzt -
// EINSCHLIESSLICH eines Override-Werts, der gar kein Objekt ist (eine kaputte Form ist
// selbst ein Verstoss, kein stilles "nichts zu pruefen"). callId dient NUR dem Log
// (Regel 4/5: keine Rufnummer, kein Schluessel, kein Anfragekoerper).
function assertOverrideWhitelisted(body, callId) {
  const override = body?.conversation_initiation_client_data?.conversation_config_override;
  if (override === undefined || override === null) return;
  const verboten = isPlainObject(override)
    ? overrideLeafPaths(override, []).filter((pfad) => !OVERRIDE_ALLOWED_LEAF_PATHS.includes(pfad))
    : ["(conversation_config_override ist kein Objekt)"];
  if (verboten.length === 0) return;
  console.error(
    `[el-outbound] conversation_config_override abgelehnt (call=${callId}): verbotene(r) Pfad(e) ${verboten.join(", ")} - erlaubt sind ausschliesslich ${OVERRIDE_ALLOWED_LEAF_PATHS.join(", ")}`,
  );
  throw new Error(
    `ElevenLabs-Anrufstart abgebrochen: conversation_config_override enthaelt nicht erlaubte(n) Pfad(e) (${verboten.join(", ")})`,
  );
}

// EINE Stelle fuer Basis-URL, Schluessel-Header, Timeout und Fehlerpruefung (G5): beide
// Endpunkte unterscheiden sich nur in Pfad und Methode. timeoutMs optional (Default
// REQUEST_TIMEOUT_MS) - ein Aufrufer mit eigener, kuerzerer Frist (S1-3) ueberschreibt sie
// gezielt, ohne den Bestandswert fuer alle anderen Aufrufer zu senken.
async function convaiFetch({ fetchImpl, account, path, op, init, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const res = await fetchImpl(`${account.apiBase}${path}`, {
    ...init,
    headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  assertConvaiOk(res, op);
  return res.json();
}

/**
 * Die BEIDEN Kennungen der Anrufstart-Antwort (Anbieter-Schema
 * SIPTrunkOutboundCallResponse: success, message, conversation_id, sip_call_id) in
 * unserer Schreibweise. Fehlt eine, ist sie null - nie undefined, damit der Aufrufer
 * genau eine Leerform kennt.
 *
 * WARUM sip_call_id ueberhaupt gelesen wird (am 17.08.2026 an einem echten Anruf
 * belegt, s. .fortschritt.md): es ist die SIP-Call-ID des ausgehenden Legs, in der Form
 * "otb_...". DENSELBEN Wert fuehrt der Telefonie-Beleg von Telnyx
 * (GET /v2/detail_records, record_type sip-trunking) als sip_call_id, und der
 * Gespraechs-Datensatz des Anbieters traegt ihn als metadata.phone_call.call_id. Er ist
 * damit der EINZIGE Join zwischen den beiden Kostenquellen dieses Wegs: die alte
 * Kosten-Kette jointe ueber call_control_id + telnyx_session_id, und BEIDES existiert
 * auf der SIP-Trunk-Strecke nicht (call_control_id steht im Beleg leer,
 * is_callcontrol: false). Aus conversation_id ist er NICHT berechenbar - beide teilen
 * nur einen Zeitstempel-Anteil.
 *
 * EXPORTIERT, weil die Trockenlege-Attrappe (elevenlabs/outbound.js#
 * fakeSipTrunkOutboundCallResponse) in der FORM DES ANBIETERS antwortet und durch GENAU
 * DIESE Uebersetzung gelesen wird - eine zweite, dort getippte Zuordnung derselben zwei
 * Feldnamen koennte von dieser abdriften (G5), und der Fake wuerde dann etwas anderes
 * liefern als der echte Weg.
 */
export function startResultOf(antwort) {
  return {
    conversationId: antwort?.conversation_id || null,
    sipCallId: antwort?.sip_call_id || null,
  };
}

/**
 * Startet den Anruf beim Anbieter. Liefert die SYNCHRON zurueckgegebenen Kennungen
 * (s. startResultOf: conversationId null, wenn der Anbieter keine mitschickt - der
 * Aufrufer behandelt das als Fehlschlag).
 * WIRFT VOR JEDEM Netzzugriff, wenn body.conversation_initiation_client_data.
 * conversation_config_override etwas ausserhalb der Whitelist setzt (s.
 * assertOverrideWhitelisted oben) - callId dient nur diesem Log, kein Fachwert.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, body: object,
 *   callId?: string}} args
 * @returns {Promise<{conversationId: string|null, sipCallId: string|null}>}
 */
export async function startOutboundCall({ fetchImpl, account, body, callId }) {
  assertOverrideWhitelisted(body, callId);
  const antwort = await convaiFetch({
    fetchImpl,
    account,
    path: OUTBOUND_CALL_PATH,
    op: "Anrufstart",
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return startResultOf(antwort);
}

/**
 * Holt den Stand eines Gespraechs (status, transcript, analysis). timeoutMs optional
 * (S1-3): Default REQUEST_TIMEOUT_MS (Bestandsverhalten fuer den regulaeren Poll-Takt);
 * der ABBRUCH-Pfad (elevenlabs/outbound.js#endActiveCall) uebergibt eine eigene, kuerzere
 * Frist, weil terminateAndBillCall synchron auf diesen Abruf wartet.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, conversationId: string, timeoutMs?: number}} args
 */
export function fetchConversation({ fetchImpl, account, conversationId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVERSATION_PATH + encodeURIComponent(conversationId),
    op: "Gespraechsabruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

/**
 * Beende-Versuch beim Anbieter (DELETE /v1/convai/conversations/{id}): Kap-/cancel_call-
 * Pfad (telephony/call-termination.js#elevenLabsHangUpAction). FAIL-SOFT ANDERS ALS DIE
 * BEIDEN FUNKTIONEN OBEN (Owner-Auftrag 15.08.2026): sie wirft NIE - weder bei einer
 * Anbieter-Ablehnung (4xx/5xx, kein assertConvaiOk) noch bei Netzwerk-/Zeitablauf-Fehlern.
 * Ein fehlgeschlagener Loeschversuch darf den Abbruch unseres eigenen Datensatzes nicht
 * verhindern - ein Werkzeug, das an einem Anbieter-Ausfall haengen bleibt, waere schlimmer
 * als keins. Meldet NUR, ob der Anbieter den Versuch angenommen hat (HTTP-Status) - der
 * Fehler-RUMPF wird wie bei den beiden Funktionen oben NIE gelesen (Regel 4/5).
 *
 * OB das die Leitung tatsaechlich kappt, ist NICHT belegt (s. Modul-Kopf des Aufrufers,
 * elevenlabs/outbound.js) - diese Funktion beantwortet nur "hat der Anbieter den DELETE-
 * Aufruf angenommen", nicht "ist das Gespraech vorbei".
 *
 * timeoutMs optional (S1-C): Default REQUEST_TIMEOUT_MS. Der ABBRUCH-Pfad (elevenlabs/
 * outbound.js#endActiveCall) uebergibt seine eigene, kurze Frist - der Aufrufer WARTET auf
 * diesen DELETE (er ist der hangUp-Thunk von terminateAndBillCall), und mit dem Bestandswert
 * haengt ein stummer Anbieter Kappung UND cancel_call zwei volle Minuten. Die 120 s sind fuer
 * die SIP-Klingelphase des AnrufSTARTS bemessen (s.o.), nicht fuer diesen Ein-Zeilen-DELETE.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, conversationId: string, timeoutMs?: number}} args
 * @returns {Promise<{accepted: boolean, status: number|null}>}
 */
export async function endConversation({
  fetchImpl,
  account,
  conversationId,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  try {
    const res = await fetchImpl(
      `${account.apiBase}${CONVERSATION_PATH}${encodeURIComponent(conversationId)}`,
      {
        method: "DELETE",
        headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    return { accepted: res.ok, status: res.status };
  } catch {
    return { accepted: false, status: null };
  }
}
