// IEL-B6 (E9): die Fristen einer WARTENDEN Inbound-Bruecke - "verbunden, aber kein
// Gespraech". Zweistufig: die innere Frist startet mit dem answered-Callback des SIP-Beins
// (EL_BINDING_AFTER_ANSWER_MS, armiert ab B8), die aeussere deckt den Fall, dass dieser
// Callback nie kommt (EL_BRIDGE_START_DEADLINE_MS ab answeredAt). Laeuft eine Frist ab,
// wird der Call FRISCH gelesen: nur ein noch aktiver, noch WARTENDER Call wird live auf den
// Rueckfall umgeleitet (quelle=frist, volle Begruessung mit Pflichtsatz). Nie Stille: scheitert
// die Umleitung, wird aufgelegt.
//
// Nur Timer, kein Store-Schreibzugriff, kein config-Import: der Umleitungs-Callback und der
// Timer kommen herein (DIP, testbar mit Fake-Timern). Die innere Frist wird nach einem
// Neustart NICHT re-armiert - ihr Startereignis ist nicht persistiert; die aeussere deckt.
import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";
import { defaultSetTimer } from "../utils/timer.js";

// STARTWERTE, NICHT GEMESSEN (Spec 8 zieht nach). Begruendung der Groessenordnung:
//   EL_BINDING_AFTER_ANSWER_MS: der Anbieter entscheidet gemessen etwa 1,7 s nach dem
//     200 OK des SIP-Beins ([M1] J3); 8 s lassen Reserve fuer einen langsamen Init-Webhook.
//   EL_BRIDGE_START_DEADLINE_MS: Synthese des Pflichtsatzes bis 3,3 s [KO 3.2] plus seine
//     Wiedergabe etwa 6 s plus INVITE/407/200 unter 1 s [M1] plus die innere Frist plus
//     Reserve. Die aeussere Frist muss die innere immer uebersteigen.
export const EL_BRIDGE_START_DEADLINE_MS = 30000;
export const EL_BINDING_AFTER_ANSWER_MS = 8000;

// R-C: EINE Quelle fuer Pfad und Herkunft des Rueckfalls (B8 importiert beides).
export const EL_RUECKFALL_PFAD = "/voice/el-rueckfall";
export const EL_RUECKFALL_QUELLE = Object.freeze({ DIAL_ENDE: "dial_ende", FRIST: "frist" });

const FRIST_ART = Object.freeze({ AUSSEN: "aussen", INNEN: "innen" });
const LOG_TAG = "el-inbound";

// Wurzel-relativ (ohne Origin); der Aufrufer setzt config.server.publicUrl davor (Muster
// voice-render). URLSearchParams kodiert beide Werte.
export function elRueckfallUrl({ callId, quelle }) {
  return `${EL_RUECKFALL_PFAD}?${new URLSearchParams({ callId, quelle })}`;
}

// E9 + S8: EINE Formel fuer Armieren und Re-Armieren. Ein unlesbares answeredAt ergibt 0 -
// sofort umleiten statt einer Frist, die nie ablaeuft (nie Stille).
export function aeussereRestfristMs(call, nowMs) {
  const rest = Date.parse(call.answeredAt) + EL_BRIDGE_START_DEADLINE_MS - nowMs;
  return Number.isFinite(rest) ? Math.max(0, rest) : 0;
}

// Beides frisch aus dem Datensatz: ein per cancel_call oder Cap beendeter Call bleibt WARTET,
// ist aber nicht aktiv - dann wirkt die Frist nicht (Runde 3).
const umleitungFaellig = (call) =>
  call?.status === "active" && bridgeStateOf(call) === BRIDGE_STATE.WARTET;

/**
 * @param {{store: {getCall: Function, load: Function},
 *   umleiten: ({call: object, rueckfallUrl: string}) => unknown,
 *   setTimer?: Function, clearTimer?: Function, now?: () => number}} deps
 */
export function makeInboundBridges({
  store,
  umleiten,
  setTimer = defaultSetTimer,
  clearTimer = clearTimeout,
  now = Date.now,
}) {
  // callId -> { aussen?: handle, innen?: handle }
  const fristen = new Map();

  function clearDeadlines(callId) {
    const eintrag = fristen.get(callId);
    if (!eintrag) return;
    for (const handle of Object.values(eintrag)) clearTimer(handle);
    fristen.delete(callId);
  }

  // Die zuerst ablaufende Frist raeumt beide ab - die andere feuert nie mehr (genau einmal).
  function fristAbgelaufen(callId, art) {
    const call = store.getCall(callId);
    clearDeadlines(callId);
    if (!umleitungFaellig(call)) return;
    console.log(`[${LOG_TAG}] frist_abgelaufen call=${callId} frist=${art}`);
    void umleiten({ call, rueckfallUrl: elRueckfallUrl({ callId, quelle: EL_RUECKFALL_QUELLE.FRIST }) });
  }

  function armiere(callId, art, ms) {
    const eintrag = fristen.get(callId) ?? {};
    if (eintrag[art]) clearTimer(eintrag[art]);
    fristen.set(callId, { ...eintrag, [art]: setTimer(() => fristAbgelaufen(callId, art), ms) });
  }

  function armDeadlines(callId) {
    const call = store.getCall(callId);
    if (!call) return;
    armiere(callId, FRIST_ART.AUSSEN, aeussereRestfristMs(call, now()));
  }

  function armBindingDeadline(callId) {
    armiere(callId, FRIST_ART.INNEN, EL_BINDING_AFTER_ANSWER_MS);
  }

  // Boot (E9, INV-5): setzt ausschliesslich Timer. Eine bereits abgelaufene Frist bekommt
  // 0 ms und leitet beim naechsten Tick um.
  function rearmDeadlines() {
    const wartende = store.load().calls.filter(umleitungFaellig);
    const nowMs = now();
    for (const call of wartende) armiere(call.id, FRIST_ART.AUSSEN, aeussereRestfristMs(call, nowMs));
    if (wartende.length > 0) console.log(`[${LOG_TAG}] Fristen re-armiert: ${wartende.length} Anrufe`);
  }

  return { armDeadlines, armBindingDeadline, clearDeadlines, rearmDeadlines };
}

// E9-Wirkung (S2): live umleiten, sonst auflegen - wirft nie. Ein Port ohne redirectCall
// (vor B7) zaehlt als gescheiterte Umleitung und legt auf: lieber aufgelegt als stumm.
export async function umleitenOderAuflegen({ voiceControl, endCarrierCall, call, url }) {
  try {
    await leiteUm(voiceControl(call.provider), call, url);
    console.log(`[${LOG_TAG}] umgeleitet call=${call.id}`);
  } catch (err) {
    console.warn(`[${LOG_TAG}] umleitung_fehlgeschlagen call=${call.id}: ${err.message}`);
    await legeTraegerAuf(endCarrierCall, call.id);
  }
}

async function leiteUm(port, call, url) {
  if (typeof port.redirectCall !== "function")
    throw new Error("Telefonie-Port bietet keine Live-Umleitung (redirectCall)");
  await port.redirectCall(call.twilioSid, url);
}

async function legeTraegerAuf(endCarrierCall, callId) {
  try {
    await endCarrierCall(callId);
  } catch (err) {
    console.warn(`[${LOG_TAG}] auflegen_fehlgeschlagen call=${callId}: ${err.message}`);
  }
}
