import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  addVoiceUsageCostCents,
  bookCostCorrectionCents,
  NO_CHARGE_ANCHORS,
  gateUsageCents,
  stampBudgetPeriod,
  budgetExceeded,
  gatePlatformUsageCents,
  releaseOutboundReserveCents,
} from "../../src/store/state-ops.js";
import { emptyUsage } from "../../src/store/defaults.js";
import { PRICES } from "../_prices.js";
import { fehlerausgabeVon } from "../gemeinsam/fehlerausgabe.js";

const TENANT_A = "tenant_a";

const PERIOD_JUNE = "2026-06-01T00:00:00.000Z";
const PERIOD_JULY = "2026-07-01T00:00:00.000Z";
const NOW_ISO = "2026-07-19T10:00:00.000Z";

const FLAG_OFF = PRICES;
const FLAG_ON = { ...PRICES, budgetMonthEnabled: true };

function stateWithUsage(tenantId, overrides = {}) {
  const s = makeDefaultState();
  s.usage[tenantId] = { ...emptyUsage(), ...overrides };
  return s;
}

test("B1 nie gestempelt -> das Gate misst die LEBENSZEIT (Bestandsverhalten, Flag AUS)", () => {
  const s = stateWithUsage(TENANT_A, { costCents: 250 });
  assert.equal(gateUsageCents(s, TENANT_A, FLAG_OFF, NOW_ISO), 250);
});

test("B2 gestempelt -> das Gate misst costCents minus Baseline; Folgebuchungen zaehlen weiter", () => {
  const s = stateWithUsage(TENANT_A, { costCents: 300 });
  assert.deepEqual(stampBudgetPeriod(s, TENANT_A, PERIOD_JULY), { changed: true });
  assert.equal(gateUsageCents(s, TENANT_A, FLAG_OFF, NOW_ISO), 0, "frisches Fenster startet bei 0");
  assert.equal(s.usage[TENANT_A].costCents, 300, "der Lebenszeit-Zaehler bleibt monoton");

  addVoiceUsageCostCents(s, TENANT_A, 40, NOW_ISO);
  assert.equal(gateUsageCents(s, TENANT_A, FLAG_OFF, NOW_ISO), 40);
  assert.equal(s.usage[TENANT_A].costCents, 340);
});

test("B3 gleicher Schluessel -> No-Op (idempotent, Baseline unveraendert)", () => {
  const s = stateWithUsage(TENANT_A, { costCents: 100 });
  stampBudgetPeriod(s, TENANT_A, PERIOD_JULY);
  addVoiceUsageCostCents(s, TENANT_A, 50, NOW_ISO);

  assert.deepEqual(
    stampBudgetPeriod(s, TENANT_A, PERIOD_JULY),
    { changed: false },
    "ein Webhook-Retry darf kein zweites Freikontingent oeffnen",
  );
  assert.equal(s.usage[TENANT_A].budgetPeriodBaselineCents, 100);
  assert.equal(gateUsageCents(s, TENANT_A, FLAG_OFF, NOW_ISO), 50);
});

test("B4 AELTERER Schluessel -> No-Op (Monotonie-Riegel gegen rueckdatierte Events)", () => {
  const s = stateWithUsage(TENANT_A, { costCents: 100 });
  stampBudgetPeriod(s, TENANT_A, PERIOD_JULY);
  addVoiceUsageCostCents(s, TENANT_A, 50, NOW_ISO);

  assert.deepEqual(stampBudgetPeriod(s, TENANT_A, PERIOD_JUNE), { changed: false });
  assert.equal(s.usage[TENANT_A].budgetPeriodKey, PERIOD_JULY, "kein Rueckwaerts-Stempel");
  assert.equal(s.usage[TENANT_A].budgetPeriodBaselineCents, 100);
});

test("B4b kein Perioden-Anker -> No-Op, das Gate bleibt auf der Lebenszeit-Achse", () => {
  const s = stateWithUsage(TENANT_A, { costCents: 250 });
  assert.deepEqual(stampBudgetPeriod(s, TENANT_A, null), { changed: false });
  assert.equal(gateUsageCents(s, TENANT_A, FLAG_OFF, NOW_ISO), 250, "strenger, nicht lockerer");
});

test("B5 negative Korrektur unter die Baseline -> Gate-Verbrauch 0, nie negativ", () => {
  const s = stateWithUsage(TENANT_A, { costCents: 100 });
  stampBudgetPeriod(s, TENANT_A, PERIOD_JULY);
  bookCostCorrectionCents(s, { tenantId: TENANT_A, deltaCents: -30, chargeAnchors: NO_CHARGE_ANCHORS, nowIso: NOW_ISO });
  assert.equal(s.usage[TENANT_A].costCents, 70);
  assert.equal(
    gateUsageCents(s, TENANT_A, FLAG_OFF, NOW_ISO),
    0,
    "ein negativer Verbrauch waere ein Guthaben, das das Gate aufweitet",
  );
});

