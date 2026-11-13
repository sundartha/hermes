import assert from "node:assert/strict";
import { test } from "node:test";

import { COST_TRUING_SOURCE } from "../../src/begriffe/abrechnung.js";
import {
  TARIFF_DRIFT_FINDING,
  TARIFPAAR_FINDING,
  alertableDriftFindings,
  driftLine,
  measuredCentsPerMinByPrefix,
  nearestRankWert,
  providerMicroCentsToBucketCents,
  tariffDriftReport,
  tarifpaarDecktStichproben,
  tarifpaarEintrag,
  tarifpaarReport,
  tarifpaarVorschlag,
  tarifpaarZeile,
  vollkostenCentsJeAnruf,
  vollkostenStichprobenJeRoute,
} from "../../src/billing/cost-calibration.ts";

const RATE = 1_000_000;
const MINUTE_MS = 60_000;
const ENDE_MS = Date.parse("2026-09-01T12:00:00Z");
const BEWEISEND = COST_TRUING_SOURCE.DETAIL_RECORDS;

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
