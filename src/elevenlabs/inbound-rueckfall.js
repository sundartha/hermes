// IEL-B8 (E8/L9/E9): Rueckfall-Entscheidung und Uebergabe-Direktiven des EL-Inbound-Wegs.
// Rein: jede Eingabe kommt aus dem PERSISTIERTEN Datensatz (E5) oder als Argument - nach einem
// Neustart entscheidet der Handler identisch. Kein Prozessspeicher, kein config, kein Log.
import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";
import { EL_RUECKFALL_QUELLE, elRueckfallUrl } from "./inbound-bridges.js";
import { elSipUri } from "./inbound-sip-uri.js";
import { dialSip, redirect, sayWithVoiceId } from "../telephony/directives.js";
import { callMaxDurationMs } from "../call-duration.js";
import { MAX_CALL_DURATION_CAP_S } from "../store/defaults.js";
import { MS_PER_SECOND } from "../utils/timer.js";

// STARTWERTE, NICHT GEMESSEN (Spec 8 zieht nach), Muster inbound-bridges.js:
//   EL_DIAL_RING_TIMEOUT_S: INVITE -> 407 -> 200 OK gemessen unter 1 s ([M1] F-A/J3). Synthese
//     des Pflichtsatzes (bis 3,3 s, [KO 3.2]) + Wiedergabe (etwa 6 s) + dieser Wert bleiben unter
//     EL_BRIDGE_START_DEADLINE_MS: ein nie beantwortetes Bein endet ueber dial_ende (Rest ohne
//     Doppelansage), bevor die Frist greift. Der Test pinnt die Ordnung.
//   EL_MIN_CONVERSATION_MS: der Anbieter bricht ein Gespraech mit fehlender Variable etwa 1,7 s
//     nach der Annahme ab (1008, [M1] J3); eine echte Eroeffnung dauert laenger.
export const EL_DIAL_RING_TIMEOUT_S = 10;
export const EL_MIN_CONVERSATION_MS = 5000;

// EINE Quelle fuer Pfad und URL des SIP-Bein-Callbacks (Schreiber: Dial-Direktive, Leser: Route).
export const EL_BEIN_PFAD = "/voice/el-bein";

export const RUECKFALL_ENTSCHEIDUNG = Object.freeze({
  AUFLEGEN: "auflegen",
  FOLGE_GATHER: "folge_gather",
  RUECKFALL_STARTEN: "rueckfall_starten",
});

// Budget-Bein (3.3: kein neuer Abbruchweg) und bereits laufender Rueckfall (Anbieter-Wiederholung).
const FOLGE_GATHER_ZUSTAENDE = Object.freeze([BRIDGE_STATE.KEIN_EL_INBOUND, BRIDGE_STATE.RUECKFALL]);
const BEKANNTE_QUELLEN = Object.freeze(Object.values(EL_RUECKFALL_QUELLE));
const QUELLE_UNBEKANNT = "unbekannt";

// Wurzel-relativ wie elRueckfallUrl; der Aufrufer setzt publicUrl davor.
export function elBeinUrl(callId) {
  return `${EL_BEIN_PFAD}?${new URLSearchParams({ callId })}`;
}

// Ein unlesbares elBoundAt ergibt NaN -> false -> Rueckfall (Budget-Gespraech statt Auflegen, nie Stille).
function gespraechLiefLangGenug(call, nowMs) {
  return nowMs - Date.parse(call.elBoundAt) >= EL_MIN_CONVERSATION_MS;
}

// E8: Entscheidung ausschliesslich ueber Aktiv-Status + bridgeStateOf + elBoundAt.
export function rueckfallEntscheidungFuer({ call, nowMs }) {
  if (call?.status !== "active") return RUECKFALL_ENTSCHEIDUNG.AUFLEGEN;
  const zustand = bridgeStateOf(call);
  if (FOLGE_GATHER_ZUSTAENDE.includes(zustand)) return RUECKFALL_ENTSCHEIDUNG.FOLGE_GATHER;
  if (zustand === BRIDGE_STATE.GEBUNDEN && gespraechLiefLangGenug(call, nowMs))
    return RUECKFALL_ENTSCHEIDUNG.AUFLEGEN;
  return RUECKFALL_ENTSCHEIDUNG.RUECKFALL_STARTEN; // WARTET oder GEBUNDEN jung
}

// Log-sicher: nur Enum-Werte, nie der rohe Query-Wert (Log-Injection).
export function rueckfallQuelleFuerLog(quelle) {
  return BEKANNTE_QUELLEN.includes(quelle) ? quelle : QUELLE_UNBEKANNT;
}

// 3.1 Schritt 5: Pflichtsatz (Agentenstimme, E19) -> Dial/Sip -> Redirect(dial_ende).
// zugang.password ist SECRET: das Ergebnis wird nur gerendert, nie geloggt.
export function elUebergabeDirektiven({ call, pflichtsatz, zugang, publicUrl }) {
  return [
    sayWithVoiceId(pflichtsatz),
    dialSip({
      uri: elSipUri({ did: call.to, token: call.streamToken }),
      username: zugang.username,
      password: zugang.password,
      callerId: call.to,
      timeoutS: EL_DIAL_RING_TIMEOUT_S,
      // Fallback-Regel wie callMaxDurationMs (EINE Quelle); die Anbieter-Grenzen klemmt der Renderer.
      timeLimitS: callMaxDurationMs(call, MAX_CALL_DURATION_CAP_S) / MS_PER_SECOND,
      statusCallbackUrl: `${publicUrl}${elBeinUrl(call.id)}`,
    }),
    redirect(`${publicUrl}${elRueckfallUrl({ callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE })}`),
  ];
}
