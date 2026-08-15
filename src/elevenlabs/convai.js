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
// Bleibt der DEFAULT fuer jeden Aufruf, der keine eigene Frist mitbringt (Anrufstart,
// Loeschversuch, der regulaere Poll-Takt). Exportiert, damit ein kuerzerer Override
// (s. timeoutMs unten, gebraucht von elevenlabs/outbound.js#endActiveCall, S1-3) sich
// gegen DIESEN Wert bezeugen laesst, statt eine zweite Zahl zu raten.
export const REQUEST_TIMEOUT_MS = 120000;

// Wirft MIT Status: routes/api-calls.js unterscheidet daran die Anbieter-Ablehnung (502)
// vom Transportfehler (500) - genau wie beim Telnyx-Adapter (attachStatus).
function assertConvaiOk(res, op) {
  if (res.ok) return;
  const err = new Error(`ElevenLabs ${op} fehlgeschlagen: HTTP ${res.status}`);
  err.providerStatus = res.status;
  throw err;
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
 * Startet den Anruf beim Anbieter. Liefert die SYNCHRON zurueckgegebene conversation_id
 * (null, wenn der Anbieter keine mitschickt - der Aufrufer behandelt das als Fehlschlag).
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, body: object}} args
 */
export async function startOutboundCall({ fetchImpl, account, body }) {
  const antwort = await convaiFetch({
    fetchImpl,
    account,
    path: OUTBOUND_CALL_PATH,
    op: "Anrufstart",
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return antwort.conversation_id || null;
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
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, conversationId: string}} args
 * @returns {Promise<{accepted: boolean, status: number|null}>}
 */
export async function endConversation({ fetchImpl, account, conversationId }) {
  try {
    const res = await fetchImpl(
      `${account.apiBase}${CONVERSATION_PATH}${encodeURIComponent(conversationId)}`,
      {
        method: "DELETE",
        headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    return { accepted: res.ok, status: res.status };
  } catch {
    return { accepted: false, status: null };
  }
}
