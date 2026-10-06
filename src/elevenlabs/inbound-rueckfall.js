import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";
import { EL_RUECKFALL_QUELLE, elRueckfallUrl } from "./inbound-bridges.js";
import { elSipUri } from "./inbound-sip-uri.js";
import { dialSip, hangup, redirect, sayWithVoiceId } from "../telephony/directives.js";
import { callMaxDurationMs } from "../call-duration.js";
import { MAX_CALL_DURATION_CAP_S } from "../store/defaults.js";
import { MS_PER_SECOND } from "../utils/timer.js";

export const EL_DIAL_RING_TIMEOUT_S = 10;
export const EL_MIN_CONVERSATION_MS = 5000;

export const EL_DIAL_ANSWER_ON_BRIDGE = false;

export const EL_BEIN_PFAD = "/voice/el-bein";

export const EL_BEGRUESSUNGSLAUT_PFAD = "/brand/hermes-begruessungslaut.wav";

export function elBegruessungslautUrl(publicUrl) {
  return `${publicUrl}${EL_BEGRUESSUNGSLAUT_PFAD}`;
}

export const RUECKFALL_ENTSCHEIDUNG = Object.freeze({
  AUFLEGEN: "auflegen",
  FOLGE_GATHER: "folge_gather",
  FEHLERSATZ: "fehlersatz",
});

const BEKANNTE_QUELLEN = Object.freeze(Object.values(EL_RUECKFALL_QUELLE));
const QUELLE_UNBEKANNT = "unbekannt";

export function elBeinUrl(callId) {
  return `${EL_BEIN_PFAD}?${new URLSearchParams({ callId })}`;
}

function msSeitIso(iso, nowMs) {
  const zeitpunktMs = Date.parse(iso);
  return Number.isNaN(zeitpunktMs) ? null : nowMs - zeitpunktMs;
}

export function msSeitBindung(call, nowMs) {
  return msSeitIso(call?.elBoundAt, nowMs);
}

export function msSeitAnnahme(call, nowMs) {
  return msSeitIso(call?.answeredAt, nowMs);
}

function gespraechLiefLangGenug(call, nowMs) {
  const dauerMs = msSeitBindung(call, nowMs);
  return dauerMs !== null && dauerMs >= EL_MIN_CONVERSATION_MS;
}

function nurNochAuflegen({ zustand, call, nowMs }) {
  if (zustand === BRIDGE_STATE.RUECKFALL) return true;
  return zustand === BRIDGE_STATE.GEBUNDEN && gespraechLiefLangGenug(call, nowMs);
}

export function rueckfallEntscheidungFuer({ call, nowMs }) {
  if (call?.status !== "active") return RUECKFALL_ENTSCHEIDUNG.AUFLEGEN;
  const zustand = bridgeStateOf(call);
  if (zustand === BRIDGE_STATE.KEIN_EL_INBOUND) return RUECKFALL_ENTSCHEIDUNG.FOLGE_GATHER;
  if (nurNochAuflegen({ zustand, call, nowMs })) return RUECKFALL_ENTSCHEIDUNG.AUFLEGEN;
  return RUECKFALL_ENTSCHEIDUNG.FEHLERSATZ;
}

export function rueckfallQuelleFuerLog(quelle) {
  return BEKANNTE_QUELLEN.includes(quelle) ? quelle : QUELLE_UNBEKANNT;
}

export function elUebergabeDirektiven({ call, zugang, publicUrl, begruessungslautUrl }) {
  return [
    dialSip({
      uri: elSipUri({ did: call.to, token: call.streamToken }),
      username: zugang.username,
      password: zugang.password,
      callerId: call.to,
      timeoutS: EL_DIAL_RING_TIMEOUT_S,
      timeLimitS: callMaxDurationMs(call, MAX_CALL_DURATION_CAP_S) / MS_PER_SECOND,
      statusCallbackUrl: `${publicUrl}${elBeinUrl(call.id)}`,
      answerOnBridge: EL_DIAL_ANSWER_ON_BRIDGE,
      ringbackAudioUrl: begruessungslautUrl,
    }),
    redirect(`${publicUrl}${elRueckfallUrl({ callId: call.id, quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE })}`),
  ];
}

export function elFehlersatzDirektiven(fehlersatz) {
  return [sayWithVoiceId(fehlersatz), hangup()];
}
