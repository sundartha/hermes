import {
  MICRO_CENTS_PER_CENT,
  PROVIDER_RATE_SCALE,
  isProviderMicroCents,
  istBeweisendeHerkunft,
} from "../store/defaults.js";
import { hasCountryPrefix } from "../telephony/outbound-gates.js";
import { voiceMinutesOf } from "./metering.js";
import { KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { settlementProjektion } from "./kosten-projektion.js";
import { LEERE_LISTE } from "./kosten-abschluss.js";

export const DRIFT_SAMPLE_WINDOW = 100;

const DRIFT_PERCENTILE = 95;
const PERCENT_BASE = 100;

export const TARIFF_DRIFT_FINDING = Object.freeze({
  UNDERESTIMATE: "underestimate",
  OVERESTIMATE: "overestimate",
  INSUFFICIENT_SAMPLES: "insufficient_samples",
  CONVERSION_ERROR: "conversion_error",
});

const ALERTABLE_DRIFT_CODES = Object.freeze([
  TARIFF_DRIFT_FINDING.UNDERESTIMATE,
  TARIFF_DRIFT_FINDING.OVERESTIMATE,
  TARIFF_DRIFT_FINDING.CONVERSION_ERROR,
]);

function isDriftSample(call, prefix) {
  return (
    istBeweisendeHerkunft(call.costTruedSource) &&
    hasCountryPrefix(call.to, prefix) &&
    hasCountryPrefix(call.from, prefix)
  );
}

function providerMicroCentsPerMinOf(call) {
  const minutes = voiceMinutesOf(call);
  if (minutes <= 0) return null;
  if (!Number.isSafeInteger(call.actualCostMicroCents) || call.actualCostMicroCents < 0) return null;
  return Math.ceil(call.actualCostMicroCents / minutes);
}

export function nearestRankWert(werte, percent) {
  const rank = Math.ceil((werte.length * percent) / PERCENT_BASE) - 1;
  return werte[rank];
}

export function measuredCentsPerMinByPrefix(calls, prefix) {
  const rates = calls
    .filter((c) => isDriftSample(c, prefix))
    .slice()
    .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1))
    .slice(0, DRIFT_SAMPLE_WINDOW)
    .map(providerMicroCentsPerMinOf)
    .filter((r) => r !== null)
    .sort((a, b) => a - b);
  if (rates.length === 0) return { samples: 0, p95ProviderMicroCentsPerMin: null };
  return { samples: rates.length, p95ProviderMicroCentsPerMin: nearestRankWert(rates, DRIFT_PERCENTILE) };
}

export function providerMicroCentsToBucketCents(providerMicroCents, rateMicro) {
  const product = providerMicroCents * rateMicro;
  if (!Number.isSafeInteger(product)) return null;
  return Math.ceil(product / (MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE));
}

function classifyDrift(configuredCentsPerMin, measuredCentsPerMin, warnPercent) {
  if (configuredCentsPerMin < measuredCentsPerMin) return TARIFF_DRIFT_FINDING.UNDERESTIMATE;
  if ((configuredCentsPerMin - measuredCentsPerMin) * PERCENT_BASE > measuredCentsPerMin * warnPercent)
    return TARIFF_DRIFT_FINDING.OVERESTIMATE;
  return null;
}

function driftEntryForPrefix(prefix, calls, params) {
  const { configuredCentsPerMin, providerToBucketRateMicro, minSamples, warnPercent } = params;
  const { samples, p95ProviderMicroCentsPerMin } = measuredCentsPerMinByPrefix(calls, prefix);
  const base = { prefix, samples, configuredCentsPerMin, measuredCentsPerMin: null };
  if (samples < minSamples) return { ...base, code: TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES };
  const measuredCentsPerMin = providerMicroCentsToBucketCents(p95ProviderMicroCentsPerMin, providerToBucketRateMicro);
  if (measuredCentsPerMin === null) return { ...base, code: TARIFF_DRIFT_FINDING.CONVERSION_ERROR };
  return { ...base, code: classifyDrift(configuredCentsPerMin, measuredCentsPerMin, warnPercent), measuredCentsPerMin };
}

export function tariffDriftReport({ calls, prefixes, ...params }) {
  return prefixes.map((prefix) => driftEntryForPrefix(prefix, calls, params));
}

export function tariffDriftReportFromConfig(calls, billing) {
  return tariffDriftReport({
    calls,
    prefixes: billing.voiceTariffDomesticPrefixes,
    configuredCentsPerMin: billing.voiceTariffDomesticCents,
    providerToBucketRateMicro: billing.providerToBucketRateMicro,
    minSamples: billing.costCalibrationMinSamples,
    warnPercent: billing.costDriftWarnPercent,
  });
}

export function alertableDriftFindings(report) {
  return report.filter((e) => ALERTABLE_DRIFT_CODES.includes(e.code));
}

