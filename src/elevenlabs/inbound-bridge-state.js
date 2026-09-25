// IEL-B4a (E5): der Brueckenzustand eines eingehenden Anrufs, der an den ElevenLabs-Agenten
// uebergeben wird - als REINES Praedikat ueber PERSISTIERTE Felder. Kein Prozessspeicher,
// kein Store, kein config, kein IO: jeder Leser (Rueckfall-Route, Bein-Callback, Status-
// Callback, Init-Webhook, EL-Poll, Boot-Re-Arm) bekommt nach einem Neustart dieselbe Antwort.
// Blatt-Modul (importiert nur die Kostenprofil-Registry) - darf von store/state-ops.js
// gelesen werden, ohne Zyklus.
// Rangfolge ist bindend: Rueckfall-Marker schlaegt Bindung (ein Rueckfall nach Bindung
// ist RUECKFALL), Bindung schlaegt Warten. Der Nachlauf-Marker aendert den Zustand nicht.
// Altdatensatz ohne Felder (undefined) -> wie null (Truthiness), kein Backfill noetig.
import { KOSTENPROFIL } from "../billing/kostenarten.js";

export const BRIDGE_STATE = Object.freeze({
  KEIN_EL_INBOUND: "kein_el_inbound",
  WARTET: "wartet",
  GEBUNDEN: "gebunden",
  RUECKFALL: "rueckfall",
});

export function bridgeStateOf(call) {
  if (call?.costProfile !== KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI) return BRIDGE_STATE.KEIN_EL_INBOUND;
  if (call.elFallbackAt) return BRIDGE_STATE.RUECKFALL;
  if (call.elevenlabsConversationId) return BRIDGE_STATE.GEBUNDEN;
  return BRIDGE_STATE.WARTET;
}

// IEX-A2 (E5/O3): die Uebergabe an den Agenten ist gescheitert - Marker gesetzt (Fehlersatz bzw.
// Abweisung) ODER ein EL-Bein endete nie gebunden (WARTET: Dial ohne <Redirect>, gescheiterte
// Umleitung, Auflegen beim Freizeichen - mit persistierten Feldern nicht trennbar, Spec 9 F4).
// GEBUNDEN ohne Marker: ein Gespraech fand statt. Budget ohne Marker: unveraendert.
export function uebergabeGescheitert(call) {
  return Boolean(call?.elFallbackAt) || bridgeStateOf(call) === BRIDGE_STATE.WARTET;
}

// IEX-A9 (O5/E10): abgewiesener Inbound-Anruf - Inbound-Budget-Kostenprofil (Kurzbein) MIT Marker. Nur
// die Abweisung setzt einen Marker ausserhalb des EL-Profils; ein anderes Profil (Outbound) gilt nie als
// abgewiesen. Leser: Wiederholungs-Antwort (routes/voice.js).
export function inboundAbgewiesen(call) {
  return call?.costProfile === KOSTENPROFIL.TELNYX_INBOUND_BUDGET && Boolean(call.elFallbackAt);
}
