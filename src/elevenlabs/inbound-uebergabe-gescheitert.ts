export const INBOUND_EL_GRUND = Object.freeze({
  EL_UEBERGABE_GESCHEITERT: "el_uebergabe_gescheitert",
  EL_OHNE_REGISTRIERUNG: "ohne_el_registrierung",
});

interface Vermerk {
  callId: string;
  grund: string;
  nowMs: number;
}

interface Ablage {
  store: {
    markInboundElFallback: (callId: string, zeitpunkt: string) => unknown;
    recordFailureReason: (callId: string, grund: string) => unknown;
  };
  inboundBridges: { clearDeadlines: (callId: string) => unknown };
}

export function vermerkeUebergabeGescheitert(
  { callId, grund, nowMs }: Vermerk,
  { store, inboundBridges }: Ablage,
): void {
  store.markInboundElFallback(callId, new Date(nowMs).toISOString());
  store.recordFailureReason(callId, grund);
  inboundBridges.clearDeadlines(callId);
}
