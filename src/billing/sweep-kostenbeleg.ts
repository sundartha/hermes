import { REIFE, COST_TRUING_SOURCE, isProviderMicroCents } from "../begriffe/abrechnung.js";
import { isBelegRef } from "../store/cost-evidence.js";
import { KOSTENART, KOSTENARTEN, KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { legRefOfCall } from "./call-leg-ref.ts";
import type { AbschlussAnruf } from "./kosten-abschluss.ts";

interface SweepAnruf extends AbschlussAnruf {
  id: string;
  twilioSid?: string | null | undefined;
  callControlId?: string | null | undefined;
}

interface Messung {
  source: string;
  billedSecTotal: number;
  actualCostMicroCents: number | null;
}

interface Detailsatz {
  recordType?: string;
  costMicroCents?: number;
  billedSec?: number;
}

interface SweepSpeicher {
  recordCallCostEvidence(eintrag: Record<string, unknown>): unknown;
}

type Traeger = (typeof KOSTENART)[keyof typeof KOSTENART];

type Ablehnung = (typeof SWEEP_BELEG_ABLEHNUNG)[keyof typeof SWEEP_BELEG_ABLEHNUNG];

type Belegbetrag = { mikroCents: number } | { ablehnung: Ablehnung };

type BelegEingabe = { mikroCents: number; billedSec: number; anker: string | null } | { ablehnung: Ablehnung };

interface Belegauftrag {
  store: SweepSpeicher;
  call: SweepAnruf;
  measured: Messung;
  records: Detailsatz[];
}

const kostenprofilVon: (call: AbschlussAnruf) => string = kostenprofilFuerAnruf;
const istBelegRef: (wert: unknown) => boolean = isBelegRef;

export const SIP_TRUNKING_RECORD_TYPE = "sip-trunking";

export const SWEEP_BELEG_QUELLE = COST_TRUING_SOURCE.DETAIL_RECORDS;

export const SWEEP_BELEG_ABLEHNUNG = Object.freeze({
  KEIN_BELEG: "kein_beleg_des_traegers",
  BETRAG_UNBRAUCHBAR: "betrag_kein_mikro_cent",
  NULL_BEI_MENGE: "betrag_null_bei_menge_groesser_null",
  PROFIL_OHNE_SWEEP_TRAEGER: "profil_fuehrt_keinen_sweep_traeger",
});

export function belegVollstaendig(measured: Pick<Messung, "source" | "billedSecTotal">): boolean {
  return measured.source === COST_TRUING_SOURCE.DETAIL_RECORDS && measured.billedSecTotal > 0;
}

const TELNYX_CALL_RECORDS_PROFILE = new Set<string>([
  KOSTENPROFIL.TELNYX_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
  KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
]);

export function sweepTraegerFuerProfil(profil: string): Traeger | null {
  if (profil === KOSTENPROFIL.EL_CONVAI_SIP) return KOSTENART.TELNYX_SIP;
  return TELNYX_CALL_RECORDS_PROFILE.has(profil) ? KOSTENART.TELNYX_CALL_RECORDS : null;
}

export const TELNYX_SWEEP_TRAEGER = Object.freeze([KOSTENART.TELNYX_SIP, KOSTENART.TELNYX_CALL_RECORDS]);

export function sweepBelegBetrag({ mikroCents, mengeAngabe }: { mikroCents: number | null; mengeAngabe: number }): Belegbetrag {
  if (mikroCents === null) return { ablehnung: SWEEP_BELEG_ABLEHNUNG.KEIN_BELEG };
  if (!isProviderMicroCents(mikroCents)) return { ablehnung: SWEEP_BELEG_ABLEHNUNG.BETRAG_UNBRAUCHBAR };
  if (mikroCents === 0 && Number.isSafeInteger(mengeAngabe) && mengeAngabe > 0)
    return { ablehnung: SWEEP_BELEG_ABLEHNUNG.NULL_BEI_MENGE };
  return { mikroCents };
}

export function sumMicroCents(records: Detailsatz[]): number | null {
  let total = 0;
  for (const record of records) {
    const kosten = record.costMicroCents;
    if (kosten === undefined || !isProviderMicroCents(kosten)) return null;
    total += kosten;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function summeDesTyps(records: Detailsatz[], recordType: string): { mikroCents: number | null; billedSec: number } {
  const passend = records.filter((record) => record.recordType === recordType);
  if (passend.length === 0) return { mikroCents: null, billedSec: 0 };
  const mikroCents = sumMicroCents(passend);
  if (mikroCents === null) return { mikroCents: null, billedSec: 0 };
  const billedSec = passend.reduce(
    (sum: number, { billedSec: sec = 0 }) => sum + (Number.isSafeInteger(sec) ? Math.max(sec, 0) : 0), 0);
  return { mikroCents, billedSec };
}

function belegEingabeFuer({ traeger, call, measured, records }: Omit<Belegauftrag, "store"> & { traeger: Traeger }): BelegEingabe {
  const anker = legRefOfCall(call);
  if (traeger === KOSTENART.TELNYX_SIP) {
    const { mikroCents, billedSec } = summeDesTyps(records, SIP_TRUNKING_RECORD_TYPE);
    const betrag = sweepBelegBetrag({ mikroCents, mengeAngabe: billedSec });
    return "ablehnung" in betrag ? betrag : { mikroCents: betrag.mikroCents, billedSec, anker };
  }
  const betrag = sweepBelegBetrag({ mikroCents: measured.actualCostMicroCents, mengeAngabe: measured.billedSecTotal });
  return "ablehnung" in betrag ? betrag : { mikroCents: betrag.mikroCents, billedSec: measured.billedSecTotal, anker };
}

function reifeFuer(traeger: Traeger, measured: Messung): string {
  if (traeger === KOSTENART.TELNYX_SIP) return REIFE.BELEGT;
  return belegVollstaendig(measured) ? REIFE.BELEGT : REIFE.VORLAEUFIG;
}

export function schreibeSweepKostenbeleg({ store, call, measured, records }: Belegauftrag): void {
  try {
    const traeger = sweepTraegerFuerProfil(kostenprofilVon(call));
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
      belegRef: istBelegRef(eingabe.anker) ? eingabe.anker : null,
      detail: { billed_sec: eingabe.billedSec },
    });
  } catch (fehler) {
    const art = fehler instanceof Error ? fehler.name : typeof fehler;
    console.error(`[sweep-kostenbeleg] Belegschreibung fehlgeschlagen (call=${call.id}): art=${art}`);
  }
}
