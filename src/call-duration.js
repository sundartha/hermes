// Geteilte Max-Dauer-Rechnung (G5): das harte Max-Dauer-Limit eines Calls in Millisekunden.
// EINE Quelle fuer beide Telephony-Aufrufer: die Budget-Engine-Timer in
// telephony/call-lifecycle.js (armMaxDurationTimer + Reserve-Release-Backstop) UND den
// Realtime-Cap-Timer in bridge.js - vorher zweifach die rohe Formel
// "(maxDurationS || default) * 1000", in bridge.js mit rohem Magic-1000 (G25).
//
// Bewusst NICHT unter src/telephony/ (Review-Blocker Runde 1): eine Datei innerhalb der
// Telephony-Schicht waere fuer die Store-Schicht (src/store/state-ops.js) technisch nicht
// importierbar (Schichtregel: Store darf Telephony nicht importieren). Dieser Top-Level-Ort
// ist schichtneutral - analog zu src/util.js - und koennte von jeder Schicht importiert werden.
//
// Trotzdem bleibt state-ops.js#callLimitMs eine ZWEITE, unabhaengige Kopie derselben Formel
// (OQ-1, Owner-bestaetigt): die Migration von state-ops.js auf diesen Helfer ist bewusst NICHT
// Teil dieser Runde. Das ist also weiterhin eine ECHTE Duplizierung (G5), keine aufgeloeste -
// nur die Positionierung ist jetzt korrekt fuer eine kuenftige Zusammenfuehrung vorbereitet.
//
// Config-frei (Muster state-ops.js callLimitMs): der globale Default (config.maxCallDurationS)
// wird vom Aufrufer hereingereicht - dieses Modul importiert config NICHT, bleibt rein und
// offline unit-testbar.
//
// call-eigenes maxDurationS schlaegt den globalen Default (|| : 0/null/undefined -> Default),
// byte-identisch zum bisherigen Verhalten an beiden Call-Sites.
export const MS_PER_SECOND = 1000;

export function callMaxDurationMs(call, defaultMaxDurationS) {
  return (call.maxDurationS || defaultMaxDurationS) * MS_PER_SECOND;
}
