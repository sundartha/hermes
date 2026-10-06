import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  usageFor,
  applyCostCorrectionCents,
  bookCostCorrectionCents,
  NO_CHARGE_ANCHORS,
} from "../src/store/state-ops.js";
import { emptyUsage, isBookableCents, isCorrectionCents, USAGE_CORRUPT_REASON } from "../src/store/defaults.js";

const TENANT_A = "tenant_a";
const JULY_ISO = "2026-07-19T10:00:00.000Z";

function captureErr(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return logs.join("\n");
}

const NEUTRAL_RATE = 1_000_000;

function seedUsage(s, tenantId, overrides = {}) {
  s.usage[tenantId] = { ...emptyUsage(), ...overrides };
  return usageFor(s, tenantId);
}

test("(d) 0-BODEN: costCents faellt NIE unter 0 (Ist 0, Schaetzung 15, vorhandene 3 Cent)", () => {
  const s = makeDefaultState();
  seedUsage(s, TENANT_A, { costCents: 3 });
  const { usage, booked, deltaCents } = applyCostCorrectionCents(
    s,
    TENANT_A,
    { actualCostMicroCents: 0, estimatedCostCents: 15, providerToBucketRateMicro: NEUTRAL_RATE, dataComplete: true },
    JULY_ISO,
  );
  assert.equal(booked, true);
  assert.equal(deltaCents, -15);
  assert.equal(usage.costCents, 0, "0-Boden: NIE negativ, obwohl 3 - 15 = -12");
});

test("(e1) FREMDER Anker (Vormonat): negative Korrektur senkt NUR costCents, spendMonthCostCents/-Key bleiben bit-identisch", () => {
  const s = makeDefaultState();
  seedUsage(s, TENANT_A, { costCents: 100, spendMonthKey: "2026-07", spendMonthCostCents: 50 });
  const { usage, booked } = applyCostCorrectionCents(
    s,
    TENANT_A,
    {
      actualCostMicroCents: 0,
      estimatedCostCents: 15,
      providerToBucketRateMicro: NEUTRAL_RATE,
      dataComplete: true,
      chargeAnchors: { spendMonthKey: "2026-06", periodKey: null },
    },
    JULY_ISO,
  );
  assert.equal(booked, true);
  assert.equal(usage.costCents, 85, "Lebenszeit-Achse sinkt (100-15)");
  assert.equal(usage.spendMonthCostCents, 50, "Monats-Achse UNVERAENDERT - sonst liesse sich die Monatsdecke mit alten Calls zurueckdrehen");
  assert.equal(usage.spendMonthKey, "2026-07", "kein Phantom-Stempel ueber eine negative Korrektur");
});

test("(e2) KS-P5, Anker = laufender Monat: die Gutschrift senkt die Monats-Achse mit (50 -> 35)", () => {
  const s = makeDefaultState();
  seedUsage(s, TENANT_A, { costCents: 100, spendMonthKey: "2026-07", spendMonthCostCents: 50 });
  const { usage, booked } = applyCostCorrectionCents(
    s,
    TENANT_A,
    {
      actualCostMicroCents: 0,
      estimatedCostCents: 15,
      providerToBucketRateMicro: NEUTRAL_RATE,
      dataComplete: true,
      chargeAnchors: { spendMonthKey: "2026-07", periodKey: null },
    },
    JULY_ISO,
  );
  assert.equal(booked, true);
  assert.equal(usage.costCents, 85);
  assert.equal(usage.spendMonthCostCents, 35, "die Belastung steckt nachweislich in genau dieser Monatszahl");
  assert.equal(usage.spendMonthKey, "2026-07");
});

test("(f) 200 Korrekturen a 400.000 Mikro-Cent bei Kurs 920000 -> costCents=73, Rest=600000000000", () => {
  const s = makeDefaultState();
  const RUNS = 200;
  for (let i = 0; i < RUNS; i++) {
    applyCostCorrectionCents(
      s,
      TENANT_A,
      { actualCostMicroCents: 400_000, estimatedCostCents: 0, providerToBucketRateMicro: 920_000, dataComplete: true },
      JULY_ISO,
    );
  }
  const usage = usageFor(s, TENANT_A);
  assert.equal(usage.costCents, 73, "Summe der Produkte 200*3,68e11=7,36e13; /1e12=73,6 -> 73 gebucht");
  assert.equal(usage.costCorrectionMicroCentsRem, 600_000_000_000, "Rest 0,6 Cent - OHNE Uebertrag verschwaenden systematisch 73 Cent");
});

test("(j) 50.000.000 Mikro-Cent bei Kurs 920000, Schaetzung 20 -> delta=+26 (NICHT +30 ohne Umrechnung)", () => {
  const s = makeDefaultState();
  const { usage, deltaCents } = applyCostCorrectionCents(
    s,
    TENANT_A,
    { actualCostMicroCents: 50_000_000, estimatedCostCents: 20, providerToBucketRateMicro: 920_000, dataComplete: true },
    JULY_ISO,
  );
  assert.equal(deltaCents, 26, "46 Cent Ist (50e6*920000/1e12=46, Rest 0) - 20 Cent Schaetzung = 26, NICHT 30");
  assert.equal(usage.costCents, 26);
});

