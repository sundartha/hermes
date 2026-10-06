import { PROVIDER } from "../store/defaults.js";
import {
  crossCheckDueMonthKey,
  actualCostMicroCentsForMonth,
  carrierGateCostCentsForMonth,
} from "../store/state-ops.js";
import { providerMicroCentsToBucketCents } from "./cost-calibration.js";
import { belegSummeJeTraegerFuerMonat, summeUeberTraeger } from "./kosten-projektion.js";
import { TELNYX_SWEEP_TRAEGER } from "./sweep-kostenbeleg.js";
import { LEERE_LISTE } from "./kosten-abschluss.js";

const UNAVAILABLE_REASON = Object.freeze({
  NO_TELNYX_ADAPTER: "no_telnyx_adapter",
  PORT_MISSING: "port_missing",
  FETCH_REJECTED: "provider_error",
});

const NO_KOSTENBUCH_REASON = "kein_kostenbuch";

function traegerZeile(traegerSummen) {
  if (traegerSummen.length === 0) return LEERE_LISTE;
  return traegerSummen.map((eintrag) => `${eintrag.traeger}(${eintrag.mikroCents})`).join(",");
}

function rechnungsDifferenzFeld(invoice, istTelnyxMicroCents) {
  if (istTelnyxMicroCents === null)
    return `diff_rechnung_minus_ist=nicht_verfuegbar(reason=${NO_KOSTENBUCH_REASON})`;
  return `diff_rechnung_minus_ist_usd_micro_cent=${invoice.totalMicroCents - istTelnyxMicroCents}`;
}

function crossCheckLineOk(params) {
  const { monthKey, invoice, istTelnyxMicroCents, istGesamtMicroCents } = params;
  const { traegerSummen, gateCarrierEurCents, rateMicro } = params;
  const convertedEurCents = providerMicroCentsToBucketCents(istGesamtMicroCents, rateMicro);
  const diffIstMinusGate = convertedEurCents === null ? null : convertedEurCents - gateCarrierEurCents;
  return (
    `[cost-cross-check] monat=${monthKey} telnyx_rechnung_usd_micro_cent=${invoice.totalMicroCents} ` +
    `ist_telnyx_usd_micro_cent=${istTelnyxMicroCents} ${rechnungsDifferenzFeld(invoice, istTelnyxMicroCents)} ` +
    `ist_je_traeger=${traegerZeile(traegerSummen)} ` +
    `ist_gesamt_usd_micro_cent=${istGesamtMicroCents} gate_carrier_eur_cent=${gateCarrierEurCents} ` +
    `ist_konvertiert_eur_cent(rate=${rateMicro})=${convertedEurCents} ` +
    `diff_ist_minus_gate_eur_cent=${diffIstMinusGate}`
  );
}

function crossCheckLineUnavailable({ monthKey, invoice, istGesamtMicroCents, traegerSummen, gateCarrierEurCents }) {
  return (
    `[cost-cross-check] monat=${monthKey} telnyx_rechnung=nicht_verfuegbar(reason=${invoice.reason}) ` +
    `ist_je_traeger=${traegerZeile(traegerSummen)} ` +
    `ist_gesamt_usd_micro_cent=${istGesamtMicroCents} gate_carrier_eur_cent=${gateCarrierEurCents}`
  );
}

function logCrossCheckLine(params) {
  console.log(params.invoice.ok ? crossCheckLineOk(params) : crossCheckLineUnavailable(params));
}

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
    return control
      .fetchMonthlyInvoiceTotal({ month: monthKey })
      .catch(() => ({ ok: false, reason: UNAVAILABLE_REASON.FETCH_REJECTED }));
  }

  async function runMonthlyCrossCheck(nowIso = new Date().toISOString()) {
    const s = store.load();
    const monthKey = crossCheckDueMonthKey(s, nowIso);
    if (monthKey === null) return { skipped: true };

    const invoice = await fetchInvoiceTotal(monthKey);
    store.markCostCrossCheckAttempted(monthKey);

    const traegerSummen = belegSummeJeTraegerFuerMonat({ state: s, monthKey });
    const istTelnyxMicroCents = summeUeberTraeger(traegerSummen, TELNYX_SWEEP_TRAEGER);
    const istGesamtMicroCents = actualCostMicroCentsForMonth(s, monthKey);
    const gateCarrierEurCents = carrierGateCostCentsForMonth(s, monthKey);
    logCrossCheckLine({
      monthKey,
      invoice,
      traegerSummen,
      istTelnyxMicroCents,
      istGesamtMicroCents,
      gateCarrierEurCents,
      rateMicro: config.billing.providerToBucketRateMicro,
    });
    return { skipped: false, monthKey };
  }

  return { runMonthlyCrossCheck };
}
