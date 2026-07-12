// stab-p9: EIN fail-safe Call-Control-Hangup-Primitiv (S2/G5), geteilt vom Brain-Shim
// (Budget-Kill, end_call) und vom Conversation-Watchdog (Dead-Air). Beendet einen Call
// out-of-band ueber Call-Control - NIE eine Origination (Regel 1). Fail-safe: fehlende
// callControlId -> Skip+Log (kein Crash/Orphan); ein Hangup-Fehler wird nur secret-frei
// (err.name) geloggt, nie geworfen (die Response ist zu diesem Zeitpunkt bereits raus).
// Frischer Store-Stand pro Aufruf (callControlId kann waehrend des Turns gesetzt worden
// sein - Muster P4.5 onHangup). KEIN Store-Write (Settlement bleibt allein call.hangup ->
// onHangup, EIN idempotenter Pfad ueber billedAt/reserveReleased).
export function makeCallControlTerminator({ store, voiceControl, logPrefix }) {
  return async function terminateViaCallControl(callId) {
    const fresh = store.getCall(callId);
    const callControlId = fresh && fresh.callControlId;
    if (!callControlId) {
      console.warn(`${logPrefix} Hangup ohne callControlId (call=${callId}) -> kein Hangup`);
      return;
    }
    try {
      await voiceControl(fresh.provider).endCallViaCallControl(callControlId);
    } catch (err) {
      console.error(`${logPrefix} Call-Control-Hangup fehlgeschlagen:`, err && err.name);
    }
  };
}
