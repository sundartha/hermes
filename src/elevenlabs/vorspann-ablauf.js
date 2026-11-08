import { maxDurationSOf } from "../call-duration.js";
import { meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_WAHL_GRUND, wahlSperrGrund } from "./vorspann-pruefung.js";

const VORSPANN_PFAD = "/voice/vorspann";

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

async function legeBeinAuf(steuerung, callId, callControlId) {
  try {
    await steuerung.endCallViaCallControl(callControlId);
  } catch (fehler) {
    logFehler("auflegen", callId, fehler);
  }
}

export function makeVorspannAblauf({ voiceControl, config, ausgehendGesperrt }) {
  async function waehle({ call }) {
    const grund = wahlSperrGrund({ aktiv: call.status === "active", gesperrt: await ausgehendGesperrt() });
    if (grund) meldeVorspannRueckfall({ callId: call.id, grund });
    if (grund === VORSPANN_WAHL_GRUND.GESPERRT)
      throw new Error("Ausgehende Anrufe sind gesperrt (OUTBOUND_FROZEN oder Anrufpause)");
    if (grund) return { grund };
    const steuerung = voiceControl(call.provider);
    const { callControlId } = await steuerung.dialCallControl(calleeAnfrage({ call, config }));
    if (!callControlId) throw new Error("Der Anbieter hat keine Kennung fuer das neue Bein geliefert");
    if (call.status !== "active") await legeBeinAuf(steuerung, call.id, callControlId);
    return { callControlId };
  }

  return { waehle };
}
