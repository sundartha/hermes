import { BRIDGE_STATE, bridgeStateOf } from "../elevenlabs/inbound-bridge-state.js";
import { ZAEHLWEISE_OUTBOUND } from "./outage-detection.js";

export const INBOUND_EL_OUTAGE_CODE = "inbound-el:uebergabe";

const MELDER_AUS = 0;
function fensterOderAus(windowMs) {
  return Number.isFinite(windowMs) ? windowMs : MELDER_AUS;
}

const ZAEHLWEISE_INBOUND_EL = Object.freeze({
  zaehltMit: (call) => bridgeStateOf(call) !== BRIDGE_STATE.KEIN_EL_INBOUND,
  belegtErfolg: (call) => bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN,
  belegtFehler: (call) => bridgeStateOf(call) === BRIDGE_STATE.RUECKFALL,
});

export const AUSFALL_KLASSE = Object.freeze({
  OUTBOUND: Object.freeze({
    zaehlweise: ZAEHLWEISE_OUTBOUND,
    schwellen: (config) => ({
      windowMs: config.billing.outageAlertWindowMs,
      minFailures: config.billing.outageAlertMinFailures,
      minAttempts: config.billing.outageAlertMinAttempts,
      failSharePercent: config.billing.outageAlertFailSharePercent,
      debounceMs: config.billing.outageAlertDebounceMs,
      retryMs: config.billing.outageAlertRetryMs,
    }),
  }),
  INBOUND_EL: Object.freeze({
    code: INBOUND_EL_OUTAGE_CODE,
    zaehlweise: ZAEHLWEISE_INBOUND_EL,
    schwellen: (config) => ({
      windowMs: fensterOderAus(config.billing.inboundOutageAlertWindowMs),
      minFailures: config.billing.inboundOutageAlertMinFailures,
      minAttempts: config.billing.inboundOutageAlertMinAttempts,
      failSharePercent: config.billing.inboundOutageAlertFailSharePercent,
      debounceMs: config.billing.outageAlertDebounceMs,
      retryMs: config.billing.outageAlertRetryMs,
    }),
  }),
});
