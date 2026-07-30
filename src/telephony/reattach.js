// F12 (A6): Re-Attach eines dem Prozess unbekannten, aber in der DB aktiven Calls
// (ein Deploy-/Instanzwechsel liess die aktive Zeile aus dem Prozess-Spiegel fallen).
// Reine Orchestrierung analog call-termination.js: alle IO-/Zeit-Effekte kommen als
// bereits gebundene Funktionen herein (attachActiveCall/terminateCappedCall/
// scheduleMaxDurationEnd) - KEINE Abhaengigkeit auf store/config/voiceControl aus
// server.js -> offline mit Fake-Thunks unit-testbar (kein Server-Spawn, kein Store noetig
// fuer die Orchestrierung selbst; nur attachActiveCall braucht bei einem echten Test
// einen echten Store, siehe test/reattach-active-call.test.js).
//
// JEDER /voice/*-Handler (turn/outbound/status), der einen dem Spiegel unbekannten,
// aber ggf. noch aktiven Call sieht, MUSS ausschliesslich hierueber re-attachen - sonst
// faellt die Restzeit-Klassifikation + der Timer-Rearm aus (Absolute Regel Max-Dauer).
// Genau das war der F12-S1-1-Fund: /voice/status rief store.attachActiveCall bisher
// DIREKT auf und reanimierte so ein Ueber-Zeit-Leg OHNE Cap - einmal im Prozess-Spiegel
// aktiv, haette kein /voice/turn diesen Pfad je wieder betreten.
//
// Rueckgabe:
//   { call }                        -> aktiver Call im Zeitfenster, Cap re-armiert.
//   { call:null, logUnknown:true }  -> wirklich unbekannt -> Aufrufer legt fail-closed auf.
//   { call:null, logUnknown:false } -> aktiv, aber eine Sicherung hat gegriffen (Max-Dauer
//                                       ODER erschoepftes Guthaben) -> bereits
//                                       terminalisiert+gebucht, NICHT reanimieren.
import { classifyCallTime } from "../store/state-ops.js";

// RACE-1 (Review-Blocker Runde 2, Korrektheit): ein Deploy-Instanzwechsel kann mehrere fast
// gleichzeitige /voice/*-Webhooks (turn/outbound/status) fuer DENSELBEN, dem Prozess
// unbekannten aktiven Call ausloesen (z.B. ein /voice/status-Retry parallel zu /voice/turn).
// Ohne Schutz durchliefe JEDER Aufruf seinen EIGENEN attachActiveCall()+Klassifikations+Arm-
// Pfad unabhaengig - beide koennen unabhaengig remaining>0 berechnen und BEIDE
// scheduleMaxDurationEnd() aufrufen, es entstehen zwei setTimeout-Timer fuer denselben Call
// (die Terminierungs-Idempotenz aus F9/F10 verhindert zwar eine Doppelbuchung, der zweite
// Timer bleibt aber ein nie aufgeraeumter Leak). In-Flight-Promise-Cache (Request Coalescing)
// pro callId: ein zweiter/dritter gleichzeitiger Aufruf fuer dieselbe callId bekommt DENSELBEN
// Promise wie der erste, statt den Pfad erneut zu durchlaufen. Der Eintrag wird SOFORT nach
// Abschluss geraeumt (finally, unabhaengig von Erfolg/Fehler) - kein Memory-Leak, ein
// spaeterer NICHT-gleichzeitiger Aufruf (z.B. ein Retry Minuten danach) laedt wieder frisch
// aus der DB statt ein veraltetes Ergebnis zu liefern.
const inFlightByCallId = new Map();

export function reattachActiveCall(callId, deps) {
  const inFlight = inFlightByCallId.get(callId);
  if (inFlight) return inFlight;
  const attempt = runReattach(callId, deps).finally(() => {
    inFlightByCallId.delete(callId);
  });
  inFlightByCallId.set(callId, attempt);
  return attempt;
}

async function runReattach(
  callId,
  {
    attachActiveCall,
    maxCallDurationS,
    terminateCappedCall,
    scheduleMaxDurationEnd,
    budgetAxisFor,
    terminateOverBudgetCall,
  },
) {
  const call = await attachActiveCall(callId);
  // status-Guard traegt fuer json (getCall liefert dort auch nicht-aktive Calls); fuer pg
  // ist er redundant (Query filtert bereits status='active') aber harmlos.
  if (!call || call.status !== "active") return { call: null, logUnknown: true };
  const { remaining, expired } = classifyCallTime(call, Date.now(), maxCallDurationS);
  if (expired) {
    // Ueber-Zeit-Leg NICHT reanimieren: derselbe EINE Terminalisierungspfad wie der Boot-
    // Re-Arm-Zombie (F10) - gekappt buchen (billedAt-idempotent) + Leg auflegen (awaited).
    await terminateCappedCall(call.id, call.twilioSid, "failed");
    return { call: null, logUnknown: false };
  }
  // KS-P1b (E8): die Notbremse wird beim Re-Attach NEU berechnet, nicht wiederhergestellt -
  // und eine neue Frist bekommt nur, wer sie noch bezahlen kann. Zwischen Anrufstart und
  // Re-Attach koennen ANDERE Anrufe desselben Tenants sein Guthaben verbraucht haben; der
  // beim Start gueltige Wert ist dann veraltet. Geprueft wird die EINE Geld-Achse aus
  // budget-gate.js - dasselbe Praedikat, das der Shim-Turn und das Dial-Gate lesen, hier nur
  // an einem weiteren Punkt angewandt (G5, KEIN zweites Gate). Reihenfolge: Zeit zuerst (der
  // Cap-Grund ist fuer ein Ueber-Zeit-Leg der genauere), danach Geld. Selber Vertrag wie der
  // Zeit-Zweig: bereits terminalisiert + gebucht -> NICHT reanimieren.
  if (budgetAxisFor(call)) {
    await terminateOverBudgetCall(call.id, call.twilioSid);
    return { call: null, logUnknown: false };
  }
  // Aktiv im Zeitfenster: den beim Boot-Re-Arm (F10) verpassten Max-Dauer-Cap EINZELN
  // nachziehen (der Call war beim Boot noch nicht im Spiegel), dann normal fortfahren.
  scheduleMaxDurationEnd(call, call.twilioSid, remaining);
  return { call };
}
