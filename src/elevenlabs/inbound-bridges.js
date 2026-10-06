import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";
import { defaultSetTimer } from "../utils/timer.js";

export const EL_BRIDGE_START_DEADLINE_MS = 30000;
export const EL_BINDING_AFTER_ANSWER_MS = 8000;

export const EL_RUECKFALL_PFAD = "/voice/el-rueckfall";
export const EL_RUECKFALL_QUELLE = Object.freeze({ DIAL_ENDE: "dial_ende", FRIST: "frist" });

const FRIST_ART = Object.freeze({ AUSSEN: "aussen", INNEN: "innen" });
const LOG_TAG = "el-inbound";

export function elRueckfallUrl({ callId, quelle }) {
  return `${EL_RUECKFALL_PFAD}?${new URLSearchParams({ callId, quelle })}`;
}

export function aeussereRestfristMs(call, nowMs) {
  const rest = Date.parse(call.answeredAt) + EL_BRIDGE_START_DEADLINE_MS - nowMs;
  return Number.isFinite(rest) ? Math.max(0, rest) : 0;
}

const umleitungFaellig = (call) =>
  call?.status === "active" && bridgeStateOf(call) === BRIDGE_STATE.WARTET;

export function makeInboundBridges({
  store,
  umleiten,
  setTimer = defaultSetTimer,
  clearTimer = clearTimeout,
  now = Date.now,
}) {
  const fristen = new Map();

  function clearDeadlines(callId) {
    const eintrag = fristen.get(callId);
    if (!eintrag) return;
    for (const handle of Object.values(eintrag)) clearTimer(handle);
    fristen.delete(callId);
  }

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

  function rearmDeadlines() {
    const wartende = store.load().calls.filter(umleitungFaellig);
    const nowMs = now();
    for (const call of wartende) armiere(call.id, FRIST_ART.AUSSEN, aeussereRestfristMs(call, nowMs));
    if (wartende.length > 0) console.log(`[${LOG_TAG}] Fristen re-armiert: ${wartende.length} Anrufe`);
  }

  return { armDeadlines, armBindingDeadline, clearDeadlines, rearmDeadlines };
}

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
