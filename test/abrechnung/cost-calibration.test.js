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
} from "../../src/billing/cost-calibration.ts";
import { tariffCentsPerMin } from "../../src/telephony/outbound-gates.js";
import { config } from "../../src/config.js";
import { COST_TRUING_SOURCE } from "../../src/begriffe/abrechnung.js";
import { gebauteKonfiguration } from "../gemeinsam/gebaute-konfiguration.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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
});

test("P5-13: COST_CALIBRATION_MIN_SAMPLES in .env.example, render.yaml und config.js-Fallback, alle drei = 20", () => {
  const envExample = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const renderYaml = fs.readFileSync(path.join(REPO_ROOT, "render.yaml"), "utf8");

  const envMatch = envExample.match(/^COST_CALIBRATION_MIN_SAMPLES=(.+)$/m);
  assert.ok(envMatch, "COST_CALIBRATION_MIN_SAMPLES fehlt in .env.example");
  assert.equal(envMatch[1].trim(), "20");

  const renderMatch = renderYaml.match(/key:\s*COST_CALIBRATION_MIN_SAMPLES\s*\n\s*value:\s*"?([^"\n]+)"?/);
  assert.ok(renderMatch, "COST_CALIBRATION_MIN_SAMPLES fehlt in render.yaml");
  assert.equal(renderMatch[1].trim(), "20");

  const gebaut = gebauteKonfiguration({ COST_CALIBRATION_MIN_SAMPLES: undefined }, ["billing.costCalibrationMinSamples"]);
  assert.equal(gebaut["billing.costCalibrationMinSamples"], Number(envMatch[1]));
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

import * as h7bKalibrierung from "../../src/billing/cost-calibration.ts";
import { EL_STICHPROBE, eigenCentQuelleJeAnruf, elVollkostenState } from "../fixtures/kostenv2-vollkosten-stichprobe.js";

{
  const { TARIFF_DRIFT_FINDING, TARIFPAAR_FINDING, alertableDriftFindings, driftLine, measuredCentsPerMinByPrefix, nearestRankWert, providerMicroCentsToBucketCents, tariffDriftReport, tarifpaarDecktStichproben, tarifpaarEintrag, tarifpaarReport, tarifpaarVorschlag, tarifpaarZeile, vollkostenCentsJeAnruf, vollkostenStichprobenJeRoute } = h7bKalibrierung;
  const BEWEISEND = COST_TRUING_SOURCE.DETAIL_RECORDS;
  const RATE = 1_000_000;
const MINUTE_MS = 60_000;
const ENDE_MS = Date.parse("2026-09-01T12:00:00Z");

function anruf(nr, overrides = {}) {
  return {
    id: `call_${nr}`,
    to: "+4930111222333",
    from: "+4930999888777",
    answeredAt: new Date(ENDE_MS + nr * MINUTE_MS - MINUTE_MS).toISOString(),
    endedAt: new Date(ENDE_MS + nr * MINUTE_MS).toISOString(),
    actualCostMicroCents: 1_000_000,
    costTruedSource: BEWEISEND,
    ...overrides,
  };
}

const RANG_FAELLE = [
  ["letzter Rang bei vier Werten", [10, 20, 30, 40], 95, 40],
  ["ein Wert", [5], 95, 5],
  ["Median", [1, 2, 3, 4], 50, 2],
  ["leere Liste", [], 95, Number.NaN],
];

for (const [name, werte, prozent, erwartet] of RANG_FAELLE) {
  test(`H7b nearestRankWert: ${name}`, () => {
    assert.deepEqual(nearestRankWert(werte, prozent), erwartet);
  });
}

const UMRECHNUNG = [
  ["ein Cent bei gleichem Kurs", 1_000_000, RATE, 1],
  ["aufgerundet", 1_500_000, RATE, 2],
  ["null", 0, RATE, 0],
  ["Überlauf", Number.MAX_SAFE_INTEGER, 2, null],
];

for (const [name, mikro, kurs, erwartet] of UMRECHNUNG) {
  test(`H7b providerMicroCentsToBucketCents: ${name}`, () => {
    assert.equal(providerMicroCentsToBucketCents(mikro, kurs), erwartet);
  });
}

test("H7b Stichproben: Vorwahl, Herkunft, Kosten und Minuten filtern", () => {
  const calls = [
    anruf(1),
    anruf(2, { to: "+15551234567" }),
    anruf(3, { from: "+15551234567" }),
    anruf(4, { costTruedSource: "schaetzung" }),
    anruf(5, { actualCostMicroCents: -1 }),
    anruf(6, { actualCostMicroCents: 1.5 }),
    anruf(7, { answeredAt: null }),
  ];
  assert.deepEqual(measuredCentsPerMinByPrefix(calls, "+49"), { samples: 1, p95ProviderMicroCentsPerMin: 1_000_000 });
  assert.deepEqual(measuredCentsPerMinByPrefix([], "+49"), { samples: 0, p95ProviderMicroCentsPerMin: null });
});

test("H7b Stichproben: nur die neuesten 100 zaehlen", () => {
  const calls = [];
  for (let nr = 1; nr <= 101; nr += 1) calls.push(anruf(nr, { actualCostMicroCents: nr > 95 ? 5_000_000 : 1_000_000 }));
  const gemischt = [...calls.slice(50), ...calls.slice(0, 50)];
  assert.deepEqual(measuredCentsPerMinByPrefix(gemischt, "+49"), { samples: 100, p95ProviderMicroCentsPerMin: 5_000_000 });
  assert.equal(calls[0].actualCostMicroCents, 1_000_000);
});

const BEFUND_FAELLE = [
  ["im Band", 1, 50, null],
  ["zu niedrig konfiguriert", 0, 50, TARIFF_DRIFT_FINDING.UNDERESTIMATE],
  ["Grenze des Bandes", 2, 100, null],
  ["knapp ueber dem Band", 2, 99, TARIFF_DRIFT_FINDING.OVERESTIMATE],
];

for (const [name, konfiguriert, warnPercent, code] of BEFUND_FAELLE) {
  test(`H7b tariffDriftReport: ${name}`, () => {
    const [eintrag] = tariffDriftReport({
      calls: [anruf(1), anruf(2), anruf(3)],
      prefixes: ["+49"],
      configuredCentsPerMin: konfiguriert,
      providerToBucketRateMicro: RATE,
      minSamples: 3,
      warnPercent,
    });
    assert.deepEqual(eintrag, { prefix: "+49", samples: 3, configuredCentsPerMin: konfiguriert, measuredCentsPerMin: 1, code });
  });
}

test("H7b tariffDriftReport: zu wenig Stichproben und Umrechnungsfehler", () => {
  const basis = { calls: [anruf(1)], prefixes: ["+49"], configuredCentsPerMin: 1, warnPercent: 50 };
  const [zuWenig] = tariffDriftReport({ ...basis, providerToBucketRateMicro: RATE, minSamples: 2 });
  assert.deepEqual(zuWenig, {
    prefix: "+49",
    samples: 1,
    configuredCentsPerMin: 1,
    measuredCentsPerMin: null,
    code: TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES,
  });
  const [fehler] = tariffDriftReport({ ...basis, providerToBucketRateMicro: Number.MAX_SAFE_INTEGER, minSamples: 1 });
  assert.equal(fehler.code, TARIFF_DRIFT_FINDING.CONVERSION_ERROR);
  assert.equal(fehler.measuredCentsPerMin, null);
});

test("H7b tariffDriftReport: Mindestzahl 0 ohne Anrufe misst 0 Cent", () => {
  const [eintrag] = tariffDriftReport({
    calls: [],
    prefixes: ["+49"],
    configuredCentsPerMin: 20,
    providerToBucketRateMicro: RATE,
    minSamples: 0,
    warnPercent: 50,
  });
  assert.equal(eintrag.measuredCentsPerMin, 0);
  assert.equal(eintrag.code, TARIFF_DRIFT_FINDING.OVERESTIMATE);
});

test("H7b alertableDriftFindings und driftLine", () => {
  const unterschaetzt = { prefix: "+49", samples: 20, configuredCentsPerMin: 1, measuredCentsPerMin: 2, code: TARIFF_DRIFT_FINDING.UNDERESTIMATE };
  const zuWenig = { prefix: "+49", samples: 3, configuredCentsPerMin: 1, measuredCentsPerMin: null, code: TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES };
  const fehler = { ...zuWenig, samples: 20, code: TARIFF_DRIFT_FINDING.CONVERSION_ERROR };
  const imBand = { ...unterschaetzt, measuredCentsPerMin: 1, code: null };
  assert.deepEqual(alertableDriftFindings([unterschaetzt, zuWenig, fehler, imBand]), [unterschaetzt, fehler]);
  assert.equal(driftLine(unterschaetzt), "praefix=+49 stichproben=20 konfiguriert=1ct gemessen=2ct befund=underestimate");
  assert.equal(driftLine(zuWenig), "praefix=+49 stichproben=3 fenster=100 befund=insufficient_samples");
  assert.equal(driftLine(fehler), "praefix=+49 stichproben=20 konfiguriert=1ct befund=conversion_error");
  assert.equal(driftLine(imBand), "praefix=+49 stichproben=20 konfiguriert=1ct gemessen=1ct befund=im_band");
});

const VOLLKOSTEN = [
  ["Beleg und Eigenanteil", { belegMikroCents: 1_000_000, eigenCent: 2 }, 3],
  ["ohne Beleg", { belegMikroCents: null, eigenCent: 2 }, null],
  ["negativer Beleg", { belegMikroCents: -1, eigenCent: 2 }, null],
  ["Summe ueberlaeuft", { belegMikroCents: 1_000_000, eigenCent: Number.MAX_SAFE_INTEGER }, null],
];

for (const [name, eingabe, erwartet] of VOLLKOSTEN) {
  test(`H7b vollkostenCentsJeAnruf: ${name}`, () => {
    assert.equal(vollkostenCentsJeAnruf(eingabe, RATE), erwartet);
  });
}

test("H7b tarifpaarVorschlag und tarifpaarDecktStichproben", () => {
  const proben = [
    { route: "r", minuten: 1, vollkostenCents: 10 },
    { route: "r", minuten: 2, vollkostenCents: 30 },
  ];
  assert.equal(tarifpaarVorschlag([]), null);
  assert.deepEqual(tarifpaarVorschlag(proben), { grundbetragCents: 30, minutensatzCents: 15 });
  assert.equal(tarifpaarDecktStichproben(null, proben), false);
  assert.equal(tarifpaarDecktStichproben({ grundbetragCents: 0, minutensatzCents: 15 }, []), false);
  assert.equal(tarifpaarDecktStichproben({ grundbetragCents: 0, minutensatzCents: 15 }, proben), true);
  assert.equal(tarifpaarDecktStichproben({ grundbetragCents: 0, minutensatzCents: 14 }, proben), false);
});

test("H7b tarifpaarEintrag: ohne Proben bei Mindestzahl 0 bleibt die Zeile lesbar", () => {
  const eintrag = tarifpaarEintrag({
    route: "el_convai_sip",
    stichproben: [],
    konfiguriert: { grundbetragCents: 0, minutensatzCents: 20 },
    minSamples: 0,
    fehlgrund: "keine",
  });
  assert.equal(eintrag.vorschlag, null);
  assert.equal(eintrag.code, TARIFPAAR_FINDING.UNTERSCHAETZT);
  assert.doesNotThrow(() => tarifpaarZeile(eintrag));
});

test("H7b tarifpaarZeile: zu wenig Proben und Vorschlag", () => {
  const konfiguriert = { grundbetragCents: 1, minutensatzCents: 2 };
  const zuWenig = { route: "r", proben: 1, konfiguriert, vorschlag: null, fehlgrund: "herkunft(1)", code: TARIFPAAR_FINDING.ZU_WENIG_PROBEN };
  assert.equal(tarifpaarZeile(zuWenig), "route=r proben=1 fehlgrund=herkunft(1) befund=tarifpaar_zu_wenig_proben");
  const voll = { ...zuWenig, vorschlag: { grundbetragCents: 3, minutensatzCents: 4 }, fehlgrund: "keine", code: null };
  assert.equal(tarifpaarZeile(voll), "route=r proben=1 vorschlag=3ct+4ct/min konfiguriert=1ct+2ct/min befund=im_band");
});

const BILLING = {
  providerToBucketRateMicro: RATE,
  costCalibrationMinSamples: 1,
  voiceTariffDomesticCents: 20,
  voiceTariffInboundCents: 6,
  voiceTariffDomesticPrefixes: ["+49"],
};

test("H7b tarifpaarReport: ohne Eigenanteile werden alle Anrufe ausgeschlossen und gezaehlt", () => {
  const state = { calls: [anruf(1), anruf(2)], callCostEvidence: [] };
  const eintraege = tarifpaarReport({ state, eigenCentJeAnruf: null, billing: BILLING });
  assert.equal(eintraege.length, 5);
  assert.ok(eintraege.every((eintrag) => eintrag.code === TARIFPAAR_FINDING.ZU_WENIG_PROBEN && eintrag.proben === 0));
  assert.equal(eintraege[0].fehlgrund, "beleg_unvollstaendig(2)");
});

test("H7b tarifpaarReport und Stichproben: leerer Zustand", () => {
  const { jeRoute, ausgeschlossen } = vollkostenStichprobenJeRoute({ state: null, eigenCentJeAnruf: null, rateMicro: RATE });
  assert.equal(jeRoute.size, 5);
  assert.equal(ausgeschlossen.size, 0);
  const eintraege = tarifpaarReport({ state: undefined, eigenCentJeAnruf: undefined, billing: BILLING });
  assert.ok(eintraege.every((eintrag) => eintrag.fehlgrund === "keine"));
});

test("H7b Grundbetrag je Route: nur eigene Schluessel zaehlen", () => {
  const billing = { ...BILLING, voiceTariffGrundbetragCentsJeRoute: { el_convai_sip: 7 } };
  const konfiguriert = tarifpaarReport({ state: null, eigenCentJeAnruf: null, billing }).map((eintrag) => [
    eintrag.route,
    eintrag.konfiguriert,
  ]);
  assert.deepEqual(konfiguriert.find(([route]) => route === "el_convai_sip")?.[1], { grundbetragCents: 7, minutensatzCents: 20 });
  assert.deepEqual(konfiguriert.find(([route]) => route === "telnyx_inbound_budget")?.[1], { grundbetragCents: 0, minutensatzCents: 6 });
  const geerbt = { ...BILLING, voiceTariffGrundbetragCentsJeRoute: Object.create({ el_convai_sip: 7 }) };
  const [erste] = tarifpaarReport({ state: null, eigenCentJeAnruf: null, billing: geerbt });
  assert.equal(erste.konfiguriert.grundbetragCents, 0);
});

test("H7b Stichproben: bei gleicher Endzeit zaehlen die spaeter genannten Anrufe", () => {
  const gleichzeitig = [];
  for (let nr = 1; nr <= 101; nr += 1) gleichzeitig.push(anruf(nr, { answeredAt: new Date(ENDE_MS - MINUTE_MS).toISOString(), endedAt: new Date(ENDE_MS).toISOString(), actualCostMicroCents: nr * 1_000_000 }));
  assert.deepEqual(measuredCentsPerMinByPrefix(gleichzeitig, "+49"), { samples: 100, p95ProviderMicroCentsPerMin: 96_000_000 });
  assert.deepEqual(measuredCentsPerMinByPrefix([...gleichzeitig].reverse(), "+49"), { samples: 100, p95ProviderMicroCentsPerMin: 95_000_000 });
});

const EIGEN_CENT_AUSSCHLUSS = [
  ["Bruchzahl", 1.5],
  ["negativ", -1],
  ["ausserhalb des sicheren Bereichs", 2 ** 60],
  ["keine Zahl", Number.NaN],
];

for (const [name, wert] of EIGEN_CENT_AUSSCHLUSS) {
  test(`H7b Eigenanteil ${name}: der Anruf zaehlt als eigen_achsen ausgeschlossen`, () => {
    const eigen = eigenCentQuelleJeAnruf();
    eigen.set(EL_STICHPROBE[0].callId, wert);
    const { jeRoute, ausgeschlossen } = vollkostenStichprobenJeRoute({ state: elVollkostenState(), eigenCentJeAnruf: eigen, rateMicro: RATE });
    assert.equal(ausgeschlossen.get("eigen_achsen"), 1);
    assert.equal(jeRoute.get("el_convai_sip").length, EL_STICHPROBE.length - 1);
  });
}

test("H7b Eigenanteil null Cent und fehlender Eintrag", () => {
  const eigen = eigenCentQuelleJeAnruf();
  eigen.set(EL_STICHPROBE[0].callId, 0);
  eigen.delete(EL_STICHPROBE[1].callId);
  const { jeRoute, ausgeschlossen } = vollkostenStichprobenJeRoute({ state: elVollkostenState(), eigenCentJeAnruf: eigen, rateMicro: RATE });
  assert.equal(ausgeschlossen.get("eigen_achsen"), 1);
  assert.equal(jeRoute.get("el_convai_sip").length, EL_STICHPROBE.length - 1);
});
}
