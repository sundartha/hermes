import { PROVIDER } from "../begriffe/nummern-vergabe.js";
import {
  crossCheckDueMonthKey,
  actualCostMicroCentsForMonth,
  carrierGateCostCentsForMonth,
} from "../store/state-ops.js";
import { providerMicroCentsToBucketCents } from "./cost-calibration.js";
import { belegSummeJeTraegerFuerMonat, summeUeberTraeger } from "./kosten-projektion.ts";
import { TELNYX_SWEEP_TRAEGER } from "./sweep-kostenbeleg.ts";
import { LEERE_LISTE } from "./kosten-abschluss.ts";

type Zustand = Parameters<typeof belegSummeJeTraegerFuerMonat>[0]["state"];

type Rechnung = { ok: true; totalMicroCents: number } | { ok: false; reason: string };

interface TraegerSumme {
  traeger: string;
  mikroCents: number;
}

interface Zeilenwerte {
  monthKey: string;
  invoice: Rechnung;
  traegerSummen: TraegerSumme[];
  istTelnyxMicroCents: number | null;
  istGesamtMicroCents: number;
  gateCarrierEurCents: number;
  rateMicro: number;
}

interface VoiceControl {
  fetchMonthlyInvoiceTotal: (args: { month: string }) => Promise<Rechnung>;
}

interface CostCrossCheckDeps {
  store: { load: () => Zustand; markCostCrossCheckAttempted: (monthKey: string) => unknown };
  config: { billing: { providerToBucketRateMicro: number } };
  voiceControl: (provider: string) => VoiceControl;
}

const faelligerMonat: (state: Zustand, nowIso: string) => string | null = crossCheckDueMonthKey;
const istGesamtFuerMonat: (state: Zustand, monthKey: string) => number =
  actualCostMicroCentsForMonth;
const gateCentsFuerMonat: (state: Zustand, monthKey: string) => number =
  carrierGateCostCentsForMonth;

const UNAVAILABLE_REASON = Object.freeze({
  NO_TELNYX_ADAPTER: "no_telnyx_adapter",
  PORT_MISSING: "port_missing",
  FETCH_REJECTED: "provider_error",
});

const NO_KOSTENBUCH_REASON = "kein_kostenbuch";

function traegerZeile(traegerSummen: TraegerSumme[]): string {
  if (traegerSummen.length === 0) return LEERE_LISTE;
  return traegerSummen
    .map((eintrag) => `${eintrag.traeger}(${String(eintrag.mikroCents)})`)
    .join(",");
}

function rechnungsDifferenzFeld(
  invoice: { totalMicroCents: number },
  istTelnyxMicroCents: number | null,
): string {
  if (istTelnyxMicroCents === null)
    return `diff_rechnung_minus_ist=nicht_verfuegbar(reason=${NO_KOSTENBUCH_REASON})`;
  return `diff_rechnung_minus_ist_usd_micro_cent=${String(invoice.totalMicroCents - istTelnyxMicroCents)}`;
}

function crossCheckLineOk(
  params: Zeilenwerte & { invoice: { ok: true; totalMicroCents: number } },
): string {
  const { monthKey, invoice, istTelnyxMicroCents, istGesamtMicroCents } = params;
  const { traegerSummen, gateCarrierEurCents, rateMicro } = params;
  const convertedEurCents = providerMicroCentsToBucketCents(istGesamtMicroCents, rateMicro);
  const diffIstMinusGate =
    convertedEurCents === null ? null : convertedEurCents - gateCarrierEurCents;
  return (
    `[cost-cross-check] monat=${monthKey} telnyx_rechnung_usd_micro_cent=${String(invoice.totalMicroCents)} ` +
    `ist_telnyx_usd_micro_cent=${String(istTelnyxMicroCents)} ${rechnungsDifferenzFeld(invoice, istTelnyxMicroCents)} ` +
    `ist_je_traeger=${traegerZeile(traegerSummen)} ` +
    `ist_gesamt_usd_micro_cent=${String(istGesamtMicroCents)} gate_carrier_eur_cent=${String(gateCarrierEurCents)} ` +
    `ist_konvertiert_eur_cent(rate=${String(rateMicro)})=${String(convertedEurCents)} ` +
    `diff_ist_minus_gate_eur_cent=${String(diffIstMinusGate)}`
  );
}

function crossCheckLineUnavailable({
  monthKey,
  invoice,
  istGesamtMicroCents,
  traegerSummen,
  gateCarrierEurCents,
}: Zeilenwerte & { invoice: { ok: false; reason: string } }): string {
  return (
    `[cost-cross-check] monat=${monthKey} telnyx_rechnung=nicht_verfuegbar(reason=${invoice.reason}) ` +
    `ist_je_traeger=${traegerZeile(traegerSummen)} ` +
    `ist_gesamt_usd_micro_cent=${String(istGesamtMicroCents)} gate_carrier_eur_cent=${String(gateCarrierEurCents)}`
  );
}

function logCrossCheckLine(params: Zeilenwerte): void {
  const { invoice } = params;
  console.log(
    invoice.ok
      ? crossCheckLineOk({ ...params, invoice })
      : crossCheckLineUnavailable({ ...params, invoice }),
  );
}

function resolveTelnyxInvoiceControl(
  voiceControl: CostCrossCheckDeps["voiceControl"],
): { control: VoiceControl; reason: null } | { control: null; reason: string } {
  let control: VoiceControl;
  try {
    control = voiceControl(PROVIDER.TELNYX);
  } catch {
    return { control: null, reason: UNAVAILABLE_REASON.NO_TELNYX_ADAPTER };
  }
  if (typeof control.fetchMonthlyInvoiceTotal !== "function")
    return { control: null, reason: UNAVAILABLE_REASON.PORT_MISSING };
  return { control, reason: null };
}

export function makeCostCrossCheck({ store, config, voiceControl }: CostCrossCheckDeps): {
  runMonthlyCrossCheck: (nowIso?: string) => Promise<{ skipped: boolean; monthKey?: string }>;
} {
  async function fetchInvoiceTotal(monthKey: string): Promise<Rechnung> {
    const { control, reason } = resolveTelnyxInvoiceControl(voiceControl);
    if (control === null) return { ok: false, reason };
    return control
      .fetchMonthlyInvoiceTotal({ month: monthKey })
      .catch(() => ({ ok: false, reason: UNAVAILABLE_REASON.FETCH_REJECTED }));
  }

  async function runMonthlyCrossCheck(
    nowIso = new Date().toISOString(),
  ): Promise<{ skipped: boolean; monthKey?: string }> {
    const s = store.load();
    const monthKey = faelligerMonat(s, nowIso);
    if (monthKey === null) return { skipped: true };

    const invoice = await fetchInvoiceTotal(monthKey);
    store.markCostCrossCheckAttempted(monthKey);

    const traegerSummen = belegSummeJeTraegerFuerMonat({ state: s, monthKey });
    const istTelnyxMicroCents = summeUeberTraeger(traegerSummen, TELNYX_SWEEP_TRAEGER);
    const istGesamtMicroCents = istGesamtFuerMonat(s, monthKey);
    const gateCarrierEurCents = gateCentsFuerMonat(s, monthKey);
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
