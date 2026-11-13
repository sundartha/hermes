import { BRIDGE_STATE, bridgeStateOf, istOutboundElProfil } from "../elevenlabs/inbound-bridge-state.js";
import { ZAEHLWEISE_OUTBOUND } from "./outage-detection.ts";

export const INBOUND_EL_OUTAGE_CODE = "inbound-el:uebergabe";
export const OUTBOUND_EL_OUTAGE_CODE = "outbound-el:uebergabe";

interface AusfallAnruf {
  direction?: string | undefined;
}

interface AusfallSchwellen {
  windowMs: number;
  minFailures: number;
  minAttempts: number;
  failSharePercent: number;
  debounceMs: number;
  retryMs: number;
}

interface AusfallConfig {
  billing: {
    outageAlertWindowMs: number;
    outageAlertMinFailures: number;
    outageAlertMinAttempts: number;
    outageAlertFailSharePercent: number;
    outageAlertDebounceMs: number;
    outageAlertRetryMs: number;
    inboundOutageAlertWindowMs: number;
    inboundOutageAlertMinFailures: number;
    inboundOutageAlertMinAttempts: number;
    inboundOutageAlertFailSharePercent: number;
  };
}

const MELDER_AUS = 0;
function fensterOderAus(windowMs: number): number {
  return Number.isFinite(windowMs) ? windowMs : MELDER_AUS;
}

const RICHTUNG_OUTBOUND = "outbound";

const ZAEHLWEISE_INBOUND_EL = Object.freeze({
  zaehltMit: (call: AusfallAnruf | null | undefined) =>
    call?.direction !== RICHTUNG_OUTBOUND && bridgeStateOf(call) !== BRIDGE_STATE.KEIN_EL_INBOUND,
  belegtErfolg: (call: AusfallAnruf) => bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN,
  belegtFehler: (call: AusfallAnruf) => bridgeStateOf(call) === BRIDGE_STATE.RUECKFALL,
});

const ZAEHLWEISE_OUTBOUND_EL = Object.freeze({
  zaehltMit: (call: AusfallAnruf) => istOutboundElProfil(call) && bridgeStateOf(call) !== BRIDGE_STATE.KEIN_EL_INBOUND,
  belegtErfolg: (call: AusfallAnruf) => bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN,
  belegtFehler: (call: AusfallAnruf) => bridgeStateOf(call) === BRIDGE_STATE.RUECKFALL,
});

const outboundSchwellen = (config: AusfallConfig): AusfallSchwellen => ({
  windowMs: config.billing.outageAlertWindowMs,
  minFailures: config.billing.outageAlertMinFailures,
  minAttempts: config.billing.outageAlertMinAttempts,
  failSharePercent: config.billing.outageAlertFailSharePercent,
  debounceMs: config.billing.outageAlertDebounceMs,
  retryMs: config.billing.outageAlertRetryMs,
});

export const AUSFALL_KLASSE = Object.freeze({
  OUTBOUND: Object.freeze({
    zaehlweise: ZAEHLWEISE_OUTBOUND,
    schwellen: outboundSchwellen,
  }),
  OUTBOUND_EL: Object.freeze({
    code: OUTBOUND_EL_OUTAGE_CODE,
    zaehlweise: ZAEHLWEISE_OUTBOUND_EL,
    schwellen: outboundSchwellen,
  }),
  INBOUND_EL: Object.freeze({
    code: INBOUND_EL_OUTAGE_CODE,
    zaehlweise: ZAEHLWEISE_INBOUND_EL,
    schwellen: (config: AusfallConfig): AusfallSchwellen => ({
      windowMs: fensterOderAus(config.billing.inboundOutageAlertWindowMs),
      minFailures: config.billing.inboundOutageAlertMinFailures,
      minAttempts: config.billing.inboundOutageAlertMinAttempts,
      failSharePercent: config.billing.inboundOutageAlertFailSharePercent,
      debounceMs: config.billing.outageAlertDebounceMs,
      retryMs: config.billing.outageAlertRetryMs,
    }),
  }),
});
