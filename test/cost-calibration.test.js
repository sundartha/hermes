import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DRIFT_SAMPLE_WINDOW,
  TARIFF_DRIFT_FINDING,
  measuredCentsPerMinByPrefix,
  tariffDriftReport,
  alertableDriftFindings,
  driftLine,
} from "../src/billing/cost-calibration.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { config } from "../src/config.js";
import { COST_TRUING_SOURCE } from "../src/store/defaults.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MICRO_CENTS_PER_CENT = 1_000_000;
const NEUTRAL_RATE_MICRO = 1_000_000;

function driftSample({ to, from = to, costCts, endedMinutesAgo = 1, source = COST_TRUING_SOURCE.DETAIL_RECORDS }) {
  const nowMs = Date.now();
  const endedAt = new Date(nowMs - endedMinutesAgo * 60_000).toISOString();
  const answeredAt = new Date(nowMs - (endedMinutesAgo + 1) * 60_000).toISOString();
  return { to, from, costTruedSource: source, actualCostMicroCents: costCts * MICRO_CENTS_PER_CENT, answeredAt, endedAt };
}

function uniformSamples(prefix, costCts, n, { offsetStart = 1, source } = {}) {
  return Array.from({ length: n }, (_, i) =>
    driftSample({ to: prefix, costCts, endedMinutesAgo: offsetStart + i, source }),
  );
}

test("P5-01: 20x +49 @ 5ct gemessen, konfiguriert 20 -> overestimate, measuredCentsPerMin 5, samples 20", () => {
  const calls = uniformSamples("+49", 5, 20);
  const [entry] = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  assert.equal(entry.code, TARIFF_DRIFT_FINDING.OVERESTIMATE);
  assert.equal(entry.measuredCentsPerMin, 5);
  assert.equal(entry.samples, 20);
});

test("P5-02: 20x +49 @ 25ct gemessen, konfiguriert 20 -> underestimate (keine Toleranz)", () => {
  const calls = uniformSamples("+49", 25, 20);
  const [entry] = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  assert.equal(entry.code, TARIFF_DRIFT_FINDING.UNDERESTIMATE);
});

test("P5-03: 19 Calls -> insufficient_samples, samples 19, measuredCentsPerMin null, nicht alarmierbar", () => {
  const calls = uniformSamples("+49", 25, 19);
  const report = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  assert.equal(report[0].code, TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES);
  assert.equal(report[0].samples, 19);
  assert.equal(report[0].measuredCentsPerMin, null);
  assert.deepEqual(alertableDriftFindings(report), []);
});

