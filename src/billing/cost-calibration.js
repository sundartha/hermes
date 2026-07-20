// LCT P5 (Drift-Waechter): misst den IST-Minutensatz je Ziel-Praefix gegen den
// KONFIGURIERTEN Reserve-Tarif und meldet die Abweichung. JUSTIERT NICHTS -
// Owner-Entscheidung 3 (2026-07-20): keine rollende Selbstkalibrierung. Ein Tarif,
// der sich aus Anrufen speist, die das Gate durchgelassen hat, ist die Rueckkopplung
// aus PM-2; ein dummer, aber vorhersagbarer Wert ist hier die bessere Eigenschaft.
// tariffCentsPerMin (src/telephony/outbound-gates.js) wird von dieser Phase NICHT
// importiert und NICHT beruehrt.
import { COST_TRUING_SOURCE, MICRO_CENTS_PER_CENT } from "../store/defaults.js";
import { voiceMinutesOf } from "./metering.js";

// Groesse des rollenden Fensters: die juengsten N abgeglichenen Calls je Praefix.
// KEINE Env (G35): der Operator steuert die Aussagekraft ueber die Mindest-Stichprobe,
// nicht ueber die Fensterlaenge; eine zweite Zahl mit fast gleicher Bedeutung liefe beim
// ersten Nachziehen auseinander. 100 = fuenffache Default-Mindeststichprobe, damit eine
// echte Tarifaenderung innerhalb von rund 100 Calls je Praefix sichtbar wird.
export const DRIFT_SAMPLE_WINDOW = 100;

// Nearest-Rank-Perzentil, GANZZAHLIG (kein Interpolieren, keine Floats auf dem
// Geld-Pfad). p95 und NICHT Mittelwert: der Mittelwert verduennt genau den ersten
// teuren Anruf einer neuen Destination (PM-5). p95 und NICHT max: ein einzelner
// Ausreisser darf den Waechter nicht dauerhaft schreien lassen.
const DRIFT_PERCENTILE = 95;
const PERCENT_BASE = 100;
// Mikro-Skala des Umrechnungskurses (1_000_000 = Faktor 1,0), s. providerMicroCentsToBucketCents.
const MICRO_RATE_UNIT = 1_000_000;

export const TARIFF_DRIFT_FINDING = Object.freeze({
  UNDERESTIMATE: "underestimate", // Tarif UNTER dem gemessenen p95 - Reserve deckt den Anruf nicht
  OVERESTIMATE: "overestimate", // Tarif ueber p95 um > warnPercent - die Vorfalls-Richtung
  INSUFFICIENT_SAMPLES: "insufficient_samples", // zu wenig Daten - KEIN Alarm, aber sichtbar
});

// Nur BEWIESEN vollstaendig abgeglichene Calls (costTruedSource === DETAIL_RECORDS)
// sind Stichproben. 'incomplete' ist systematisch ZU NIEDRIG - liesse man es zu,
// erzeugte die lueckenhafte Messung selbst den Befund 'overestimate' und der Waechter
// alarmierte gegen seine eigene Datenluecke (P4-Risiko/PM-8).
function isDriftSample(call, prefix) {
  return (
    call.costTruedSource === COST_TRUING_SOURCE.DETAIL_RECORDS &&
    typeof call.to === "string" &&
    call.to.startsWith(prefix)
  );
}

// Ist-Satz EINES Calls in PROVIDER-Mikro-Cent je Minute (heute USD - hier wird NICHT
// umgerechnet, das passiert an genau einer Stelle, s. providerMicroCentsToBucketCents).
// Aufrunden: der gemessene Wert treibt den Vergleich, und ein hoeherer Messwert macht den
// GEFAEHRLICHEN Befund (underestimate) wahrscheinlicher - im Zweifel die Richtung, die
// mehr sieht. Minuten kommen aus voiceMinutesOf (EINE Minuten-Quelle, G5, dieselbe, gegen
// die reconcileOutboundVoiceBudget gebucht hat). null bei 0 Minuten / unsicherem Integer.
function providerMicroCentsPerMinOf(call) {
  const minutes = voiceMinutesOf(call);
  if (minutes <= 0) return null;
  if (!Number.isSafeInteger(call.actualCostMicroCents) || call.actualCostMicroCents < 0) return null;
  return Math.ceil(call.actualCostMicroCents / minutes);
}

