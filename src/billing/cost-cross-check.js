// KV-M4: monatliche Gegenprobe (reine Beobachtung, KEIN Gate, KEINE Sperrwirkung, KEINE
// Schwelle, KEIN Alarm). Stellt einmal je Kalendermonat drei Betraege nebeneinander und
// LOGGT NUR:
//   1. Telnyx-Monatssumme (Provider-Rechnung, /v2/invoices - Monats-Rollup)
//   2. Summe der abgerufenen Ist-Kosten unserer Telnyx-Calls des Monats (actual_cost_micro_cents)
//   3. Summe der auf die Gate-Achse gebuchten Carrier-Betraege des Monats (Ledger-Proxy)
//
// Faellt (1) merklich ueber (2): eine Kosten-Art, die wir nicht ABRUFEN.
// Faellt (2) merklich ueber (3): eine Kosten-Art, die wir abrufen, aber nicht BUCHEN.
//
// WAEHRUNG (die Falle dieser Phase): (1) und (2) sind BEIDE Provider-Waehrung (USD-Mikro-
// Cent, Diff nativ ohne Umrechnung). (3) ist Bucket-Waehrung (EUR-Cent) - die Umrechnung
// (2)->EUR lebt an GENAU DER EINEN bestehenden Kante, providerMicroCentsToBucketCents
// (cost-calibration.js, dieselbe Funktion wie der Tarif-Drift-Waechter), MIT der Rate im
// Log sichtbar. Es gibt KEINE dritte, ueber den Waehrungsbruch hinweg gebildete Differenz.
//
// TELNYX-RECHNUNGSBETRAG STRUKTURELL NICHT VERFUEGBAR (live verifiziert 2026-08-03, s.
// telephony/adapters/telnyx/voice.js Kopf-Kommentar der KV-M4-Sektion): die Invoice-
// Ressource traegt keinen Geldbetrag. fetchMonthlyInvoiceTotal liefert deshalb heute IMMER
// ok:false - Diff 1 (Rechnung vs. Ist) bleibt bis zu einer Telnyx-Schema-Aenderung oder
// einer anderen Provider-Quelle unbeantwortet; Diff 2 (Ist vs. Gate-Buchung) bleibt
// vollstaendig funktionsfaehig und beantwortet die zweite der beiden Fragen.
//
// FEHLERFALL (Pflichtabnahme 3): diese Funktion WIRFT NIE - jeder Fehlerpfad (Provider
// antwortet nicht, Netzfehler, keine Rechnung fuer den Monat) landet in einem
// Ergebnis-Objekt. Der Aufrufer (boot.js) haengt zusaetzlich ein .catch() an (zweite
// Linie, Muster runCostTruingSweep/settleDueNumberMonthMeters) - eine Beobachtung, die den
// Ist-Abgleich mitreisst, waere schlimmer als keine Beobachtung.
//
// SECRETS: keine Rohantwort, kein API-Key, keine Call-IDs in der Log-Zeile - nur die
// aggregierten Betraege und der Monatsschluessel (Regel 4/5).
import { PROVIDER } from "../store/defaults.js";
import {
  crossCheckDueMonthKey,
  actualCostMicroCentsForMonth,
  carrierGateCostCentsForMonth,
} from "../store/state-ops.js";
import { providerMicroCentsToBucketCents } from "./cost-calibration.js";

const UNAVAILABLE_REASON = Object.freeze({
  NO_TELNYX_ADAPTER: "no_telnyx_adapter",
  PORT_MISSING: "port_missing",
  FETCH_REJECTED: "provider_error",
});

// Die Log-Zeile im ok:true-Fall: zwei Differenzen, jede zwischen tatsaechlich
// vergleichbaren Groessen (Befund C) - USD gegen USD nativ, EUR gegen EUR nach expliziter
// Konvertierung MIT der Rate im Feldnamen. convertedEurCents kann null sein
// (providerMicroCentsToBucketCents verlaesst den sicheren Integer-Bereich) - dann zeigt
// die Zeile "null" statt einer erfundenen Zahl (G26/PM-4).
function crossCheckLineOk({ monthKey, invoice, actualUsdMicroCents, gateCarrierEurCents, rateMicro }) {
  const convertedEurCents = providerMicroCentsToBucketCents(actualUsdMicroCents, rateMicro);
  const diffRechnungMinusIst = invoice.totalMicroCents - actualUsdMicroCents;
  const diffIstMinusGate = convertedEurCents === null ? null : convertedEurCents - gateCarrierEurCents;
  return (
    `[cost-cross-check] monat=${monthKey} telnyx_rechnung_usd_micro_cent=${invoice.totalMicroCents} ` +
    `ist_calls_usd_micro_cent=${actualUsdMicroCents} diff_rechnung_minus_ist_usd_micro_cent=${diffRechnungMinusIst} ` +
    `gate_carrier_eur_cent=${gateCarrierEurCents} ist_konvertiert_eur_cent(rate=${rateMicro})=${convertedEurCents} ` +
    `diff_ist_minus_gate_eur_cent=${diffIstMinusGate}`
  );
}

