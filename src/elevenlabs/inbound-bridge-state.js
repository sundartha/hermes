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
