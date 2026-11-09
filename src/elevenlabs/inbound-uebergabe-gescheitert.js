export const INBOUND_EL_GRUND = Object.freeze({
  EL_UEBERGABE_GESCHEITERT: "el_uebergabe_gescheitert",
  EL_OHNE_REGISTRIERUNG: "ohne_el_registrierung",
});

export function vermerkeUebergabeGescheitert({ callId, grund, nowMs }, { store, inboundBridges }) {
  store.markInboundElFallback(callId, new Date(nowMs).toISOString());
  store.recordFailureReason(callId, grund);
  inboundBridges.clearDeadlines(callId);
}
