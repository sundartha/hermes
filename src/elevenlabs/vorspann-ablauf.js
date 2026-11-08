import { maxDurationSOf } from "../call-duration.js";
import { callFailureReason } from "../telephony/failure-reason.js";
import { CALL_CONTROL_EREIGNIS } from "../telephony/call-control-ereignis.js";
import { persistEndWithReason } from "../telephony/call-termination.js";
import { EL_DIAL_RING_TIMEOUT_S } from "./inbound-rueckfall.js";
import { EL_CALL_BINDING_SIP_HEADER, elSipZiel } from "./inbound-sip-uri.js";
import { meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_ABLAGE_TTL_MS, VORSPANN_WAHL_GRUND, wahlSperrGrund } from "./vorspann-pruefung.js";

export const VORSPANN_PFAD = "/voice/vorspann";

const LOG_TAG = "[el-vorspann]";

const logFehler = (aktion, callId, fehler) =>
  console.error(`${LOG_TAG} ${aktion} fehlgeschlagen call=${callId}: ${fehler.message}`);

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

function elBeinAnfrage({ call, config, calleeId, zugang }) {
  return {
    ...calleeAnfrage({ call, config }),
    to: elSipZiel(call.from),
    linkTo: calleeId,
    customHeaders: [{ name: EL_CALL_BINDING_SIP_HEADER, value: call.streamToken }],
    sipAuthUsername: zugang.username,
    sipAuthPassword: zugang.password,
    sipTransportProtocol: "TCP",
    timeoutS: EL_DIAL_RING_TIMEOUT_S,
    commandId: `vorspann-${call.id}-el`,
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

  async function pruefe({ call }) {
    const grund = wahlSperrGrund({ aktiv: call.status === "active", gesperrt: await ausgehendGesperrt() });
    if (grund) meldeVorspannRueckfall({ callId: call.id, grund });
    if (grund === VORSPANN_WAHL_GRUND.GESPERRT)
      throw new Error("Ausgehende Anrufe sind gesperrt (OUTBOUND_FROZEN oder Anrufpause)");
    return { grund };
  }

  async function waehle({ call, vorspann }) {
    const steuerung = voiceControl(call.provider);
    const { callControlId } = await steuerung.dialCallControl(calleeAnfrage({ call, config }));
    if (!callControlId) throw new Error("Der Anbieter hat keine Kennung fuer das neue Bein geliefert");
    if (call.status === "active") {
      const token = ttsStore.put(vorspann.audio, { bisFreigabe: true, ttlMs: VORSPANN_ABLAGE_TTL_MS });
      zustaende.set(call.id, { calleeId: callControlId, token });
    } else await legeBeinAuf(steuerung, call.id, callControlId);
    return { callControlId };
  }

  async function waehleElBein({ call, zustand, steuerung, zugang }) {
    const { callControlId } = await steuerung.dialCallControl(elBeinAnfrage({ call, config, calleeId: zustand.calleeId, zugang }));
    if (!callControlId) throw new Error("Der Anbieter hat keine Kennung fuer das EL-Bein geliefert");
    const aufzeichnung = store.getCall(call.id);
    aufzeichnung.elCallControlId = callControlId;
    if (aufzeichnung.status !== "active") await legeBeinAuf(steuerung, call.id, callControlId);
  }

  async function beiAbgehoben({ call, zustand, zugang }) {
    if (abgehobeneAnrufe.has(call.id) || call.status !== "active") return;
    abgehobeneAnrufe.add(call.id);
    store.markAnswered(call.id);
    store.save();
    const audioUrl = `${config.server.publicUrl}/voice/tts/${zustand.token}`;
    const steuerung = voiceControl(call.provider);
    const [wiedergabe, elWahl] = await Promise.allSettled([
      steuerung.playbackStart(zustand.calleeId, { audioUrl }),
      waehleElBein({ call, zustand, steuerung, zugang }),
    ]);
    if (wiedergabe.status === "rejected") logFehler("abheben", call.id, wiedergabe.reason);
    if (elWahl.status === "rejected") logFehler("el-wahl", call.id, elWahl.reason);
    if (wiedergabe.status === "fulfilled" && elWahl.status === "fulfilled") return;
    const beine = [zustand.calleeId, call.elCallControlId].filter(Boolean);
    await Promise.all(beine.map((bein) => legeBeinAuf(steuerung, call.id, bein)));
  }

  async function beiAufgelegt({ call, zustand }) {
    const abgehoben = abgehobeneAnrufe.delete(call.id);
    zustaende.delete(call.id);
    ttsStore.release(zustand.token);
    if (call.status !== "active") return;
    const endStatus = abgehoben ? "completed" : "failed";
    const grund = abgehoben ? null : callFailureReason({ status: "no-answer" });
    await terminateAndBillCall({
      persistEnd: persistEndWithReason({
        store,
        callId: call.id,
        reason: grund,
        endCall: () => store.endCallRecord(call.id, endStatus),
      }),
      hangUp: call.elCallControlId ? () => legeBeinAuf(voiceControl(call.provider), call.id, call.elCallControlId) : null,
      bill: billThunk(finishCall, store, call.id),
      callId: call.id,
    });
  }

  const BEHANDLER = Object.freeze({
    [CALL_CONTROL_EREIGNIS.ABGEHOBEN]: beiAbgehoben,
    [CALL_CONTROL_EREIGNIS.AUFGELEGT]: beiAufgelegt,
    [CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE]: ({ zustand }) => ttsStore.release(zustand.token),
  });

  async function behandle({ call, ereignis, zugang }) {
    const zustand = zustaende.get(call.id);
    if (!zustand || ereignis.callControlId !== zustand.calleeId) return;
    try {
      await BEHANDLER[ereignis.ereignis]?.({ call, zustand, zugang });
    } catch (fehler) {
      logFehler("ereignis", call.id, fehler);
    }
  }

  return { pruefe, waehle, behandle };
}
