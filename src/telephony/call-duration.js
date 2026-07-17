// Geteilte Max-Dauer-Rechnung (G5): das harte Max-Dauer-Limit eines Calls in Millisekunden.
// EINE Quelle fuer beide Budget-Engine-Timer in call-lifecycle.js (armMaxDurationTimer +
// Reserve-Release-Backstop) UND den Realtime-Cap-Timer in bridge.js - vorher zweifach die
// rohe Formel "(maxDurationS || default) * 1000", in bridge.js mit rohem Magic-1000 (G25).
//
// Config-frei (Muster state-ops.js callLimitMs): der globale Default (config.maxCallDurationS)
// wird vom Aufrufer hereingereicht - dieses Modul importiert config NICHT, bleibt rein und
// offline unit-testbar. Bewusst NICHT mit state-ops.js callLimitMs vereinheitlicht (OQ-1,
// Owner-bestaetigt): die Store-Schicht darf die Telephony-Schicht nicht importieren -> die
// dritte Stelle bleibt getrennt (dokumentierte Layer-Divergenz, kein G5-Verstoss).
//
// call-eigenes maxDurationS schlaegt den globalen Default (|| : 0/null/undefined -> Default),
// byte-identisch zum bisherigen Verhalten an beiden Call-Sites.
export const MS_PER_SECOND = 1000;

export function callMaxDurationMs(call, defaultMaxDurationS) {
  return (call.maxDurationS || defaultMaxDurationS) * MS_PER_SECOND;
}