// REINE Funktion, KEIN Zeitzugriff im Rumpf (Muster voiceMinutesUsedSince: was nach
// "zuletzt" aussieht, kommt aus den Daten - endedAt -, nie aus der Uhr).
// Liefert { samples, p95ProviderMicroCentsPerMin } - die EINHEIT steht im Feldnamen,
// weil die Funktion einen Datensatz und keinen nackten Skalar liefert.
// samples === 0 -> p95 ist null (nie 0: "nicht gemessen" ist nicht "kostet nichts", PM-4).
export function measuredCentsPerMinByPrefix(calls, prefix) {
  const rates = calls
    .filter((c) => isDriftSample(c, prefix))
    .slice() // Kopie: der Aufrufer-State wird NIE sortiert
    .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1)) // juengste zuerst
    .slice(0, DRIFT_SAMPLE_WINDOW)
    .map(providerMicroCentsPerMinOf)
    .filter((r) => r !== null)
    .sort((a, b) => a - b); // aufsteigend fuer den Rang
  if (rates.length === 0) return { samples: 0, p95ProviderMicroCentsPerMin: null };
  const rank = Math.ceil((rates.length * DRIFT_PERCENTILE) / PERCENT_BASE) - 1;
  return { samples: rates.length, p95ProviderMicroCentsPerMin: rates[rank] };
}

// WAEHRUNGSRICHTUNG, explizit - in der Planungsphase zweimal die Wurzel eines Befundes:
//   LINKS  = actualCostMicroCents = PROVIDER-Waehrung (USD), Mikro-Cent
//   RECHTS = voiceTariffDomesticCents = BUCKET-Waehrung (EUR), GANZE Cent
// rateMicro = PROVIDER_TO_BUCKET_RATE_MICRO = wie viel Bucket-Waehrung auf eine Einheit
// Provider-Waehrung entfaellt, in Mikro-Einheiten (920000 = 0,92 EUR je USD). Also
// MULTIPLIZIEREN, nie dividieren: 100 USD-ct -> 92 EUR-ct. Die falsche Richtung machte
// aus 100 USD-ct 108,7 EUR-ct und meldete Unterschaetzung, wo keine ist. Aufgerundet
// (Math.ceil) - dieselbe Richtung wie oben.
export function providerMicroCentsToBucketCents(providerMicroCents, rateMicro) {
  const product = providerMicroCents * rateMicro;
  if (!Number.isSafeInteger(product)) return null; // zweite Linie, nie stillschweigend 0
  return Math.ceil(product / (MICRO_CENTS_PER_CENT * MICRO_RATE_UNIT));
}

// Klassifikation, Ganzzahl-Arithmetik, keine Division:
// configured < measured -> underestimate (OHNE Toleranz - die gefaehrliche Richtung wird
// nicht wegtoleriert). (configured - measured) * 100 > measured * warnPercent -> overestimate.
// sonst null ("im Band").
function classifyDrift(configuredCentsPerMin, measuredCentsPerMin, warnPercent) {
  if (configuredCentsPerMin < measuredCentsPerMin) return TARIFF_DRIFT_FINDING.UNDERESTIMATE;
  if ((configuredCentsPerMin - measuredCentsPerMin) * PERCENT_BASE > measuredCentsPerMin * warnPercent)
    return TARIFF_DRIFT_FINDING.OVERESTIMATE;
  return null;
}

