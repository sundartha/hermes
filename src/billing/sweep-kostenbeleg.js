import { REIFE, COST_TRUING_SOURCE, isProviderMicroCents } from "../store/defaults.js";
import { isBelegRef } from "../store/cost-evidence.js";
import { KOSTENART, KOSTENARTEN, KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { legRefOfCall } from "./call-leg-ref.js";

export const SIP_TRUNKING_RECORD_TYPE = "sip-trunking";

export const SWEEP_BELEG_QUELLE = COST_TRUING_SOURCE.DETAIL_RECORDS;

export const SWEEP_BELEG_ABLEHNUNG = Object.freeze({
  KEIN_BELEG: "kein_beleg_des_traegers",
  BETRAG_UNBRAUCHBAR: "betrag_kein_mikro_cent",
  NULL_BEI_MENGE: "betrag_null_bei_menge_groesser_null",
  PROFIL_OHNE_SWEEP_TRAEGER: "profil_fuehrt_keinen_sweep_traeger",
});

export function belegVollstaendig(measured) {
  return measured.source === COST_TRUING_SOURCE.DETAIL_RECORDS && measured.billedSecTotal > 0;
}

const TELNYX_CALL_RECORDS_PROFILE = new Set([
  KOSTENPROFIL.TELNYX_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
]);

export function sweepTraegerFuerProfil(profil) {
  if (profil === KOSTENPROFIL.EL_CONVAI_SIP) return KOSTENART.TELNYX_SIP;
  return TELNYX_CALL_RECORDS_PROFILE.has(profil) ? KOSTENART.TELNYX_CALL_RECORDS : null;
}

export const TELNYX_SWEEP_TRAEGER = Object.freeze([KOSTENART.TELNYX_SIP, KOSTENART.TELNYX_CALL_RECORDS]);

export function sweepBelegBetrag({ mikroCents, mengeAngabe }) {
  if (mikroCents === null) return { ablehnung: SWEEP_BELEG_ABLEHNUNG.KEIN_BELEG };
  if (!isProviderMicroCents(mikroCents)) return { ablehnung: SWEEP_BELEG_ABLEHNUNG.BETRAG_UNBRAUCHBAR };
  if (mikroCents === 0 && Number.isSafeInteger(mengeAngabe) && mengeAngabe > 0)
    return { ablehnung: SWEEP_BELEG_ABLEHNUNG.NULL_BEI_MENGE };
  return { mikroCents };
}

export function sumMicroCents(records) {
  let total = 0;
  for (const record of records) {
    if (!isProviderMicroCents(record?.costMicroCents)) return null;
    total += record.costMicroCents;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function summeDesTyps(records, recordType) {
  const passend = records.filter((record) => record.recordType === recordType);
  if (passend.length === 0) return { mikroCents: null, billedSec: 0 };
  const mikroCents = sumMicroCents(passend);
  if (mikroCents === null) return { mikroCents: null, billedSec: 0 };
  const billedSec = passend.reduce(
    (sum, record) => sum + (Number.isSafeInteger(record.billedSec) && record.billedSec > 0 ? record.billedSec : 0), 0);
  return { mikroCents, billedSec };
}

function belegEingabeFuer({ traeger, call, measured, records }) {
  const anker = legRefOfCall(call);
  if (traeger === KOSTENART.TELNYX_SIP) {
    const { mikroCents, billedSec } = summeDesTyps(records, SIP_TRUNKING_RECORD_TYPE);
    const betrag = sweepBelegBetrag({ mikroCents, mengeAngabe: billedSec });
    return "ablehnung" in betrag ? betrag : { mikroCents: betrag.mikroCents, billedSec, anker };
  }
  const betrag = sweepBelegBetrag({ mikroCents: measured.actualCostMicroCents, mengeAngabe: measured.billedSecTotal });
  return "ablehnung" in betrag ? betrag : { mikroCents: betrag.mikroCents, billedSec: measured.billedSecTotal, anker };
}

function reifeFuer(traeger, measured) {
  if (traeger === KOSTENART.TELNYX_SIP) return REIFE.BELEGT;
  return belegVollstaendig(measured) ? REIFE.BELEGT : REIFE.VORLAEUFIG;
}

export function schreibeSweepKostenbeleg({ store, call, measured, records }) {
  try {
    const traeger = sweepTraegerFuerProfil(kostenprofilFuerAnruf(call));
    if (!traeger) {
      console.warn(`[sweep-kostenbeleg] kein Beleg (call=${call.id}): grund=${SWEEP_BELEG_ABLEHNUNG.PROFIL_OHNE_SWEEP_TRAEGER}`);
      return;
    }
    const eingabe = belegEingabeFuer({ traeger, call, measured, records });
    if ("ablehnung" in eingabe) {
      console.warn(`[sweep-kostenbeleg] kein Beleg (call=${call.id}, traeger=${traeger}): grund=${eingabe.ablehnung}`);
      return;
    }
    store.recordCallCostEvidence({
      callId: call.id,
      traeger,
      reife: reifeFuer(traeger, measured),
      betragMikroCents: eingabe.mikroCents,
      waehrung: KOSTENARTEN[traeger].waehrung,
      quelle: SWEEP_BELEG_QUELLE,
      belegRef: isBelegRef(eingabe.anker) ? eingabe.anker : null,
      detail: { billed_sec: eingabe.billedSec },
    });
  } catch (fehler) {
    console.error(`[sweep-kostenbeleg] Belegschreibung fehlgeschlagen (call=${call.id}): ${fehler.message}`);
  }
}
