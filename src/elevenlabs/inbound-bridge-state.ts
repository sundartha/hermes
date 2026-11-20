import { KOSTENPROFIL } from "../billing/kostenarten.ts";

export const BRIDGE_STATE = Object.freeze({
  KEIN_EL_INBOUND: "kein_el_inbound",
  WARTET: "wartet",
  GEBUNDEN: "gebunden",
  RUECKFALL: "rueckfall",
});

type Anruf = { status?: unknown; costProfile?: unknown; answeredAt?: unknown; elFallbackAt?: unknown; elevenlabsConversationId?: unknown } | null | undefined;

export const istOutboundElProfil = (call: Anruf): boolean => call?.costProfile === KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;

function istElBruecke(call: NonNullable<Anruf>): boolean {
  if (call.costProfile === KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI) return true;
  return istOutboundElProfil(call) && Boolean(call.answeredAt);
}

export function bridgeStateOf(call: Anruf): string {
  if (!call || !istElBruecke(call)) return BRIDGE_STATE.KEIN_EL_INBOUND;
  if (call.elFallbackAt) return BRIDGE_STATE.RUECKFALL;
  if (call.elevenlabsConversationId) return BRIDGE_STATE.GEBUNDEN;
  return BRIDGE_STATE.WARTET;
}

export function uebergabeGescheitert(call: Anruf): boolean {
  return Boolean(call?.elFallbackAt) || bridgeStateOf(call) === BRIDGE_STATE.WARTET;
}

export function inboundAbgewiesen(call: Anruf): boolean {
  return call?.costProfile === KOSTENPROFIL.TELNYX_INBOUND_BUDGET && Boolean(call.elFallbackAt);
}
