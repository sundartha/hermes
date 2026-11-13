import { KOSTENPROFIL } from "../billing/kostenarten.js";
import { ABSENDER_QUELLE } from "../telephony/absender-registrierung.ts";
import { inboundElPathFor } from "./inbound-path-decision.js";
import { eigeneAbsenderRegistrierung } from "./outbound.js";
import { meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_RUECKFALL } from "./vorspann-pruefung.js";

export const OUTBOUND_WEG = Object.freeze({
  BUDGET: "budget",
  EL_SIP_TRUNK: "el_sip_trunk",
  TELNYX_UEBERGABE: "telnyx_uebergabe",
  TELNYX_VORSPANN: "telnyx_vorspann",
});

export const WEG_GRUND = Object.freeze({ INBOUND_WEG_NICHT_BEREIT: "inbound_weg_nicht_bereit" });

export const KOSTENPROFIL_FUER_WEG = Object.freeze({
  [OUTBOUND_WEG.BUDGET]: KOSTENPROFIL.TELNYX_BUDGET,
  [OUTBOUND_WEG.EL_SIP_TRUNK]: KOSTENPROFIL.EL_CONVAI_SIP,
  [OUTBOUND_WEG.TELNYX_UEBERGABE]: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
  [OUTBOUND_WEG.TELNYX_VORSPANN]: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
});

const LOG_PREFIX = "[el-outbound-weg]";

function weg(art, grund = null) {
  return { weg: art, grund };
}

export function outboundWegFuer({ config, store, call }) {
  const el = config.voice.elevenLabsOutbound;
  if (!el.enabled) return weg(OUTBOUND_WEG.BUDGET);
  if (!el.ueberTelnyx) return weg(OUTBOUND_WEG.EL_SIP_TRUNK);
  const absender = eigeneAbsenderRegistrierung({ store, call });
  if (absender.quelle !== ABSENDER_QUELLE.TENANT_DID) return weg(OUTBOUND_WEG.EL_SIP_TRUNK, absender.grund);
  const numberRecord = store.numberRecordByE164(call.from);
  if (!inboundElPathFor({ config, tenantId: call.tenantId, numberRecord }))
    return weg(OUTBOUND_WEG.EL_SIP_TRUNK, WEG_GRUND.INBOUND_WEG_NICHT_BEREIT);
  return uebergabeWeg(config);
}

function uebergabeWeg(config) {
  if (!config.voice.elevenLabsOutbound.vorspann) return weg(OUTBOUND_WEG.TELNYX_UEBERGABE);
  if (!config.telephony.telnyxCallControlAppId)
    return weg(OUTBOUND_WEG.TELNYX_UEBERGABE, VORSPANN_RUECKFALL.KEINE_CALL_CONTROL_APP);
  return weg(OUTBOUND_WEG.TELNYX_VORSPANN);
}

export function meldeOutboundWeg({ config, callId, wahl }) {
  if (!config.voice.elevenLabsOutbound.ueberTelnyx) return;
  const grund = wahl.grund ? ` grund=${wahl.grund}` : "";
  console.log(`${LOG_PREFIX} weg=${wahl.weg}${grund} call=${callId}`);
  if (wahl.grund === VORSPANN_RUECKFALL.KEINE_CALL_CONTROL_APP) meldeVorspannRueckfall({ callId, grund: wahl.grund });
}
