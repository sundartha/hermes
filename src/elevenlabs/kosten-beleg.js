import { REIFE } from "../store/defaults.js";
import { isBelegRef } from "../store/cost-evidence.js";
import { KOSTENART, KOSTENARTEN, kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "../billing/kostenarten.js";
import { parseDecimalToMicroCents } from "../telephony/adapters/telnyx/cost-parse.js";

export const EL_BELEG_QUELLE = "elevenlabs_conversation";

export const EL_BELEG_ABLEHNUNG = Object.freeze({
  FEHLT: "cost_fiat_fehlt",
  KEIN_FLOAT: "cost_fiat_kein_float",
  NEGATIV: "cost_fiat_negativ",
  NULL_BEI_DAUER: "cost_fiat_null_bei_dauer_groesser_null",
  NULL_DAUER_UNKLAR: "cost_fiat_null_bei_unbrauchbarer_dauer",
  UNKONVERTIERBAR: "cost_fiat_nicht_in_mikro_cents_ueberfuehrbar",
});

export function anrufFuehrtTelnyxSip(call) {
  const profilFehlt = call?.costProfile == null;
  if (profilFehlt) return true;
  return pflichtTraegerFuerProfil(kostenprofilFuerAnruf(call)).includes(KOSTENART.TELNYX_SIP);
}

function istNichtNegativeGanzzahl(wert) {
  return Number.isSafeInteger(wert) && wert >= 0;
}

function elBelegBeiNullkosten(dauerSekunden) {
  if (!istNichtNegativeGanzzahl(dauerSekunden)) {
    return { ablehnung: EL_BELEG_ABLEHNUNG.NULL_DAUER_UNKLAR };
  }
  if (dauerSekunden > 0) return { ablehnung: EL_BELEG_ABLEHNUNG.NULL_BEI_DAUER };
  return { mikroCents: 0 };
}

export function elBelegBetrag(metadata) {
  const costFiat = metadata?.cost_fiat;
  if (costFiat === undefined || costFiat === null) return { ablehnung: EL_BELEG_ABLEHNUNG.FEHLT };
  if (typeof costFiat !== "number" || !Number.isFinite(costFiat))
    return { ablehnung: EL_BELEG_ABLEHNUNG.KEIN_FLOAT };
  if (costFiat < 0) return { ablehnung: EL_BELEG_ABLEHNUNG.NEGATIV };
  if (costFiat === 0) return elBelegBeiNullkosten(metadata?.call_duration_secs);
  const mikroCents = parseDecimalToMicroCents(String(costFiat));
  return mikroCents === null ? { ablehnung: EL_BELEG_ABLEHNUNG.UNKONVERTIERBAR } : { mikroCents };
}

function recordTelnyxSipErwartet(store, callId) {
  store.recordCallCostEvidence({ callId, traeger: KOSTENART.TELNYX_SIP, reife: REIFE.ERWARTET });
}

function recordElBeleg({ store, callId, conversation, mikroCents, belegNachreifbar }) {
  store.recordCallCostEvidence({
    callId,
    traeger: KOSTENART.ELEVENLABS_CONVAI,
    reife: REIFE.VORLAEUFIG,
    betragMikroCents: mikroCents,
    waehrung: KOSTENARTEN[KOSTENART.ELEVENLABS_CONVAI].waehrung,
    quelle: EL_BELEG_QUELLE,
    belegRef: isBelegRef(conversation?.conversation_id) ? conversation.conversation_id : null,
    gemessenAt: new Date().toISOString(),
    detail: conversation,
    nachreifbar: belegNachreifbar,
  });
}

export function recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar, erwarteTelnyxSip }) {
  try {
    if (erwarteTelnyxSip) recordTelnyxSipErwartet(store, callId);
    const ergebnis = elBelegBetrag(conversation?.metadata);
    if ("ablehnung" in ergebnis) {
      console.warn(`[el-kosten-beleg] kein EL-Beleg (call=${callId}): grund=${ergebnis.ablehnung}`);
      return;
    }
    recordElBeleg({ store, callId, conversation, mikroCents: ergebnis.mikroCents, belegNachreifbar });
  } catch (fehler) {
    console.error(`[el-kosten-beleg] Belegschreibung fehlgeschlagen (call=${callId}): ${fehler.message}`);
  }
}