test("B6 A4-Beweis: die PLATTFORM-MESSUNG bleibt Lebenszeit/Spend-Monat, das Fenster hebt sie nicht auf", () => {
  const s = makeDefaultState();
  for (const tenantId of ["t1", "t2", "t3"]) {
    s.usage[tenantId] = { ...emptyUsage(), costCents: 300 };
    stampBudgetPeriod(s, tenantId, PERIOD_JULY);
    addVoiceUsageCostCents(s, tenantId, 10, NOW_ISO);
    assert.equal(gateUsageCents(s, tenantId, FLAG_OFF, NOW_ISO), 10, `${tenantId} unter der eigenen Decke`);
  }
  assert.equal(
    gatePlatformUsageCents(s, FLAG_OFF, NOW_ISO),
    3 * 310,
    "Flag AUS: die Plattform-Messung liest weiter die Lebenszeit-Summe, nicht das Perioden-Fenster",
  );
  assert.equal(
    gatePlatformUsageCents(s, FLAG_ON, NOW_ISO),
    3 * 10,
    "Flag AN: die Plattform-Messung liest die Spend-Monat-Summe, nicht das Perioden-Fenster",
  );
});

test("B7 Flag AN ignoriert den Stempel (die Spend-Monat-Achse gewinnt, P4/P7 unberuehrt)", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: 500,
    spendMonthKey: "2026-07",
    spendMonthCostCents: 120,
  });
  stampBudgetPeriod(s, TENANT_A, PERIOD_JULY);
  assert.equal(gateUsageCents(s, TENANT_A, FLAG_ON, NOW_ISO), 120);
});

test("B8 D7 bleibt scharf: unbuchbarer Lebenszeit-Zaehler sperrt trotz gesetztem Stempel", () => {
  const s = stateWithUsage(TENANT_A, { costCents: NaN });
  stampBudgetPeriod(s, TENANT_A, PERIOD_JULY);
  let gesperrt;
  fehlerausgabeVon(() => {
    gesperrt = budgetExceeded(s, TENANT_A, FLAG_OFF, NOW_ISO);
  });
  assert.equal(
    gesperrt,
    true,
    "ein vergifteter Bucket darf nicht durch das Fenster fail-open werden",
  );
});

const INCONSISTENT_BASELINE_CENTS = 100;
const LIFETIME_CENTS = 250;
const FRACTIONAL_CENTS = 100.5;

async function fehlerzeilen(fn) {
  const zeilen = [];
  const orig = console.error;
  console.error = (...a) => zeilen.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return zeilen.join("\n");
}

test("B20 ohne Zeitraum-Stempel misst das Gate die Lebenszeit, auch wenn eine Baseline im Bucket steht", () => {
  const s = stateWithUsage(TENANT_A, {
    costCents: LIFETIME_CENTS,
    budgetPeriodKey: null,
    budgetPeriodBaselineCents: INCONSISTENT_BASELINE_CENTS,
  });
  assert.equal(gateUsageCents(s, TENANT_A, FLAG_OFF, NOW_ISO), LIFETIME_CENTS);
});

test("B21 ein fehlender Zeitraum-Start stempelt nichts und meldet keine Aenderung", () => {
  for (const fehlend of [undefined, null, ""]) {
    const s = stateWithUsage(TENANT_A, { costCents: LIFETIME_CENTS });
    assert.deepEqual(stampBudgetPeriod(s, TENANT_A, fehlend), { changed: false });
    assert.equal(s.usage[TENANT_A].budgetPeriodKey, null);
    assert.equal(gateUsageCents(s, TENANT_A, FLAG_OFF, NOW_ISO), LIFETIME_CENTS);
  }
  const leer = makeDefaultState();
  assert.deepEqual(stampBudgetPeriod(leer, TENANT_A, undefined), { changed: false });
  assert.equal(TENANT_A in leer.usage, false, "kein Bucket fuer einen Mandanten ohne Buchung");
});

test("B22 kaputte Achse: die Sperre nennt Mandant, Achse und Wert in der Fehlerzeile", async () => {
  const gate = stateWithUsage(TENANT_A, {
    costCents: LIFETIME_CENTS,
    budgetPeriodKey: PERIOD_JULY,
    budgetPeriodBaselineCents: LIFETIME_CENTS - 0.5,
  });
  let gesperrt;
  const gateZeile = await fehlerzeilen(() => {
    gesperrt = budgetExceeded(gate, TENANT_A, FLAG_OFF, NOW_ISO);
  });
  assert.equal(gesperrt, true);
  assert.match(gateZeile, /kante=tenant:tenant_a feld=gateCents wert=0\.5$/);
  const lifetime = stateWithUsage(TENANT_A, {
    costCents: FRACTIONAL_CENTS,
    budgetPeriodKey: PERIOD_JULY,
    budgetPeriodBaselineCents: FRACTIONAL_CENTS,
  });
  const lifetimeZeile = await fehlerzeilen(() => {
    gesperrt = budgetExceeded(lifetime, TENANT_A, FLAG_OFF, NOW_ISO);
  });
  assert.equal(gesperrt, true);
  assert.match(lifetimeZeile, /kante=tenant:tenant_a feld=lifetimeCents wert=100\.5$/);
});

test("B23 eine gueltige Reserve-Freigabe meldet true und gibt die Reserve zurueck", () => {
  const s = makeDefaultState();
  s.reservations[TENANT_A] = 80;
  assert.equal(releaseOutboundReserveCents(s, TENANT_A, 30), true);
  assert.equal(s.reservations[TENANT_A], 50);
});
