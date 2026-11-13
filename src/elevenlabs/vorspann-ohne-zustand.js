import { CALL_CONTROL_EREIGNIS } from "../telephony/call-control-ereignis.js";
import { hangUpAction, persistEndWithReason } from "../telephony/call-termination.ts";
import { STAND } from "./vorspann-bruecke.js";
import { meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_WAHL_GRUND } from "./vorspann-pruefung.js";

function persistEndAufbau({ store, call, logFehler }) {
  try {
    persistEndWithReason({
      store,
      callId: call.id,
      reason: VORSPANN_WAHL_GRUND.ZUSTAND_FEHLT,
      endCall: () => store.endCallRecord(call.id, "failed"),
    })();
  } catch (fehler) {
    logFehler("ende", call.id, fehler);
  }
}

const beendeAufbau = ({ voiceControl, store, terminateAndBillCall, billThunk, finishCall, logFehler, call }) =>
  terminateAndBillCall({
    persistEnd: () => persistEndAufbau({ store, call, logFehler }),
    hangUp: hangUpAction(voiceControl, call, null),
    onHangUpError: (fehler) => logFehler("nachlauf", call.id, fehler),
    bill: billThunk(finishCall, store, call.id),
    callId: call.id,
  });

function nachBruecke({ beiAufgelegt, call, ereignis, vomElBein }) {
  if (ereignis.ereignis !== CALL_CONTROL_EREIGNIS.AUFGELEGT) return;
  const zustand = { calleeId: call.callControlId, stand: new Map([[STAND.BRUECKE, Date.now()]]), aufgelegt: new Set() };
  return beiAufgelegt({ call, zustand, vomElBein, abgehoben: true });
}

export function behandleOhneZustand(args) {
  const { call, ereignis, vomElBein } = args;
  const bekannt = vomElBein || ereignis.callControlId === call.callControlId;
  if (!ereignis.ereignis || !ereignis.callControlId || !bekannt || call.status !== "active") return;
  if (call.bridgedAt) return nachBruecke(args);
  meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.ZUSTAND_FEHLT });
  return beendeAufbau(args);
}
