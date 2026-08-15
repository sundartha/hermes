// ---- ElevenLabs Convai: der EINE HTTP-Zugang des Anrufstart-Zweigs -------------------
// Zwei Endpunkte, mehr braucht der Weg nicht: den Anrufstart (POST) und den ziehenden
// Ergebnisabruf (GET). Rein IO-injiziert (fetchImpl kommt vom Aufrufer, DIP wie
// src/tts/synth.js) - der Zweig laesst sich damit gegen eine Attrappe fahren, ohne dass
// je ein echter Anruf entsteht.
//
// KEIN RETRY, bewusst (Absolute Regel 1): ein wiederholter Anrufstart ist ein zweiter
// ECHTER Anruf beim selben Menschen. Der Fehlschlag gehoert deshalb dem Aufrufer, der
// den Call sauber beendet - nicht einer Schleife hier. Der Ergebnisabruf wiederholt sich
// sehr wohl, aber als Takt des Aufrufers (ELEVENLABS_RESULT_POLL_MS), nicht als
// verborgener Retry in diesem Modul.
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
const REQUEST_TIMEOUT_MS = 120000;

// Wirft MIT Status: routes/api-calls.js unterscheidet daran die Anbieter-Ablehnung (502)
// vom Transportfehler (500) - genau wie beim Telnyx-Adapter (attachStatus).
function assertConvaiOk(res, op) {
  if (res.ok) return;
  const err = new Error(`ElevenLabs ${op} fehlgeschlagen: HTTP ${res.status}`);
  err.providerStatus = res.status;
  throw err;
}

// EINE Stelle fuer Basis-URL, Schluessel-Header, Timeout und Fehlerpruefung (G5): beide
// Endpunkte unterscheiden sich nur in Pfad und Methode.
async function convaiFetch({ fetchImpl, account, path, op, init }) {
  const res = await fetchImpl(`${account.apiBase}${path}`, {
    ...init,
    headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
 * Holt den Stand eines Gespraechs (status, transcript, analysis).
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, conversationId: string}} args
 */
export function fetchConversation({ fetchImpl, account, conversationId }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVERSATION_PATH + encodeURIComponent(conversationId),
    op: "Gespraechsabruf",
    init: { method: "GET" },
  });
}