test("P5-04: +49 im Band (25 Samples), +33 ohne Samples -> +49 code null, +33 insufficient_samples/0 (kein Praefix leiht Stichproben)", () => {
  const calls = uniformSamples("+49", 20, 25);
  const report = tariffDriftReport({
    calls,
    prefixes: ["+49", "+33"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  const [de, fr] = report;
  assert.equal(de.prefix, "+49");
  assert.equal(de.code, null);
  assert.equal(fr.prefix, "+33");
  assert.equal(fr.code, TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES);
  assert.equal(fr.samples, 0);
});

test("P5-05: 19x 5ct + 1x 300ct -> p95 ist 5, NICHT 300 (pinnt p95 statt max)", () => {
  const calls = [
    ...uniformSamples("+49", 5, 19, { offsetStart: 1 }),
    driftSample({ to: "+49", costCts: 300, endedMinutesAgo: 20 }),
  ];
  const { samples, p95ProviderMicroCentsPerMin } = measuredCentsPerMinByPrefix(calls, "+49");
  assert.equal(samples, 20);
  assert.equal(p95ProviderMicroCentsPerMin, 5 * MICRO_CENTS_PER_CENT);
  assert.notEqual(p95ProviderMicroCentsPerMin, 300 * MICRO_CENTS_PER_CENT);
});

test("P5-06: p95 != Mittelwert - 15x 4ct + 5x 40ct, konfiguriert 20 -> underestimate (Mittelwert saehe overestimate)", () => {
  const calls = [
    ...uniformSamples("+49", 4, 15, { offsetStart: 1 }),
    ...uniformSamples("+49", 40, 5, { offsetStart: 16 }),
  ];
  const mean = (15 * 4 + 5 * 40) / 20;
  assert.equal(mean, 13, "Kontrollrechnung: Mittelwert liegt unter 20 (saehe overestimate)");
  const [entry] = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  assert.equal(entry.measuredCentsPerMin, 40, "p95, nicht der Mittelwert 13");
  assert.equal(entry.code, TARIFF_DRIFT_FINDING.UNDERESTIMATE);
});

test("P5-07: Waehrungsrichtung - rateMicro 500000, gemessen 40 Provider-ct/min, konfiguriert 20 -> measuredCentsPerMin 20, code null", () => {
  const calls = uniformSamples("+49", 40, 20);
  const [entry] = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: 500_000,
    minSamples: 20,
    warnPercent: 50,
  });
  assert.equal(entry.measuredCentsPerMin, 20);
  assert.equal(entry.code, null, "bei invertierter Richtung ergaebe sich 80 -> underestimate, sichtbar daneben");
});

test("P5-08: 10%-Abweichung (konfiguriert 22, gemessen 20, warnPercent 50) -> code null (Waechter schweigt)", () => {
  const calls = uniformSamples("+49", 20, 20);
  const [entry] = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 22,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  assert.equal(entry.code, null);
});

test("P5-09: 20 Calls mit costTruedSource 'incomplete' -> insufficient_samples, samples 0 (luecken hafte Messung alarmiert nicht gegen sich selbst)", () => {
  const calls = uniformSamples("+49", 25, 20, { source: COST_TRUING_SOURCE.INCOMPLETE });
  const [entry] = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  assert.equal(entry.code, TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES);
  assert.equal(entry.samples, 0);
});

test("P5-10: 120 Calls, die 20 aeltesten absurd teuer -> p95 aus den juengsten 100 (DRIFT_SAMPLE_WINDOW), Ausreisser wirkungslos", () => {
  const recent = uniformSamples("+49", 5, 100, { offsetStart: 1 });
  const old = uniformSamples("+49", 5000, 20, { offsetStart: 101 });
  const { samples, p95ProviderMicroCentsPerMin } = measuredCentsPerMinByPrefix([...recent, ...old], "+49");
  assert.equal(samples, DRIFT_SAMPLE_WINDOW);
  assert.equal(p95ProviderMicroCentsPerMin, 5 * MICRO_CENTS_PER_CENT, "die 20 alten Ausreisser liegen ausserhalb des Fensters");
});

test("P5-11: minSamples 500 bei 100 Calls -> insufficient_samples, samples 100, Meldung nennt fenster=100 (laut, nicht still)", () => {
  const calls = uniformSamples("+49", 25, 100);
  const [entry] = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 500,
    warnPercent: 50,
  });
  assert.equal(entry.code, TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES);
  assert.equal(entry.samples, 100);
  assert.match(driftLine(entry), /fenster=100/);
});

test("P5-12: tariffCentsPerMin unveraendert; cost-calibration.js IMPORTIERT tariffCentsPerMin NICHT (keine funktionale Kopplung an den Tarif-Lookup)", () => {
  assert.equal(tariffCentsPerMin("+4915155512345", "+4930111222333"), config.billing.voiceTariffDomesticCents);
  assert.equal(tariffCentsPerMin("+15551234567", "+4930111222333"), config.billing.voiceTariffDefaultCents);
  const src = fs.readFileSync(path.join(REPO_ROOT, "src", "billing", "cost-calibration.js"), "utf8");
  assert.doesNotMatch(
    src,
    /import\s*\{[^}]*\btariffCentsPerMin\b[^}]*\}/,
    "P5 justiert keinen Tarif - der Waechter darf tariffCentsPerMin nicht importieren (kein Import != kein erklaerender Kommentar)",
  );
});

