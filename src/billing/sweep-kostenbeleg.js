// KV2-5 (tasks/kostenv2/spec-kv2-5.md): was der Ist-Kosten-Sweep aus EINER Messung ins
// Kosten-Buch schreibt. Muster woertlich src/elevenlabs/kosten-beleg.js (KV2-4): reines
// Regelwerk + EIN fail-softer Schreibaufruf, kein Netz-IO, kein Zustand.
//
// IMPORT-RICHTUNG ist strikt EINSEITIG: cost-truing.js importiert aus dieser Datei, NIE
// umgekehrt - sonst ein Zyklus. Der Anker (belegRef) kommt aus call-leg-ref.js, einem
// dritten, neutralen Modul ohne Abhaengigkeit auf cost-truing.js - EINE Quelle fuer die
// Leg-Referenz, ohne den Zyklus, den ein Rueckimport aus cost-truing.js erzeugen wuerde.

import { REIFE, COST_TRUING_SOURCE, isProviderMicroCents } from "../store/defaults.js";
import { isBelegRef } from "../store/cost-evidence.js";
import { KOSTENART, KOSTENARTEN, KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { legRefOfCall } from "./call-leg-ref.js";

// Belegtyp, der den Traeger telnyx_sip traegt (Katalogzeile #2). EINE Quelle - der
// Traeger fuehrt AUSSCHLIESSLICH sip-trunking, nie die Telnyx-Gesamtkost
// (Owner-Entscheidung 12: der Name darf nicht mehr versprechen als der Betrag traegt).
export const SIP_TRUNKING_RECORD_TYPE = "sip-trunking";

// Herkunft beider Sweep-Belegzeilen. Derselbe String wie COST_TRUING_SOURCE.DETAIL_RECORDS
// (defaults.js) - EINE Quelle, kein zweiter Magic-String neben der Herkunfts-Enum.
export const SWEEP_BELEG_QUELLE = COST_TRUING_SOURCE.DETAIL_RECORDS;

export const SWEEP_BELEG_ABLEHNUNG = Object.freeze({
  KEIN_BELEG: "kein_beleg_des_traegers", // gar kein Record dieses Typs -> keine Zeile
  BETRAG_UNBRAUCHBAR: "betrag_kein_mikro_cent", // Datenfehler -> keine Zeile, NIE 0
  NULL_BEI_MENGE: "betrag_null_bei_menge_groesser_null", // Matrix 4.6, kein Beleg + WARN
  PROFIL_OHNE_SWEEP_TRAEGER: "profil_fuehrt_keinen_sweep_traeger",
});

// (g), Bedingung 1+2 von refundProven - HERAUSGEZOGEN, weil die Reife der
// telnyx_call_records-Zeile sie "Bedingung fuer Bedingung" teilt (Spec KV2-5(g)). EINE
// Quelle (G5): waeren es zwei Ausdruecke, koennten Erstattungs-Beweis und Belegreife
// auseinanderlaufen. Bedingung 3 (isBookableCents) steht bewusst NICHT hier - sie ist eine
// Eigenschaft des ANRUFS, nicht des Belegs, und bleibt in refundProven.
export function belegVollstaendig(measured) {
  return measured.source === COST_TRUING_SOURCE.DETAIL_RECORDS && measured.billedSecTotal > 0;
}

// Welchen Traeger legt der Sweep fuer dieses Profil an? Profil-Trennung aus (g): EL-Route
// bekommt AUSSCHLIESSLICH telnyx_sip, die vier Telnyx-Profile AUSSCHLIESSLICH
// telnyx_call_records. Kein Anruf bekommt beide - sonst stuende derselbe Betrag zweimal in
// der Belegsumme, die KV2-8 bildet. Reines Praedikat.
const TELNYX_CALL_RECORDS_PROFILE = new Set([
  KOSTENPROFIL.TELNYX_ASSISTANT,
  KOSTENPROFIL.TELNYX_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_REALTIME,
  // IE3: der neue Inbound-Weg fuehrt telnyx_call_records mit Einsammler KV2-5g
  // (kostenarten.js). Ohne diesen Eintrag liefert sweepTraegerFuerProfil null, die Zeile
  // wird NIE geschrieben, offeneTraeger bleibt fuer immer nicht-leer - und die Registry
  // behauptete einen Einsammler, den es nicht gibt. Diese Liste ist bewusst explizit
  // (keine Ableitung: die Praezedenz "telnyx_sip ODER telnyx_call_records, nie beide" ist
  // eine Entscheidung, kein Nebeneffekt) - und sie ist gegen die Registry gepinnt
  // (test/ie3-inbound-el-kostenprofil.test.js).
  KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
]);

export function sweepTraegerFuerProfil(profil) {
  if (profil === KOSTENPROFIL.EL_CONVAI_SIP) return KOSTENART.TELNYX_SIP;
  return TELNYX_CALL_RECORDS_PROFILE.has(profil) ? KOSTENART.TELNYX_CALL_RECORDS : null;
}

// KV2-8: die Traeger, deren Beleg aus Telnyx' detail_records stammt - die einzigen, die
// gegen eine Telnyx-RECHNUNG verglichen werden duerfen (cost-cross-check.js). Gepinnt
// gegen sweepTraegerFuerProfil: jeder Wert, den die Funktion liefern kann, steht hier.
export const TELNYX_SWEEP_TRAEGER = Object.freeze([KOSTENART.TELNYX_SIP, KOSTENART.TELNYX_CALL_RECORDS]);

// Matrix 4.6, Geldregel eines bereits summierten Mikro-Cent-Betrags:
//   kein Betrag (null)                  -> keine Zeile (NIE 0: "nicht gemessen" != "0 Kosten")
//   kein gueltiger Mikro-Cent-Wert       -> keine Zeile, Datenfehler
//   Betrag 0 UND Menge > 0               -> keine Zeile + Befund (eine 0 waere hier erfunden)
//   Betrag 0 UND Menge 0                 -> gueltige 0-Zeile (nicht angenommener Anruf)
//   Betrag > 0                           -> gueltige Zeile
// BEWUSST NICHT mit elBelegBetrag (elevenlabs/kosten-beleg.js) zusammengelegt: dort ist die
// Eingabe ein Anbieter-FLOAT (cost_fiat) mit vier zusaetzlichen Formfehlern, hier eine
// bereits gepruefte Ganzzahl-Summe. Gemeinsam sind exakt die zwei 0-Bedingungen; eine
// dritte Stelle loest die Extraktion aus (Dreier-Regel), nicht diese zweite.
export function sweepBelegBetrag({ mikroCents, mengeAngabe }) {
  if (mikroCents === null) return { ablehnung: SWEEP_BELEG_ABLEHNUNG.KEIN_BELEG };
  if (!isProviderMicroCents(mikroCents)) return { ablehnung: SWEEP_BELEG_ABLEHNUNG.BETRAG_UNBRAUCHBAR };
  if (mikroCents === 0 && Number.isSafeInteger(mengeAngabe) && mengeAngabe > 0)
    return { ablehnung: SWEEP_BELEG_ABLEHNUNG.NULL_BEI_MENGE };
  return { mikroCents };
}

// Summe von costMicroCents ueber eine Record-Liste, fail-closed: null sobald EIN Betrag
// kein gueltiger Mikro-Cent-Wert ist oder die laufende Summe den sicheren Ganzzahlbereich
// verlaesst. null heisst NIE "keine Kosten" (Matrix 4.6). EINE Quelle (G5) fuer diese
// Akkumulations-Regel innerhalb dieses Moduls (summeDesTyps ruft sie auf). Exportiert,
// damit ein weiterer Aufrufer sie importieren kann statt sie zu duplizieren - cost-truing.js
// traegt heute noch eine eigene, wortgleiche Kopie (sumRecordMicroCents); sie NICHT hierher
// umzuziehen ist eine bewusste Grenze dieser Aenderung: die Datei steht unter
// eslint-suppressions.json-Altlast, und jede Zeilenverschiebung in ihrer 292-Zeilen-Funktion
// loest das Aufraeum-Gate (check-staged-suppressions.js) aus, das eine Eigentuemer-Freigabe
// verlangt, die dieser Fix nicht hat.
export function sumMicroCents(records) {
  let total = 0;
  for (const record of records) {
    if (!isProviderMicroCents(record?.costMicroCents)) return null;
    total += record.costMicroCents;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

// Summe der Belege EINES Typs, oder null wenn kein Beleg dieses Typs vorliegt bzw. ein
// Betrag kein gueltiger Mikro-Cent-Wert ist. `records` ist hier bereits die auf DIESEN
// Call zugeordnete Port-Record-Liste (der Telnyx-Adapter hat die Zuordnung schon
// entschieden) - diese Funktion filtert nur noch nach recordType.
function summeDesTyps(records, recordType) {
  const passend = records.filter((record) => record.recordType === recordType);
  if (passend.length === 0) return { mikroCents: null, billedSec: 0 };
  const mikroCents = sumMicroCents(passend);
  if (mikroCents === null) return { mikroCents: null, billedSec: 0 };
  const billedSec = passend.reduce(
    (sum, record) => sum + (Number.isSafeInteger(record.billedSec) && record.billedSec > 0 ? record.billedSec : 0), 0);
  return { mikroCents, billedSec };
}

// Die zwei Traeger, zwei Quellen desselben Pools:
//   telnyx_sip            -> nur die sip-trunking-Belege (Betrag + billed_sec dieses Typs)
//   telnyx_call_records   -> measured.actualCostMicroCents + measured.billedSecTotal
//                            (die Telnyx-GESAMTKOST ueber alle zugeordneten Belegtypen)
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

// telnyx_call_records: belegt <=> belegVollstaendig(measured), sonst vorlaeufig ((g)).
// telnyx_sip:          belegt, sobald ein sip-trunking-Beleg mit gueltigem Betrag da ist -
//   der Telnyx-CDR IST der Anbieter-Ist dieses Traegers; er reift nicht nach (anders als
//   ElevenLabs' cost_fiat, KV2-4/4.4). Er haengt AUSDRUECKLICH NICHT an
//   belegVollstaendig(measured): dessen source misst die PROFIL-Pflichtmenge, und die ist
//   fuer el_convai_sip bis zur Messung (d) leer - die telnyx_sip-Zeile bliebe sonst fuer
//   immer vorlaeufig und Abnahmekriterium (c) ("genau eine belegt-Zeile") unerfuellbar.
function reifeFuer(traeger, measured) {
  if (traeger === KOSTENART.TELNYX_SIP) return REIFE.BELEGT;
  return belegVollstaendig(measured) ? REIFE.BELEGT : REIFE.VORLAEUFIG;
}

/**
 * Legt die Sweep-Belegzeile EINES gemessenen Anrufs an. Ein Argument (F1).
 * FAIL-SOFT und zwingend so: recordCallCostEvidence WIRFT (KV2-3, fail-closed gegen
 * Code-Fehler). Ein Wurf hier liefe durch trueOneCall in sweepAllCandidates und braeche
 * die Kandidatenschleife MITTEN im Geldpfad ab - das Kosten-Buch hat in dieser Phase
 * keinen Leser und darf den Abgleich unter keinen Umstaenden anhalten (Muster
 * recordElevenLabsKostenBelege, KV2-4).
 */
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
      waehrung: KOSTENARTEN[traeger].waehrung, // EINE Quelle (G5), = "USD"
      quelle: SWEEP_BELEG_QUELLE,
      belegRef: isBelegRef(eingabe.anker) ? eingabe.anker : null, // zweite Linie, wirft nie
      detail: { billed_sec: eingabe.billedSec },
    });
  } catch (fehler) {
    console.error(`[sweep-kostenbeleg] Belegschreibung fehlgeschlagen (call=${call.id}): ${fehler.message}`);
  }
}