export function driftLine(entry) {
  const head = `praefix=${entry.prefix} stichproben=${entry.samples}`;
  if (entry.code === TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES)
    return `${head} fenster=${DRIFT_SAMPLE_WINDOW} befund=${entry.code}`;
  const configured = `konfiguriert=${entry.configuredCentsPerMin}ct`;
  const befund = `befund=${entry.code ?? "im_band"}`;
  if (entry.code === TARIFF_DRIFT_FINDING.CONVERSION_ERROR) return `${head} ${configured} ${befund}`;
  return `${head} ${configured} gemessen=${entry.measuredCentsPerMin}ct ${befund}`;
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

export function vollkostenCentsJeAnruf({ belegMikroCents, eigenCent }, rateMicro) {
  if (!isProviderMicroCents(belegMikroCents)) return null;
  const belegCents = providerMicroCentsToBucketCents(belegMikroCents, rateMicro);
  if (belegCents === null) return null;
  const vollkostenCents = belegCents + eigenCent;
  return Number.isSafeInteger(vollkostenCents) ? vollkostenCents : null;
}

function eigenCentOf(eigenCentJeAnruf, callId) {
  const wert = eigenCentJeAnruf?.get(callId);
  return Number.isSafeInteger(wert) && wert >= 0 ? wert : null;
}

function belegzeilenJeCall(zeilen) {
  const jeCall = new Map();
  for (const zeile of Array.isArray(zeilen) ? zeilen : []) {
    if (!jeCall.has(zeile.callId)) jeCall.set(zeile.callId, []);
    jeCall.get(zeile.callId).push(zeile);
  }
  return jeCall;
}

function stichprobeOderFehlgrund({ call, belege, eigenCentJeAnruf, rateMicro }) {
  if (!istBeweisendeHerkunft(call.costTruedSource)) return { fehlgrund: TARIFPAAR_FEHLGRUND.HERKUNFT };
  const projektion = settlementProjektion({ call, belege });
  if (!projektion.vollBelegt) return { fehlgrund: TARIFPAAR_FEHLGRUND.BELEG_UNVOLLSTAENDIG };
  const eigenCent = eigenCentOf(eigenCentJeAnruf, call.id);
  if (eigenCent === null) return { fehlgrund: TARIFPAAR_FEHLGRUND.EIGEN_ACHSEN };
  const minuten = voiceMinutesOf(call);
  if (minuten <= 0) return { fehlgrund: TARIFPAAR_FEHLGRUND.MINUTEN };
  const vollkostenCents = vollkostenCentsJeAnruf({ belegMikroCents: projektion.summeMikroCents, eigenCent }, rateMicro);
  if (vollkostenCents === null) return { fehlgrund: TARIFPAAR_FEHLGRUND.UEBERLAUF };
  return { stichprobe: { route: kostenprofilFuerAnruf(call), minuten, vollkostenCents } };
}

export function vollkostenStichprobenJeRoute({ state, eigenCentJeAnruf, rateMicro }) {
  const jeRoute = new Map(Object.values(KOSTENPROFIL).map((route) => [route, []]));
  const ausgeschlossen = new Map();
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
    jeRoute.get(ergebnis.stichprobe.route).push(ergebnis.stichprobe);
  }
  return { jeRoute, ausgeschlossen };
}

export function tarifpaarVorschlag(stichproben) {
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

export function tarifpaarDecktStichproben(paar, stichproben) {
  if (paar === null || stichproben.length === 0) return false;
  const restAufsteigend = stichproben
    .map((stichprobe) => stichprobe.vollkostenCents - (paar.grundbetragCents + paar.minutensatzCents * stichprobe.minuten))
    .sort((links, rechts) => links - rechts);
  return nearestRankWert(restAufsteigend, DRIFT_PERCENTILE) <= 0;
}

function fehlgrundZeile(ausgeschlossen) {
  const teile = Object.values(TARIFPAAR_FEHLGRUND)
    .filter((grund) => (ausgeschlossen.get(grund) ?? 0) > 0)
    .map((grund) => `${grund}(${ausgeschlossen.get(grund)})`);
  return teile.length > 0 ? teile.join(",") : LEERE_LISTE;
}

export function tarifpaarEintrag({ route, stichproben, konfiguriert, minSamples, fehlgrund }) {
  const base = { route, proben: stichproben.length, konfiguriert, fehlgrund };
  if (stichproben.length < minSamples)
    return { ...base, vorschlag: null, code: TARIFPAAR_FINDING.ZU_WENIG_PROBEN };
  return {
    ...base,
    vorschlag: tarifpaarVorschlag(stichproben),
    code: tarifpaarDecktStichproben(konfiguriert, stichproben) ? null : TARIFPAAR_FINDING.UNTERSCHAETZT,
  };
}

const INBOUND_KOSTENPROFILE = new Set([
  KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
]);

function konfiguriertesPaar(route, billing) {
  const grundbetragJeRoute = billing.voiceTariffGrundbetragCentsJeRoute ?? {};
  return {
    grundbetragCents: Object.hasOwn(grundbetragJeRoute, route) ? grundbetragJeRoute[route] : 0,
    minutensatzCents: INBOUND_KOSTENPROFILE.has(route) ? billing.voiceTariffInboundCents : billing.voiceTariffDomesticCents,
  };
}

export function tarifpaarReport({ state, eigenCentJeAnruf, billing }) {
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

export function alertbareTarifpaarBefunde(report) {
  return report.filter((eintrag) => eintrag.code === TARIFPAAR_FINDING.UNTERSCHAETZT);
}

export function tarifpaarZeile(eintrag) {
  const head = `route=${eintrag.route} proben=${eintrag.proben}`;
  const befund = `befund=${eintrag.code ?? "im_band"}`;
  if (eintrag.code === TARIFPAAR_FINDING.ZU_WENIG_PROBEN) return `${head} fehlgrund=${eintrag.fehlgrund} ${befund}`;
  const vorschlag = `${eintrag.vorschlag.grundbetragCents}ct+${eintrag.vorschlag.minutensatzCents}ct/min`;
  const konfiguriert = `${eintrag.konfiguriert.grundbetragCents}ct+${eintrag.konfiguriert.minutensatzCents}ct/min`;
  return `${head} vorschlag=${vorschlag} konfiguriert=${konfiguriert} ${befund}`;
}
