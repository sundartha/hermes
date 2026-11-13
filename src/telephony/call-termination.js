import { BRIDGE_STATE, bridgeStateOf } from "../elevenlabs/inbound-bridge-state.js";

export async function terminateAndBillCall({ persistEnd, hangUp, bill, onHangUpError, callId }) {
  if (typeof bill !== "function")
    throw new TypeError("terminateAndBillCall: bill (Settlement) ist Pflicht - kein Function uebergeben");
  persistEnd();
  if (hangUp) {
    try {
      await hangUp();
    } catch (fehler) {
      onHangUpError?.(fehler);
    }
  }
  Promise.resolve(bill()).catch((fehler) => {
    console.error(`[terminateAndBillCall] Settlement fehlgeschlagen (call=${callId ?? "unbekannt"}):`, Reflect.get(Object(fehler), "message"));
  });
}

export function billThunk(finishCall, store, callId) {
  return () => finishCall(store.getCall(callId));
}

async function legeCallControlBeineAuf(steuerung, call) {
  const beine = [call.callControlId, call.elCallControlId].filter(Boolean);
  const ergebnisse = await Promise.allSettled(beine.map((bein) => steuerung.endCallViaCallControl(bein)));
  const gescheitert = ergebnisse.find((ergebnis) => ergebnis.status === "rejected");
  if (gescheitert) throw gescheitert.reason;
}

export function hangUpAction(voiceControl, call, providerCallSid) {
  if (call.callControlId) return () => legeCallControlBeineAuf(voiceControl(call.provider), call);
  if (providerCallSid) return () => voiceControl(call.provider).endCall(providerCallSid);
  return null;
}

export function elevenLabsHangUpAction(endActiveCall, call) {
  if (!call.elevenlabsConversationId || typeof endActiveCall !== "function") return null;
  if (bridgeStateOf(call) !== BRIDGE_STATE.KEIN_EL_INBOUND) return null;
  return () => endActiveCall(call.id);
}

export function hangUpForCall({ call, hangUp, awaitAndPersistInboundElResult }) {
  if (bridgeStateOf(call) !== BRIDGE_STATE.GEBUNDEN) return hangUp;
  return bridgedInboundHangUp({ carrierHangUp: hangUp, awaitAndPersistInboundElResult, callId: call.id });
}

function bridgedInboundHangUp({ carrierHangUp, awaitAndPersistInboundElResult, callId }) {
  return async () => {
    try {
      await carrierHangUp?.();
    } finally {
      await awaitAndPersistInboundElResult(callId);
    }
  };
}

export function persistEndWithReason({ store, callId, reason, endCall }) {
  return () => {
    store.recordFailureReason(callId, reason);
    endCall();
  };
}
