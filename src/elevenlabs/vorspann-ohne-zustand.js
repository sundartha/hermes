import { CALL_CONTROL_EREIGNIS } from "../telephony/call-control-ereignis.ts";
import { hangUpAction, persistEndWithReason } from "../telephony/call-termination.ts";
import { STAND } from "./vorspann-bruecke.js";
import { meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_WAHL_GRUND } from "./vorspann-pruefung.js";

async function persistEndAufbau({ store, call, logFehler }) {
  try {
    await persistEndWithReason({
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

function nachBruecke({ beiAufgelegt, call, ereignis, vomElBein, now }) {
  if (ereignis.ereignis !== CALL_CONTROL_EREIGNIS.AUFGELEGT) return;
  const zustand = { calleeId: call.callControlId, stand: new Map([[STAND.BRUECKE, now()]]), aufgelegt: new Set() };
  return beiAufgelegt({ call, zustand, vomElBein, abgehoben: true });
}

async function nochAktiv({ store, call, logFehler }) {
  try {
    return (await store.leseCallAusDatenbank(call.id))?.status === "active";
  } catch (fehler) {
    logFehler("lesen", call.id, fehler);
    return false;
  }
}

export async function behandleOhneZustand(args) {
  const { call, ereignis, vomElBein } = args;
  const bekannt = vomElBein || ereignis.callControlId === call.callControlId;
  if (!ereignis.ereignis || !ereignis.callControlId || !bekannt || call.status !== "active") return;
  if (!(await nochAktiv(args))) return;
  if (call.bridgedAt) return nachBruecke(args);
  meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.ZUSTAND_FEHLT });
  return beendeAufbau(args);
}