test("P5-13: COST_CALIBRATION_MIN_SAMPLES in .env.example, render.yaml und config.js-Fallback, alle drei = 20", () => {
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");
  const configSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "config.js"), "utf8");

  const envMatch = envExample.match(/^COST_CALIBRATION_MIN_SAMPLES=(.+)$/m);
  assert.ok(envMatch, "COST_CALIBRATION_MIN_SAMPLES fehlt in .env.example");
  assert.equal(envMatch[1].trim(), "20");

  const renderMatch = renderYaml.match(/key:\s*COST_CALIBRATION_MIN_SAMPLES\s*\n\s*value:\s*"?([^"\n]+)"?/);
  assert.ok(renderMatch, "COST_CALIBRATION_MIN_SAMPLES fehlt in render.yaml");
  assert.equal(renderMatch[1].trim(), "20");

  const codeMatch = configSrc.match(/numEnv\("COST_CALIBRATION_MIN_SAMPLES",[^)]*?fallback:\s*(-?\d+)/);
  assert.ok(codeMatch, "numEnv-Fallback fuer COST_CALIBRATION_MIN_SAMPLES nicht in src/config.js gefunden");
  assert.equal(Number(codeMatch[1]), 20);
});

test("P5-14: alertableDriftFindings enthaelt underestimate+overestimate, nie insufficient_samples", () => {
  const report = [
    { prefix: "+49", code: TARIFF_DRIFT_FINDING.UNDERESTIMATE, samples: 20, measuredCentsPerMin: 25, configuredCentsPerMin: 20 },
    { prefix: "+33", code: TARIFF_DRIFT_FINDING.OVERESTIMATE, samples: 20, measuredCentsPerMin: 5, configuredCentsPerMin: 20 },
    { prefix: "+44", code: TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES, samples: 3, measuredCentsPerMin: null, configuredCentsPerMin: 20 },
    { prefix: "+41", code: null, samples: 20, measuredCentsPerMin: 20, configuredCentsPerMin: 20 },
  ];
  const alertable = alertableDriftFindings(report);
  assert.equal(alertable.length, 2);
  assert.ok(alertable.every((e) => e.code !== TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES));
});

function overflowSamples(prefix, n) {
  return Array.from({ length: n }, (_, i) => ({
    ...driftSample({ to: prefix, costCts: 1, endedMinutesAgo: 1 + i }),
    actualCostMicroCents: Number.MAX_SAFE_INTEGER,
  }));
}

test("P5-16: Umrechnungs-Ueberlauf bei voller Stichprobe -> conversion_error (NICHT insufficient_samples) UND alarmierbar", () => {
  const report = tariffDriftReport({
    calls: overflowSamples("+49", 20),
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  const [entry] = report;
  assert.notEqual(
    entry.code,
    TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES,
    "ein Umrechnungsfehler darf nicht als Datenknappheit getarnt werden",
  );
  assert.equal(entry.code, TARIFF_DRIFT_FINDING.CONVERSION_ERROR);
  assert.equal(entry.measuredCentsPerMin, null, "kein Messwert - aber auch nie 0 (PM-4)");
  assert.equal(entry.samples, 20, "die Stichprobenzahl reist mit: Daten LAGEN vor");
  assert.equal(alertableDriftFindings(report).length, 1, "der Geld-Pfad-Fehler alarmiert");
});

test("P5-17: driftLine bei conversion_error nennt stichproben, aber kein fenster= und kein gemessen=null", () => {
  const [entry] = tariffDriftReport({
    calls: overflowSamples("+49", 20),
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  const line = driftLine(entry);
  assert.match(line, /stichproben=20/);
  assert.match(line, /befund=conversion_error/);
  assert.doesNotMatch(line, /fenster=/, "kein Datenknappheits-Vokabular");
  assert.doesNotMatch(line, /gemessen=null/, "null ist kein Messwert");
});

test("P5-15: PII - der Report traegt die volle Rufnummer nirgends, nur den Praefix", () => {
  const PII_PHONE = "+4915155512345";
  const calls = uniformSamples(PII_PHONE, 20, 20);
  const report = tariffDriftReport({
    calls,
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: NEUTRAL_RATE_MICRO,
    minSamples: 20,
    warnPercent: 50,
  });
  const json = JSON.stringify(report);
  assert.doesNotMatch(json, new RegExp(PII_PHONE.replace("+", "\\+")), "keine volle Rufnummer im Report");
  assert.match(json, /\+49/, "der Praefix selbst darf erscheinen");
});
