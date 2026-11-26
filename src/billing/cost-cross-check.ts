import { PROVIDER } from "../begriffe/nummern-vergabe.ts";
import { speicherBereiche } from "../store.js";
import { fehler, ok, type Ergebnis } from "../utils/ergebnis.ts";
import { providerMicroCentsToBucketCents } from "./cost-calibration.ts";
import { belegSummeJeTraegerFuerMonat, summeUeberTraeger } from "./kosten-projektion.ts";
import { TELNYX_SWEEP_TRAEGER } from "./sweep-kostenbeleg.ts";
import { LEERE_LISTE } from "./kosten-abschluss.ts";

type Zustand = Parameters<typeof belegSummeJeTraegerFuerMonat>[0]["state"];

interface Rechnungsbetrag {
  totalMicroCents: number;
}

type Rechnungsantwort = ({ ok: true } & Rechnungsbetrag) | { ok: false; reason: string };

type Rechnung = Ergebnis<Rechnungsbetrag>;

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
  fetchMonthlyInvoiceTotal: (args: { month: string }) => Promise<Rechnungsantwort>;
}

interface CostCrossCheckDeps {
  store: { load: () => Zustand; markCostCrossCheckAttempted: (monthKey: string) => unknown };
  config: { billing: { providerToBucketRateMicro: number } };
  voiceControl: (provider: string) => VoiceControl;
}

interface Bereiche {
  kostenbelege: {
    markCostCrossCheckAttempted(monthKey: string): Promise<unknown>;
  };
  kostenabgleich: {
    querpruefungMonat(nowIso: string): Promise<string | null>;
    querpruefungSummen(auswahl: {
      monthKey: string;
      belegSummeJeTraeger: typeof belegSummeJeTraegerFuerMonat;
    }): Promise<{ traegerSummen: TraegerSumme[]; istGesamtMicroCents: number; gateCarrierEurCents: number }>;
  };
}

const bereicheVon: (store: CostCrossCheckDeps["store"]) => Bereiche = speicherBereiche;

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
  invoice: Rechnungsbetrag,
  istTelnyxMicroCents: number | null,
): string {
  if (istTelnyxMicroCents === null)
    return `diff_rechnung_minus_ist=nicht_verfuegbar(reason=${NO_KOSTENBUCH_REASON})`;
  return `diff_rechnung_minus_ist_usd_micro_cent=${String(invoice.totalMicroCents - istTelnyxMicroCents)}`;
}

function crossCheckLineOk(
  params: Zeilenwerte & { invoice: Extract<Rechnung, { ok: true }> },
): string {
  const { monthKey, invoice, istTelnyxMicroCents, istGesamtMicroCents } = params;
  const { traegerSummen, gateCarrierEurCents, rateMicro } = params;
  const convertedEurCents = providerMicroCentsToBucketCents(istGesamtMicroCents, rateMicro);
  const diffIstMinusGate =
    convertedEurCents === null ? null : convertedEurCents - gateCarrierEurCents;
  return (
    `[cost-cross-check] monat=${monthKey} telnyx_rechnung_usd_micro_cent=${String(invoice.wert.totalMicroCents)} ` +
    `ist_telnyx_usd_micro_cent=${String(istTelnyxMicroCents)} ${rechnungsDifferenzFeld(invoice.wert, istTelnyxMicroCents)} ` +
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
}: Zeilenwerte & { invoice: Extract<Rechnung, { ok: false }> }): string {
  return (
    `[cost-cross-check] monat=${monthKey} telnyx_rechnung=nicht_verfuegbar(reason=${invoice.fehler}) ` +
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
): Ergebnis<VoiceControl> {
  let control: VoiceControl;
  try {
    control = voiceControl(PROVIDER.TELNYX);
  } catch {
    return fehler(UNAVAILABLE_REASON.NO_TELNYX_ADAPTER);
  }
  if (typeof control.fetchMonthlyInvoiceTotal !== "function")
    return fehler(UNAVAILABLE_REASON.PORT_MISSING);
  return ok(control);
}

function uebersetzteRechnung(antwort: Rechnungsantwort): Rechnung {
  return antwort.ok ? ok(antwort) : fehler(antwort.reason);
}

export function makeCostCrossCheck({ store, config, voiceControl }: CostCrossCheckDeps): {
  runMonthlyCrossCheck: (nowIso?: string) => Promise<{ skipped: boolean; monthKey?: string }>;
} {
  const bereiche = bereicheVon(store);

  async function fetchInvoiceTotal(monthKey: string): Promise<Rechnung> {
    const steuerung = resolveTelnyxInvoiceControl(voiceControl);
    if (!steuerung.ok) return steuerung;
    return steuerung.wert
      .fetchMonthlyInvoiceTotal({ month: monthKey })
      .then(uebersetzteRechnung, () => fehler(UNAVAILABLE_REASON.FETCH_REJECTED));
  }

  async function runMonthlyCrossCheck(
    nowIso = new Date().toISOString(),
  ): Promise<{ skipped: boolean; monthKey?: string }> {
    const monthKey = await bereiche.kostenabgleich.querpruefungMonat(nowIso);
    if (monthKey === null) return { skipped: true };

    const invoice = await fetchInvoiceTotal(monthKey);
    await bereiche.kostenbelege.markCostCrossCheckAttempted(monthKey);

    const { traegerSummen, istGesamtMicroCents, gateCarrierEurCents } =
      await bereiche.kostenabgleich.querpruefungSummen({
        monthKey,
        belegSummeJeTraeger: belegSummeJeTraegerFuerMonat,
      });
    const istTelnyxMicroCents = summeUeberTraeger(traegerSummen, TELNYX_SWEEP_TRAEGER);
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
