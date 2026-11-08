import { maxDurationSOf } from "../call-duration.js";
import { callFailureReason } from "../telephony/failure-reason.js";
import { CALL_CONTROL_EREIGNIS } from "../telephony/call-control-ereignis.js";
import { persistEndWithReason } from "../telephony/call-termination.js";
import { meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_ABLAGE_TTL_MS, VORSPANN_WAHL_GRUND, wahlSperrGrund } from "./vorspann-pruefung.js";

export const VORSPANN_PFAD = "/voice/vorspann";

const LOG_TAG = "[el-vorspann]";

const logFehler = (aktion, callId, fehler) =>
  console.error(`${LOG_TAG} ${aktion} fehlgeschlagen call=${callId}: ${fehler.message}`);

export function endeFuerAufgelegt({ abgehoben }) {
  if (abgehoben) return { endStatus: "completed", grund: null };
  return { endStatus: "failed", grund: callFailureReason({ status: "no-answer" }) };
}

function calleeAnfrage({ call, config }) {
  return {
    connectionId: config.telephony.telnyxCallControlAppId,
    to: call.to,
    from: call.from,
    webhookUrl: `${config.server.publicUrl}${VORSPANN_PFAD}?callId=${call.id}`,
    timeLimitS: maxDurationSOf(call),
    commandId: `vorspann-${call.id}`,
  };
}

async function legeBeinAuf(steuerung, callId, callControlId) {
  try {
    await steuerung.endCallViaCallControl(callControlId);
  } catch (fehler) {
    logFehler("auflegen", callId, fehler);
  }
}

export function makeVorspannAblauf({
  voiceControl,
  store,
  config,
  ttsStore,
  ausgehendGesperrt,
  terminateAndBillCall,
  billThunk,
  finishCall,
}) {
  const zustaende = new Map();
  const abgehobeneAnrufe = new Set();

  async function waehle({ call, vorspann }) {
    const grund = wahlSperrGrund({ aktiv: call.status === "active", gesperrt: await ausgehendGesperrt() });
    if (grund) meldeVorspannRueckfall({ callId: call.id, grund });
    if (grund === VORSPANN_WAHL_GRUND.GESPERRT)
      throw new Error("Ausgehende Anrufe sind gesperrt (OUTBOUND_FROZEN oder Anrufpause)");
    if (grund) return { grund };
    const token = ttsStore.put(vorspann.audio, { bisFreigabe: true, ttlMs: VORSPANN_ABLAGE_TTL_MS });
    try {
      const { callControlId } = await voiceControl(call.provider).dialCallControl(calleeAnfrage({ call, config }));
      if (!callControlId) throw new Error("Der Anbieter hat keine Kennung fuer das neue Bein geliefert");
      zustaende.set(call.id, { calleeId: callControlId, token });
      if (call.status !== "active") await legeBeinAuf(voiceControl(call.provider), call.id, callControlId);
      return { callControlId };
    } catch (fehler) {
      ttsStore.release(token);
      throw fehler;
    }
  }

  async function beiAbgehoben({ call, zustand }) {
    if (abgehobeneAnrufe.has(call.id) || call.status !== "active") return;
    abgehobeneAnrufe.add(call.id);
    store.markAnswered(call.id);
    store.save();
    const audioUrl = `${config.server.publicUrl}/voice/tts/${zustand.token}`;
    try {
      await voiceControl(call.provider).playbackStart(zustand.calleeId, { audioUrl });
    } catch (fehler) {
      logFehler("abheben", call.id, fehler);
      await legeBeinAuf(voiceControl(call.provider), call.id, zustand.calleeId);
    }
  }

  async function beiAufgelegt({ call, zustand }) {
    const abgehoben = abgehobeneAnrufe.delete(call.id);
    zustaende.delete(call.id);
    ttsStore.release(zustand.token);
    if (call.status !== "active") return;
    const { endStatus, grund } = endeFuerAufgelegt({ abgehoben });
    await terminateAndBillCall({
      persistEnd: persistEndWithReason({
        store,
        callId: call.id,
        reason: grund,
        endCall: () => store.endCallRecord(call.id, endStatus),
      }),
      bill: billThunk(finishCall, store, call.id),
      callId: call.id,
    });
  }

  const BEHANDLER = Object.freeze({
    [CALL_CONTROL_EREIGNIS.ABGEHOBEN]: beiAbgehoben,
    [CALL_CONTROL_EREIGNIS.AUFGELEGT]: beiAufgelegt,
    [CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE]: ({ zustand }) => ttsStore.release(zustand.token),
  });

  async function behandle({ call, ereignis }) {
    const zustand = zustaende.get(call.id);
    if (!zustand || ereignis.callControlId !== zustand.calleeId) return;
    try {
      await BEHANDLER[ereignis.ereignis]?.({ call, zustand });
    } catch (fehler) {
      logFehler("ereignis", call.id, fehler);
    }
  }

  return { waehle, behandle };
}