// Ein Eintrag EINES Praefixes: misst, entscheidet insufficient_samples VOR jeder
// Tarif-Aussage, konvertiert dann in die Bucket-Waehrung und klassifiziert. F1 (<=3
// Argumente): die vier Konfig-Groessen reisen als EIN params-Objekt (sie gehoeren
// zusammen - derselbe Aufruf braucht immer alle vier).
function driftEntryForPrefix(prefix, calls, params) {
  const { configuredCentsPerMin, providerToBucketRateMicro, minSamples, warnPercent } = params;
  const { samples, p95ProviderMicroCentsPerMin } = measuredCentsPerMinByPrefix(calls, prefix);
  if (samples < minSamples)
    return { prefix, code: TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES, samples, measuredCentsPerMin: null, configuredCentsPerMin };
  const measuredCentsPerMin = providerMicroCentsToBucketCents(p95ProviderMicroCentsPerMin, providerToBucketRateMicro);
  if (measuredCentsPerMin === null)
    return { prefix, code: TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES, samples, measuredCentsPerMin: null, configuredCentsPerMin };
  return {
    prefix,
    code: classifyDrift(configuredCentsPerMin, measuredCentsPerMin, warnPercent),
    samples,
    measuredCentsPerMin,
    configuredCentsPerMin,
  };
}

// Eintraege: { prefix, code, samples, measuredCentsPerMin, configuredCentsPerMin }
// code === null heisst "im Band". insufficient_samples -> measuredCentsPerMin === null,
// samples IMMER gesetzt: "kein Alarm" und "zu wenig Daten" duerfen nicht dieselbe
// Beobachtung sein - P4b haengt sein Abnahmekriterium genau daran.
export function tariffDriftReport({ calls, prefixes, ...params }) {
  return prefixes.map((prefix) => driftEntryForPrefix(prefix, calls, params));
}

// EINE Stelle, die config -> reine Argumente uebersetzt (G5): Boot-Guard, Sweep und
// Lese-Endpunkt bauen den Aufruf NICHT je selbst zusammen. configuredCentsPerMin ist
// voiceTariffDomesticCents, weil ALLE bewerteten Praefixe aus voiceTariffDomesticPrefixes
// stammen und tariffCentsPerMin genau fuer diese den Inlandssatz liefert. Ziele OHNE
// Praefix-Treffer werden bewusst NICHT bewertet (sie fallen auf voiceTariffDefaultCents =
// 300 ct, den harten Deckel, PM-5) und keinem Praefix zugeschlagen. warnPercent teilt sich
// costDriftWarnPercent mit dem P3-Kosten-Drift-Log (dieselbe Toleranzschwelle, EINE Quelle).
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

// Die EINE Stelle, an der "insufficient_samples alarmiert nicht" steht - als Filter,
// nicht als verstreute if-Bedingung. Sonst wird der Kanal taub trainiert.
export function alertableDriftFindings(report) {
  return report.filter(
    (e) => e.code === TARIFF_DRIFT_FINDING.UNDERESTIMATE || e.code === TARIFF_DRIFT_FINDING.OVERESTIMATE,
  );
}

// Eine PII-freie Zeile je Eintrag (Praefix wie "+49" ist keine Rufnummer). Nennt
// IMMER stichproben=; bei insufficient_samples zusaetzlich fenster= (laut, nicht still -
// eine Fehlkonfiguration wie minSamples > DRIFT_SAMPLE_WINDOW bleibt sichtbar statt
// als stiller Dauer-Alarm-Ausfall).
export function driftLine(entry) {
  const head = `praefix=${entry.prefix} stichproben=${entry.samples}`;
  if (entry.code === TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES)
    return `${head} fenster=${DRIFT_SAMPLE_WINDOW} befund=${entry.code}`;
  return `${head} konfiguriert=${entry.configuredCentsPerMin}ct gemessen=${entry.measuredCentsPerMin}ct befund=${entry.code ?? "im_band"}`;
}