// Bei Provider-Fehlschlag/keine Rechnung fuer den Monat: KEINE Diffs gegen "nicht
// verfuegbar" - eine Differenz gegen einen fehlenden Wert waere eine erfundene Zahl (G26).
function crossCheckLineUnavailable({ monthKey, invoice, actualUsdMicroCents, gateCarrierEurCents }) {
  return (
    `[cost-cross-check] monat=${monthKey} telnyx_rechnung=nicht_verfuegbar(reason=${invoice.reason}) ` +
    `ist_calls_usd_micro_cent=${actualUsdMicroCents} gate_carrier_eur_cent=${gateCarrierEurCents}`
  );
}

function logCrossCheckLine(params) {
  console.log(params.invoice.ok ? crossCheckLineOk(params) : crossCheckLineUnavailable(params));
}

// Loest den Telnyx-Adapter auf (KE-P9-Muster costRecordControlFor, cost-truing.js):
// unbekannter Provider (Registry wirft fail-closed) oder ein Adapter ohne die Methode
// sind BEIDE "kein Abgleich moeglich" - der konservative Fall (kein Provider-Aufruf).
function resolveTelnyxInvoiceControl(voiceControl) {
  let control;
  try {
    control = voiceControl(PROVIDER.TELNYX);
  } catch {
    return { control: null, reason: UNAVAILABLE_REASON.NO_TELNYX_ADAPTER };
  }
  if (typeof control.fetchMonthlyInvoiceTotal !== "function")
    return { control: null, reason: UNAVAILABLE_REASON.PORT_MISSING };
  return { control, reason: null };
}

export function makeCostCrossCheck({ store, config, voiceControl }) {
  async function fetchInvoiceTotal(monthKey) {
    const { control, reason } = resolveTelnyxInvoiceControl(voiceControl);
    if (control === null) return { ok: false, reason };
    // Der Port WIRFT NIE - zweite Linie, falls ein Adapter die Zusage doch bricht (Muster
    // des Belegabruf-Wrappers in cost-truing.js).
    return control
      .fetchMonthlyInvoiceTotal({ month: monthKey })
      .catch(() => ({ ok: false, reason: UNAVAILABLE_REASON.FETCH_REJECTED }));
  }

  async function runMonthlyCrossCheck(nowIso = new Date().toISOString()) {
    const s = store.load();
    const monthKey = crossCheckDueMonthKey(s, nowIso);
    if (monthKey === null) return { skipped: true };

    const invoice = await fetchInvoiceTotal(monthKey);
    // Lastbudget (TEIL 3): hoechstens EIN Provider-Aufruf je Kalendermonat - der Riegel wird
    // IMMER gestempelt, Erfolg oder Fehlschlag. Ein Riegel, der nur bei Erfolg stempelt,
    // fragte einen dauerhaft fehlschlagenden Provider stuendlich neu an (bis zu 730
    // Aufrufe/Monat) und braeche das Lastbudget. Die Kehrseite ist bewusst akzeptiert: ein
    // Monat mit Provider-Ausfall bleibt fuer immer ungeloggt (kein automatisches Nachholen).
    store.markCostCrossCheckAttempted(monthKey);

    const actualUsdMicroCents = actualCostMicroCentsForMonth(s, monthKey);
    const gateCarrierEurCents = carrierGateCostCentsForMonth(s, monthKey);
    logCrossCheckLine({
      monthKey,
      invoice,
      actualUsdMicroCents,
      gateCarrierEurCents,
      rateMicro: config.billing.providerToBucketRateMicro,
    });
    return { skipped: false, monthKey };
  }

  return { runMonthlyCrossCheck };
}
