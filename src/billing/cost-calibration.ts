import {
  MICRO_CENTS_PER_CENT,
  PROVIDER_RATE_SCALE,
  isProviderMicroCents,
  istBeweisendeHerkunft,
} from "../begriffe/abrechnung.js";
import { hasCountryPrefix } from "../telephony/outbound-gates.js";
import { voiceMinutesOf } from "./metering.js";
import { KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { settlementProjektion } from "./kosten-projektion.ts";
import { LEERE_LISTE } from "./kosten-abschluss.ts";
import type { AbschlussAnruf, AbschlussBeleg } from "./kosten-abschluss.ts";

interface Anruf extends AbschlussAnruf {
  id: string;
  to: string;
  from: string;
  endedAt: string;
  answeredAt: string | null;
  actualCostMicroCents: number;
  costTruedSource: string | null;
}

interface Belegzeile extends AbschlussBeleg {
  callId: string;
}

interface Stichprobe {
  route: string;
  minuten: number;
  vollkostenCents: number;
}

interface Tarifpaar {
  grundbetragCents: number;
  minutensatzCents: number;
}

interface DriftParameter {
  configuredCentsPerMin: number;
  providerToBucketRateMicro: number;
  minSamples: number;
  warnPercent: number;
}

interface DriftEintrag {
  prefix: string;
  samples: number;
  configuredCentsPerMin: number;
  measuredCentsPerMin: number | null;
  code: string | null;
}

interface TarifpaarEintrag {
  route: string;
  proben: number;
  konfiguriert: Tarifpaar;
  fehlgrund: string;
  vorschlag: Tarifpaar | null;
  code: string | null;
}

interface Abrechnungskonfiguration {
  voiceTariffDomesticPrefixes: string[];
  voiceTariffDomesticCents: number;
  voiceTariffInboundCents: number;
  voiceTariffGrundbetragCentsJeRoute?: Record<string, number> | undefined;
  providerToBucketRateMicro: number;
  costCalibrationMinSamples: number;
  costDriftWarnPercent: number;
}

interface Zustand {
  calls: Anruf[];
  callCostEvidence: Belegzeile[];
}

const kostenprofilVon: (call: Anruf) => string = kostenprofilFuerAnruf;

export const DRIFT_SAMPLE_WINDOW = 100;

const DRIFT_PERCENTILE = 95;
const PERCENT_BASE = 100;

export const TARIFF_DRIFT_FINDING = Object.freeze({
  UNDERESTIMATE: "underestimate",
  OVERESTIMATE: "overestimate",
  INSUFFICIENT_SAMPLES: "insufficient_samples",
  CONVERSION_ERROR: "conversion_error",
});

const ALERTABLE_DRIFT_CODES: readonly (string | null)[] = Object.freeze([
  TARIFF_DRIFT_FINDING.UNDERESTIMATE,
  TARIFF_DRIFT_FINDING.OVERESTIMATE,
  TARIFF_DRIFT_FINDING.CONVERSION_ERROR,
]);

function providerMicroCentsPerMinOf(call: Anruf): number | null {
  const minutes = voiceMinutesOf(call);
  if (minutes <= 0) return null;
  if (!Number.isSafeInteger(call.actualCostMicroCents) || call.actualCostMicroCents < 0) return null;
  return Math.ceil(call.actualCostMicroCents / minutes);
}

function isDriftSample(call: Anruf, prefix: string): boolean {
  return (
    istBeweisendeHerkunft(call.costTruedSource) &&
    hasCountryPrefix(call.to, prefix) &&
    hasCountryPrefix(call.from, prefix) &&
    providerMicroCentsPerMinOf(call) !== null
  );
}

export function nearestRankWert(werte: number[], percent: number): number {
  const rank = Math.ceil((werte.length * percent) / PERCENT_BASE) - 1;
  return werte[rank] ?? NaN;
}

export function measuredCentsPerMinByPrefix(
  calls: Anruf[],
  prefix: string,
): { samples: number; p95ProviderMicroCentsPerMin: number | null } {
  const proben = calls.filter((call) => isDriftSample(call, prefix)).slice();
  const neueste = proben.sort((links, rechts) => (links.endedAt < rechts.endedAt ? 1 : -1)).slice(0, DRIFT_SAMPLE_WINDOW);
  const rates = neueste
    .map(providerMicroCentsPerMinOf)
    .filter((rate) => rate !== null)
    .sort((links, rechts) => links - rechts);
  if (rates.length === 0) return { samples: 0, p95ProviderMicroCentsPerMin: null };
  return { samples: rates.length, p95ProviderMicroCentsPerMin: nearestRankWert(rates, DRIFT_PERCENTILE) };
}

export function providerMicroCentsToBucketCents(providerMicroCents: number, rateMicro: number): number | null {
  const product = providerMicroCents * rateMicro;
  if (!Number.isSafeInteger(product)) return null;
  return Math.ceil(product / (MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE));
}

function classifyDrift(configuredCentsPerMin: number, measuredCentsPerMin: number, warnPercent: number): string | null {
  if (configuredCentsPerMin < measuredCentsPerMin) return TARIFF_DRIFT_FINDING.UNDERESTIMATE;
  if ((configuredCentsPerMin - measuredCentsPerMin) * PERCENT_BASE > measuredCentsPerMin * warnPercent)
    return TARIFF_DRIFT_FINDING.OVERESTIMATE;
  return null;
}

function driftEntryForPrefix(prefix: string, calls: Anruf[], params: DriftParameter): DriftEintrag {
  const { configuredCentsPerMin, providerToBucketRateMicro, minSamples, warnPercent } = params;
  const { samples, p95ProviderMicroCentsPerMin } = measuredCentsPerMinByPrefix(calls, prefix);
  const base = { prefix, samples, configuredCentsPerMin, measuredCentsPerMin: null };
  if (samples < minSamples) return { ...base, code: TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES };
  const measuredCentsPerMin = providerMicroCentsToBucketCents(p95ProviderMicroCentsPerMin ?? 0, providerToBucketRateMicro);
  if (measuredCentsPerMin === null) return { ...base, code: TARIFF_DRIFT_FINDING.CONVERSION_ERROR };
  return { ...base, code: classifyDrift(configuredCentsPerMin, measuredCentsPerMin, warnPercent), measuredCentsPerMin };
}

export function tariffDriftReport({ calls, prefixes, ...params }: { calls: Anruf[]; prefixes: string[] } & DriftParameter): DriftEintrag[] {
  return prefixes.map((prefix) => driftEntryForPrefix(prefix, calls, params));
}

export function tariffDriftReportFromConfig(calls: Anruf[], billing: Abrechnungskonfiguration): DriftEintrag[] {
  return tariffDriftReport({
    calls,
    prefixes: billing.voiceTariffDomesticPrefixes,
    configuredCentsPerMin: billing.voiceTariffDomesticCents,
    providerToBucketRateMicro: billing.providerToBucketRateMicro,
    minSamples: billing.costCalibrationMinSamples,
    warnPercent: billing.costDriftWarnPercent,
  });
}

export function alertableDriftFindings(report: DriftEintrag[]): DriftEintrag[] {
  return report.filter((eintrag) => ALERTABLE_DRIFT_CODES.includes(eintrag.code));
}

export function driftLine(entry: DriftEintrag): string {
  const head = `praefix=${entry.prefix} stichproben=${String(entry.samples)}`;
  if (entry.code === TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES)
    return `${head} fenster=${String(DRIFT_SAMPLE_WINDOW)} befund=${entry.code}`;
  const configured = `konfiguriert=${String(entry.configuredCentsPerMin)}ct`;
  const befund = `befund=${entry.code ?? "im_band"}`;
  if (entry.code === TARIFF_DRIFT_FINDING.CONVERSION_ERROR) return `${head} ${configured} ${befund}`;
  return `${head} ${configured} gemessen=${String(entry.measuredCentsPerMin)}ct ${befund}`;
}

export const TARIFPAAR_FINDING = Object.freeze({
  UNTERSCHAETZT: "tarifpaar_unterschaetzt",
  ZU_WENIG_PROBEN: "tarifpaar_zu_wenig_proben",
});

export const TARIFPAAR_FEHLGRUND = Object.freeze({
  HERKUNFT: "herkunft",
  BELEG_UNVOLLSTAENDIG: "beleg_unvollstaendig",
  EIGEN_ACHSEN: "eigen_achsen",
  UEBERLAUF: "ueberlauf",
  MINUTEN: "minuten",
});

export function vollkostenCentsJeAnruf(
  { belegMikroCents, eigenCent }: { belegMikroCents: number | null; eigenCent: number },
  rateMicro: number,
): number | null {
  if (belegMikroCents === null || !isProviderMicroCents(belegMikroCents)) return null;
  const belegCents = providerMicroCentsToBucketCents(belegMikroCents, rateMicro);
  if (belegCents === null) return null;
  const vollkostenCents = belegCents + eigenCent;
  return Number.isSafeInteger(vollkostenCents) ? vollkostenCents : null;
}

function eigenCentOf(eigenCentJeAnruf: Map<string, number> | null | undefined, callId: string): number | null {
  const wert = eigenCentJeAnruf?.get(callId);
  return wert !== undefined && Number.isSafeInteger(wert) && wert >= 0 ? wert : null;
}

function belegzeilenJeCall(zeilen: Belegzeile[] | null | undefined): Map<string, Belegzeile[]> {
  const jeCall = new Map<string, Belegzeile[]>();
  for (const zeile of Array.isArray(zeilen) ? zeilen : []) {
    const liste = jeCall.get(zeile.callId) ?? [];
    liste.push(zeile);
    jeCall.set(zeile.callId, liste);
  }
  return jeCall;
}

function stichprobeOderFehlgrund({
  call,
  belege,
  eigenCentJeAnruf,
  rateMicro,
}: {
  call: Anruf;
  belege: Belegzeile[];
  eigenCentJeAnruf: Map<string, number> | null | undefined;
  rateMicro: number;
}): { fehlgrund: string; stichprobe?: undefined } | { stichprobe: Stichprobe; fehlgrund?: undefined } {
  if (!istBeweisendeHerkunft(call.costTruedSource)) return { fehlgrund: TARIFPAAR_FEHLGRUND.HERKUNFT };
  const projektion = settlementProjektion({ call, belege });
  if (!projektion.vollBelegt) return { fehlgrund: TARIFPAAR_FEHLGRUND.BELEG_UNVOLLSTAENDIG };
  const eigenCent = eigenCentOf(eigenCentJeAnruf, call.id);
  if (eigenCent === null) return { fehlgrund: TARIFPAAR_FEHLGRUND.EIGEN_ACHSEN };
  const minuten = voiceMinutesOf(call);
  if (minuten <= 0) return { fehlgrund: TARIFPAAR_FEHLGRUND.MINUTEN };
  const vollkostenCents = vollkostenCentsJeAnruf({ belegMikroCents: projektion.summeMikroCents, eigenCent }, rateMicro);
  if (vollkostenCents === null) return { fehlgrund: TARIFPAAR_FEHLGRUND.UEBERLAUF };
  return { stichprobe: { route: kostenprofilVon(call), minuten, vollkostenCents } };
}

export function vollkostenStichprobenJeRoute({
  state,
  eigenCentJeAnruf,
  rateMicro,
}: {
  state: Zustand | null | undefined;
  eigenCentJeAnruf: Map<string, number> | null | undefined;
  rateMicro: number;
}): { jeRoute: Map<string, Stichprobe[]>; ausgeschlossen: Map<string, number> } {
  const jeRoute = new Map<string, Stichprobe[]>(Object.values(KOSTENPROFIL).map((route) => [route, []]));
  const ausgeschlossen = new Map<string, number>();
  const belegeNachCall = belegzeilenJeCall(state?.callCostEvidence);
  for (const call of Array.isArray(state?.calls) ? state.calls : []) {
    const ergebnis = stichprobeOderFehlgrund({
      call,
      belege: belegeNachCall.get(call.id) ?? [],
      eigenCentJeAnruf,
      rateMicro,
    });
    if (ergebnis.fehlgrund !== undefined) {
      ausgeschlossen.set(ergebnis.fehlgrund, (ausgeschlossen.get(ergebnis.fehlgrund) ?? 0) + 1);
      continue;
    }
    jeRoute.get(ergebnis.stichprobe.route)?.push(ergebnis.stichprobe);
  }
  return { jeRoute, ausgeschlossen };
}

export function tarifpaarVorschlag(stichproben: Stichprobe[]): Tarifpaar | null {
  if (stichproben.length === 0) return null;
  const vollkostenAufsteigend = stichproben
    .map((stichprobe) => stichprobe.vollkostenCents)
    .sort((links, rechts) => links - rechts);
  const jeMinuteAufsteigend = stichproben
    .map((stichprobe) => Math.ceil(stichprobe.vollkostenCents / stichprobe.minuten))
    .sort((links, rechts) => links - rechts);
  return {
    grundbetragCents: nearestRankWert(vollkostenAufsteigend, DRIFT_PERCENTILE),
    minutensatzCents: nearestRankWert(jeMinuteAufsteigend, DRIFT_PERCENTILE),
  };
}

export function tarifpaarDecktStichproben(paar: Tarifpaar | null, stichproben: Stichprobe[]): boolean {
  if (paar === null || stichproben.length === 0) return false;
  const restAufsteigend = stichproben
    .map((stichprobe) => stichprobe.vollkostenCents - (paar.grundbetragCents + paar.minutensatzCents * stichprobe.minuten))
    .sort((links, rechts) => links - rechts);
  return nearestRankWert(restAufsteigend, DRIFT_PERCENTILE) <= 0;
}

function fehlgrundZeile(ausgeschlossen: Map<string, number>): string {
  const teile = Object.values(TARIFPAAR_FEHLGRUND)
    .filter((grund) => (ausgeschlossen.get(grund) ?? 0) > 0)
    .map((grund) => `${grund}(${String(ausgeschlossen.get(grund))})`);
  return teile.length > 0 ? teile.join(",") : LEERE_LISTE;
}

export function tarifpaarEintrag({
  route,
  stichproben,
  konfiguriert,
  minSamples,
  fehlgrund,
}: {
  route: string;
  stichproben: Stichprobe[];
  konfiguriert: Tarifpaar;
  minSamples: number;
  fehlgrund: string;
}): TarifpaarEintrag {
  const base = { route, proben: stichproben.length, konfiguriert, fehlgrund };
  if (stichproben.length < minSamples)
    return { ...base, vorschlag: null, code: TARIFPAAR_FINDING.ZU_WENIG_PROBEN };
  return {
    ...base,
    vorschlag: tarifpaarVorschlag(stichproben),
    code: tarifpaarDecktStichproben(konfiguriert, stichproben) ? null : TARIFPAAR_FINDING.UNTERSCHAETZT,
  };
}

const INBOUND_KOSTENPROFILE = new Set<string>([
  KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
]);

function konfiguriertesPaar(route: string, billing: Abrechnungskonfiguration): Tarifpaar {
  const grundbetragJeRoute = billing.voiceTariffGrundbetragCentsJeRoute ?? {};
  return {
    grundbetragCents: Object.hasOwn(grundbetragJeRoute, route) ? (grundbetragJeRoute[route] ?? 0) : 0,
    minutensatzCents: INBOUND_KOSTENPROFILE.has(route) ? billing.voiceTariffInboundCents : billing.voiceTariffDomesticCents,
  };
}

export function tarifpaarReport({
  state,
  eigenCentJeAnruf,
  billing,
}: {
  state: Zustand | null | undefined;
  eigenCentJeAnruf: Map<string, number> | null | undefined;
  billing: Abrechnungskonfiguration;
}): TarifpaarEintrag[] {
  const { jeRoute, ausgeschlossen } = vollkostenStichprobenJeRoute({
    state,
    eigenCentJeAnruf,
    rateMicro: billing.providerToBucketRateMicro,
  });
  const fehlgrund = fehlgrundZeile(ausgeschlossen);
  return [...jeRoute.entries()].map(([route, stichproben]) =>
    tarifpaarEintrag({
      route,
      stichproben,
      konfiguriert: konfiguriertesPaar(route, billing),
      minSamples: billing.costCalibrationMinSamples,
      fehlgrund,
    }),
  );
}

export function alertbareTarifpaarBefunde(report: TarifpaarEintrag[]): TarifpaarEintrag[] {
  return report.filter((eintrag) => eintrag.code === TARIFPAAR_FINDING.UNTERSCHAETZT);
}

export function tarifpaarZeile(eintrag: TarifpaarEintrag): string {
  const head = `route=${eintrag.route} proben=${String(eintrag.proben)}`;
  const befund = `befund=${eintrag.code ?? "im_band"}`;
  if (eintrag.code === TARIFPAAR_FINDING.ZU_WENIG_PROBEN) return `${head} fehlgrund=${eintrag.fehlgrund} ${befund}`;
  const vorschlag = `${String(eintrag.vorschlag?.grundbetragCents)}ct+${String(eintrag.vorschlag?.minutensatzCents)}ct/min`;
  const konfiguriert = `${String(eintrag.konfiguriert.grundbetragCents)}ct+${String(eintrag.konfiguriert.minutensatzCents)}ct/min`;
  return `${head} vorschlag=${vorschlag} konfiguriert=${konfiguriert} ${befund}`;
}