test("Rest bit-gleich: ein verworfener Lauf (delta<0, dataComplete:false) aendert weder costCents noch den Rest; Endwert == Kontrolllauf ohne den verworfenen Lauf", () => {
  const RUN = { actualCostMicroCents: 400_000, estimatedCostCents: 0, providerToBucketRateMicro: 920_000, dataComplete: true };

  const s = makeDefaultState();
  for (let i = 0; i < 3; i++) applyCostCorrectionCents(s, TENANT_A, RUN, JULY_ISO);
  const after3 = usageFor(s, TENANT_A);
  assert.equal(after3.costCents, 1);
  assert.equal(after3.costCorrectionMicroCentsRem, 104_000_000_000);

  const discarded = applyCostCorrectionCents(
    s,
    TENANT_A,
    { actualCostMicroCents: 0, estimatedCostCents: 100, providerToBucketRateMicro: 920_000, dataComplete: false },
    JULY_ISO,
  );
  assert.equal(discarded.booked, false);
  const afterDiscard = usageFor(s, TENANT_A);
  assert.equal(afterDiscard.costCents, 1, "verworfener Lauf: costCents bit-identisch");
  assert.equal(afterDiscard.costCorrectionMicroCentsRem, 104_000_000_000, "verworfener Lauf: Rest bit-identisch");

  applyCostCorrectionCents(s, TENANT_A, RUN, JULY_ISO);
  const finalState = usageFor(s, TENANT_A);

  const control = makeDefaultState();
  for (let i = 0; i < 4; i++) applyCostCorrectionCents(control, TENANT_A, RUN, JULY_ISO);
  const controlUsage = usageFor(control, TENANT_A);

  assert.equal(finalState.costCents, controlUsage.costCents, "Endwert costCents == Kontrolllauf");
  assert.equal(
    finalState.costCorrectionMicroCentsRem,
    controlUsage.costCorrectionMicroCentsRem,
    "Endwert Rest == Kontrolllauf - der verworfene Lauf hat NICHTS beigetragen",
  );
});

test("Praedikate: isBookableCents(-1)===false bleibt unveraendert; isCorrectionCents traegt beliebiges Vorzeichen, aber nur Ganzzahl+endlich", () => {
  assert.equal(isBookableCents(-1), false, "isBookableCents wird NICHT aufgeweicht");
  assert.equal(isCorrectionCents(-1), true, "Korrektur darf negativ sein");
  assert.equal(isCorrectionCents(0), true);
  assert.equal(isCorrectionCents(5), true);
  assert.equal(isCorrectionCents(1.5), false, "keine Bruchteile");
  assert.equal(isCorrectionCents(NaN), false);
  assert.equal(isCorrectionCents(Infinity), false);
  assert.equal(isCorrectionCents(-Infinity), false);
});

test("D7 end-to-end: bookCostCorrectionCents(NaN/1.5) verwirft, Bucket bit-identisch, geloggt", () => {
  for (const bad of [NaN, 1.5, Infinity, -Infinity]) {
    const s = makeDefaultState();
    seedUsage(s, TENANT_A, { costCents: 42, spendMonthKey: "2026-07", spendMonthCostCents: 30 });
    const before = { ...usageFor(s, TENANT_A) };
    let result;
    const out = captureErr(() => {
      result = bookCostCorrectionCents(s, {
        tenantId: TENANT_A,
        deltaCents: bad,
        chargeAnchors: NO_CHARGE_ANCHORS,
        nowIso: JULY_ISO,
      });
    });
    assert.equal(result.booked, false, `deltaCents=${String(bad)} darf nicht buchen`);
    assert.deepEqual(usageFor(s, TENANT_A), before, `deltaCents=${String(bad)}: Bucket bit-identisch`);
    assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
  }
});

test("D7 end-to-end: applyCostCorrectionCents mit NaN-estimatedCostCents verwirft alles-oder-nichts", () => {
  const s = makeDefaultState();
  seedUsage(s, TENANT_A, {
    costCents: 42,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 30,
    costCorrectionMicroCentsRem: 104_000_000_000,
  });
  const before = { ...usageFor(s, TENANT_A) };
  let result;
  const out = captureErr(() => {
    result = applyCostCorrectionCents(
      s,
      TENANT_A,
      { actualCostMicroCents: 50_000_000, estimatedCostCents: NaN, providerToBucketRateMicro: 920_000, dataComplete: true },
      JULY_ISO,
    );
  });
  assert.equal(result.booked, false, "NaN-Schaetzung darf nicht buchen");
  assert.deepEqual(usageFor(s, TENANT_A), before, "kein Teil-Schreibeffekt: der Korrektur-Rest bleibt bit-identisch");
  assert.match(out, new RegExp(`grund=${USAGE_CORRUPT_REASON}`));
});
