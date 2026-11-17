import { KOSTENPROFIL } from "../billing/kostenarten.js";
import { inboundElPathFor } from "./inbound-path-decision.ts";

export const OUTBOUND_WEG = Object.freeze({ TELNYX_VORSPANN: "telnyx_vorspann" });

export const WEG_GRUND = Object.freeze({
  INBOUND_WEG_NICHT_BEREIT: "inbound_weg_nicht_bereit",
  KEINE_CALL_CONTROL_APP: "keine_call_control_app",
});

export const KOSTENPROFIL_FUER_WEG = Object.freeze({
  [OUTBOUND_WEG.TELNYX_VORSPANN]: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
});

type EntscheidungsFall = Parameters<typeof inboundElPathFor>[0];

interface WegConfig {
  voice: {
    elevenLabsInbound: EntscheidungsFall["config"]["voice"]["elevenLabsInbound"];
  };
  telephony: { telnyxCallControlAppId: string | undefined };
}

interface WegStore {
  numberRecordByE164: (e164: string) => EntscheidungsFall["numberRecord"];
}

interface WegAnruf {
  tenantId: unknown;
  from: string;
}

type WegArt = keyof typeof KOSTENPROFIL_FUER_WEG;

interface Wahl {
  weg: WegArt | null;
  grund: string | null;
}

const LOG_PREFIX = "[el-outbound-weg]";

const vorspannWeg: Wahl = { weg: OUTBOUND_WEG.TELNYX_VORSPANN, grund: null };

function abbruch(grund: string | null): Wahl {
  return { weg: null, grund };
}

export function outboundWegFuer({ config, store, call }: { config: WegConfig; store: WegStore; call: WegAnruf }): Wahl {
  if (!config.telephony.telnyxCallControlAppId) return abbruch(WEG_GRUND.KEINE_CALL_CONTROL_APP);
  const numberRecord = store.numberRecordByE164(call.from);
  if (!inboundElPathFor({ config, tenantId: call.tenantId, numberRecord }))
    return abbruch(WEG_GRUND.INBOUND_WEG_NICHT_BEREIT);
  return vorspannWeg;
}

export function meldeOutboundWeg({ callId, wahl }: { callId: string; wahl: Wahl }): void {
  const grund = wahl.grund ? ` grund=${wahl.grund}` : "";
  console.log(`${LOG_PREFIX} weg=${wahl.weg ?? "abbruch"}${grund} call=${callId}`);
}
