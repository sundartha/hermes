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

export function uebergabeGescheitert(call) {
  return Boolean(call?.elFallbackAt) || bridgeStateOf(call) === BRIDGE_STATE.WARTET;
}

export function inboundAbgewiesen(call) {
  return call?.costProfile === KOSTENPROFIL.TELNYX_INBOUND_BUDGET && Boolean(call.elFallbackAt);
}
