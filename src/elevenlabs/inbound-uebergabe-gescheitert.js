// IEX-A2 (O3/E4): die EINE Stelle, an der ein eingehender EL-Anruf als "Uebergabe gescheitert"
// vermerkt wird - Marker set-once (bridgeStateOf -> RUECKFALL: stoppt Bindung am Init-Webhook
// und den Ergebnis-Poll), Fehlergrund, Fristen weg. Kein Transkript, kein Log.
//
// Eigenes Modul statt routes/voice.js (bewusst): der Reihenfolge-Riegel
// (test/fehlergrund-reihenfolge-riegel.test.js R4b) verbietet dort jede freie Grund-Schreibung,
// weil sie an END-Naehten "Grund vor Ende/Buchung" brechen koennte. Hier ist keine End-Naht:
// der Anruf bleibt aktiv, beendet und gebucht wird spaeter ueber /voice/status
// (persistEndWithReason). recordFailureReason ist set-once - der Grund von hier bleibt stehen.
export const INBOUND_EL_GRUND = Object.freeze({
  EL_UEBERGABE_GESCHEITERT: "el_uebergabe_gescheitert",
  // Leser ab IEX-A9 (O5); der Wert ist das Log-Token der Spec.
  EL_OHNE_REGISTRIERUNG: "ohne_el_registrierung",
});

// Nebeneffekte (N7): Marker, Grund, Fristen. Zwei Objekt-Argumente (F1).
export function vermerkeUebergabeGescheitert({ callId, grund, nowMs }, { store, inboundBridges }) {
  store.markInboundElFallback(callId, new Date(nowMs).toISOString());
  store.recordFailureReason(callId, grund);
  inboundBridges.clearDeadlines(callId);
}
