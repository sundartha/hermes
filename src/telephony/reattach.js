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
//   { call:null, logUnknown:false } -> aktiv, aber Max-Dauer erreicht -> bereits
//                                       terminalisiert+gebucht, NICHT reanimieren.
import { remainingMaxDurationMs } from "../store/state-ops.js";

export async function reattachActiveCall(
  callId,
  { attachActiveCall, maxCallDurationS, terminateCappedCall, scheduleMaxDurationEnd },
) {
  const call = await attachActiveCall(callId);
  // status-Guard traegt fuer json (getCall liefert dort auch nicht-aktive Calls); fuer pg
  // ist er redundant (Query filtert bereits status='active') aber harmlos.
  if (!call || call.status !== "active") return { call: null, logUnknown: true };
  const remaining = remainingMaxDurationMs(call, Date.now(), maxCallDurationS);
  if (remaining <= 0) {
    // Ueber-Zeit-Leg NICHT reanimieren: derselbe EINE Terminalisierungspfad wie der Boot-
    // Re-Arm-Zombie (F10) - gekappt buchen (billedAt-idempotent) + Leg auflegen (awaited).
    await terminateCappedCall(call.id, call.twilioSid, "failed");
    return { call: null, logUnknown: false };
  }
  // Aktiv im Zeitfenster: den beim Boot-Re-Arm (F10) verpassten Max-Dauer-Cap EINZELN
  // nachziehen (der Call war beim Boot noch nicht im Spiegel), dann normal fortfahren.
  scheduleMaxDurationEnd(call, call.twilioSid, remaining);
  return { call };
}
