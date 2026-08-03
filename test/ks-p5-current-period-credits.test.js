// KS-P5: Gutschriften der LAUFENDEN Periode duerfen wirken - je Achse aber nur dann, wenn
// der am Call persistierte BELASTUNGS-Anker dieselbe Achsen-Zahl trifft. Vor dieser Phase
// erreichte eine Gutschrift ausschliesslich den Lebenszeit-Zaehler (Monats-Achse pauschal
// gesperrt, Perioden-Achse ungeschuetzt als reine costCents-Ableitung).
//
// Ops-Ebene, in-process, netzfrei, KEIN Server-Spawn (F.I.R.S.T.; Muster
// test/budget-period-window.test.js). Kein Testname traegt ein i18n-Katalog-Praefix - alle
// Tests hier gehoeren in den Regressionslauf npm test, nicht in test:gates.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addVoiceUsageCostCents,
  bookCostCorrectionCents,
  budgetExceeded,
  chargeAnchorsOfCall,
  createCall,
  gatePlatformUsageCents,
  gateUsageCents,
  makeDefaultState,
  recordCallEstimatedCostCents,
  setTenantBudget,
  spendMonthUsageCents,
  stampBudgetPeriod,
  usageFor,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, emptyUsage, USAGE_CORRUPT_REASON } from "../src/store/defaults.js";
import { callTariffCentsPerMin, makeMetering } from "../src/billing/metering.js";
import { makeCostTruing, SWEEP_TRIGGER } from "../src/billing/cost-truing.js";
import { makeStubStore, fakeConfig, makeDueOutboundCall } from "./cost-truing-harness.js";
import { PRICES } from "./_prices.js";

const TENANT = "tenant_ks_p5";
const NACHBAR_TENANT = "tenant_ks_p5_nachbar";

// Perioden-Anker (ISO-8601, lexikografisch = chronologisch) + die zugehoerigen
// Spend-Monat-Schluessel.
const PERIOD_JUNE = "2026-06-01T00:00:00.000Z";
const PERIOD_JULY = "2026-07-01T00:00:00.000Z";
const MONTH_JUNE = "2026-06";
const MONTH_JULY = "2026-07";
const MONTH_AUGUST = "2026-08";
const JULY_ISO = "2026-07-19T10:00:00.000Z";

const FLAG_OFF = PRICES; // budgetMonthEnabled fehlt -> falsy -> AUS (der Live-Zustand)
const FLAG_ON = { ...PRICES, budgetMonthEnabled: true };

// Die zwei Achsen-Stempel, unter denen die BELASTUNG gebucht wurde - genau die Form, die
// chargeAnchorsOfUsage/chargeAnchorsOfCall liefern.
const ANKER_LAUFENDE_PERIODE = { spendMonthKey: MONTH_JULY, periodKey: PERIOD_JULY };
const ANKER_VORPERIODE = { spendMonthKey: MONTH_JUNE, periodKey: PERIOD_JUNE };
// Fuer die Spend-Monat-Faelle ist das Perioden-Fenster nie gestempelt (periodKey null auf
// BEIDEN Seiten = Gleichheit) - so prueft der Test nur die Monats-Achse.
const ANKER_LAUFENDER_MONAT = { spendMonthKey: MONTH_JULY, periodKey: null };
const ANKER_VORMONAT = { spendMonthKey: MONTH_JUNE, periodKey: null };

// Live gemessene Zahlen des Vorfalls (B4/B5): 8,61 EUR Gutschriften gegen einen
// Lebenszeit-Bucket von 4,23 EUR. Der Ueberhang ist kein konstruierter Grenzfall.
const LEBENSZEIT_CENTS = 423;
const GUTSCHRIFT_CENTS = -861;
// Davon fiel nur ein Teil in den laufenden Monat - genau deshalb kann die Monatszahl nach
// dem 0-Boden von costCents negativ werden.
const MONATS_ANTEIL_CENTS = 200;
const NACHBAR_MONATS_CENTS = 500;
const TENANT_CAP_CENTS = 500;

// Monatsgrenzen-Fixture (P8): der Call beginnt am 31.07. um 23:58 und endet/bucht am
// 01.08. um 00:05.
const JULI_LETZTE_MINUTE_ISO = "2026-07-31T23:58:00.000Z";
const AUGUST_ENDE_ISO = "2026-08-01T00:05:00.000Z";
const AUGUST_BUCHUNG_ISO = "2026-08-01T00:05:30.000Z";
const AUGUST_GUTSCHRIFT_CENTS = 5;

// Die volle Pflicht-Menge der Belegtypen (Muster test/cost-truing-booking.test.js): nur
// ueber ihr wird measured.source zu 'telnyx_detail_records' und damit eine Rueckerstattung
// ueberhaupt zulaessig.
const PFLICHT_RECORD_TYPES = ["sip-trunking", "call-control", "speech-to-text", "text-to-speech", "recording"];

// Build (P13): ein Bucket, in dem eine Belastung bereits gebucht IST - Lebenszeit,
// Monatszaehler und Perioden-Fenster (costCents minus Baseline) in EINEM Schritt.
function seedCharged(s, tenantId, { costCents, spendMonthCostCents, periodKey = null, periodBaselineCents = 0 }) {
  s.usage[tenantId] = {
    ...emptyUsage(),
    costCents,
    spendMonthKey: MONTH_JULY,
    spendMonthCostCents,
    budgetPeriodKey: periodKey,
    budgetPeriodBaselineCents: periodBaselineCents,
  };
  return s.usage[tenantId];
}

// Sammelt console.error waehrend fn (Muster captureErr in budget-period-window.test.js) -
// restauriert IMMER, auch bei Wurf. Die Zeilen sind hier Pruefgegenstand: ein
// usage_korrupt-Log waere der Beweis, dass die Gutschrift den Tenant gesperrt hat.
function captureErrLines(fn) {
  const orig = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

// Store-Fassade fuer makeMetering auf den ECHTEN state-ops (Muster
// cost-truing-harness.makeStubStore): dieselben zwei Methoden, die
// reconcileVoiceBudget benutzt, mit INJIZIERTER Uhr - die json-Fassade nimmt dort
// Date.now(), was den Monatsgrenzen-Fall unpruefbar machte.
function meteringStoreOn(s, nowIso) {
  return {
    addVoiceUsageCostCents: (tenantId, costCents) => addVoiceUsageCostCents(s, tenantId, costCents, nowIso),
    recordCallEstimatedCostCents: (callId, input) => recordCallEstimatedCostCents(s, callId, input).call,
  };
}

// Belege ueber die volle Pflicht-Menge mit Ist-Kosten 0 bei abgerechneten Sekunden > 0:
// vollstaendige Datenlage (refundProven) UND maximale Rueckerstattung in einem Stub.
function nullCostControl() {
  const records = PFLICHT_RECORD_TYPES.map((recordType) => ({
    recordType,
    costMicroCents: 0,
    currency: "USD",
    billedSec: 60,
  }));
  return {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords() {
      return { ok: true, records };
    },
  };
}

// ---- P1/P2: Perioden-Achse (Flag AUS, der Live-Zustand) ----

test("P1 Flag AUS: Gutschrift der LAUFENDEN Periode senkt den Gate-Verbrauch mit", () => {
  const s = makeDefaultState();
  seedCharged(s, TENANT, { costCents: 100, spendMonthCostCents: 100, periodKey: PERIOD_JULY });
  assert.equal(gateUsageCents(s, TENANT, FLAG_OFF, JULY_ISO), 100);

  bookCostCorrectionCents(s, {
    tenantId: TENANT,
    deltaCents: -30,
    chargeAnchors: ANKER_LAUFENDE_PERIODE,
    nowIso: JULY_ISO,
  });

  assert.equal(gateUsageCents(s, TENANT, FLAG_OFF, JULY_ISO), 70, "die Gutschrift gibt dem Kunden sein Kontingent zurueck");
  assert.equal(
    usageFor(s, TENANT).budgetPeriodBaselineCents,
    0,
    "die Belastung gehoert ins laufende Fenster - die Baseline bleibt stehen",
  );
});

test("P2 Flag AUS: Gutschrift aus der VORPERIODE senkt die Lebenszeit, das Fenster bleibt unberuehrt", () => {
  const s = makeDefaultState();
  // 60 Cent wurden VOR dem Periodenbeginn gebucht (Baseline), 40 danach.
  seedCharged(s, TENANT, { costCents: 100, spendMonthCostCents: 40, periodKey: PERIOD_JULY, periodBaselineCents: 60 });
  assert.equal(gateUsageCents(s, TENANT, FLAG_OFF, JULY_ISO), 40);

  bookCostCorrectionCents(s, {
    tenantId: TENANT,
    deltaCents: -30,
    chargeAnchors: ANKER_VORPERIODE,
    nowIso: JULY_ISO,
  });

  assert.equal(usageFor(s, TENANT).costCents, 70, "die Lebenszeit-Achse sinkt immer");
  assert.equal(
    gateUsageCents(s, TENANT, FLAG_OFF, JULY_ISO),
    40,
    "die Baseline wandert mit - eine alte Gutschrift weitet die Periodendecke NICHT auf",
  );
});

// ---- P3/P4: Spend-Monat-Achse (Flag AN) ----

test("P3 Flag AN: Gutschrift des LAUFENDEN Monats senkt die Monats-Achse mit", () => {
  const s = makeDefaultState();
  seedCharged(s, TENANT, { costCents: 100, spendMonthCostCents: 50 });
  assert.equal(gateUsageCents(s, TENANT, FLAG_ON, JULY_ISO), 50);

  bookCostCorrectionCents(s, {
    tenantId: TENANT,
    deltaCents: -15,
    chargeAnchors: ANKER_LAUFENDER_MONAT,
    nowIso: JULY_ISO,
  });

  assert.equal(
    gateUsageCents(s, TENANT, FLAG_ON, JULY_ISO),
    35,
    "die Belastung steckt nachweislich in genau dieser Monatszahl",
  );
});

test("P4 Flag AN: Gutschrift aus dem VORMONAT laesst die Monats-Achse bit-identisch", () => {
  const s = makeDefaultState();
  seedCharged(s, TENANT, { costCents: 100, spendMonthCostCents: 50 });

  bookCostCorrectionCents(s, {
    tenantId: TENANT,
    deltaCents: -15,
    chargeAnchors: ANKER_VORMONAT,
    nowIso: JULY_ISO,
  });

  const usage = usageFor(s, TENANT);
  assert.equal(usage.costCents, 85, "die Lebenszeit-Achse sinkt immer");
  assert.equal(usage.spendMonthCostCents, 50, "ein Cap, den man mit alten Calls zurueckdreht, ist kein Cap");
  assert.equal(usage.spendMonthKey, MONTH_JULY, "kein Phantom-Stempel ueber eine negative Korrektur");
  assert.equal(gateUsageCents(s, TENANT, FLAG_ON, JULY_ISO), 50);
});

// ---- P5/P6: der 0-BODEN beider Achsen bei einer Ueber-Gutschrift ----

// Build fuer beide Faelle (G5): 8,61 EUR Gutschrift auf 4,23 EUR Lebenszeit, verankert im
// laufenden Monat. Der 0-Boden kappt den wirksamen Betrag auf -423.
function stateAfterOverCredit() {
  const s = makeDefaultState();
  seedCharged(s, TENANT, { costCents: LEBENSZEIT_CENTS, spendMonthCostCents: MONATS_ANTEIL_CENTS });
  bookCostCorrectionCents(s, {
    tenantId: TENANT,
    deltaCents: GUTSCHRIFT_CENTS,
    chargeAnchors: ANKER_LAUFENDER_MONAT,
    nowIso: JULY_ISO,
  });
  return s;
}

test("P5 0-Boden Lebenszeit: die Ueber-Gutschrift kappt auf 0 und sperrt den Tenant NICHT", () => {
  const s = stateAfterOverCredit();
  setTenantBudget(s, TENANT, { budgetCents: TENANT_CAP_CENTS, hardCapCents: TENANT_CAP_CENTS });

  let gesperrt;
  const lines = captureErrLines(() => {
    gesperrt = budgetExceeded(s, TENANT, FLAG_OFF, JULY_ISO);
  });

  assert.equal(usageFor(s, TENANT).costCents, 0, "0-Boden: NIE negativ, obwohl 423 - 861 = -438");
  assert.equal(gesperrt, false, "eine Gutschrift darf den Kunden nicht aussperren");
  assert.deepEqual(lines, [], `kein ${USAGE_CORRUPT_REASON}-Log: der Bucket bleibt buchbar`);
});

test("P6 0-Boden Monats-Achse: der negative Zaehler wird auf 0 projiziert und weitet die Plattform-Summe nicht auf", () => {
  const s = stateAfterOverCredit();
  s.usage[NACHBAR_TENANT] = { ...emptyUsage(), spendMonthKey: MONTH_JULY, spendMonthCostCents: NACHBAR_MONATS_CENTS };

  const usage = usageFor(s, TENANT);
  assert.equal(
    usage.spendMonthCostCents,
    MONATS_ANTEIL_CENTS - LEBENSZEIT_CENTS,
    "gespeichert negativ: der 0-Boden kappt den Betrag, die Monatszahl bekommt den gekappten Rest",
  );
  assert.equal(spendMonthUsageCents(usage, JULY_ISO), 0, "die Leseprojektion zeigt kein Guthaben");
  assert.equal(
    gatePlatformUsageCents(s, FLAG_ON, JULY_ISO),
    NACHBAR_MONATS_CENTS,
    "ein negativer Monatsverbrauch darf die Decke fuer ALLE Tenants nicht aufweiten",
  );
});

// ---- P7: die Anker-Kette von der Buchung bis zur Gutschrift ----

test("P7 Anker-Kette: die Buchung stempelt die Anker, der Abgleichlauf gibt genau auf diesen Achsen zurueck", async () => {
  const nowMs = Date.parse(JULY_ISO);
  const s = makeDefaultState();
  const call = makeDueOutboundCall(s, { nowMs }); // 1-Minuten-Call auf dem Bootstrap-Tenant
  stampBudgetPeriod(s, BOOTSTRAP_TENANT_ID, PERIOD_JULY);

  // Schreibseite: Bucket-Brigade in reconcileVoiceBudget.
  makeMetering({ store: meteringStoreOn(s, JULY_ISO) }).reconcileVoiceBudget(call);

  const bucket = usageFor(s, BOOTSTRAP_TENANT_ID);
  const gebucht = callTariffCentsPerMin(call); // 1 Minute x Leg-Tarif
  assert.equal(call.estimatedCostCents, gebucht);
  assert.equal(call.estimatedCostSpendMonthKey, bucket.spendMonthKey, "Anker = der Monatsstempel NACH der Buchung");
  assert.equal(call.estimatedCostPeriodKey, bucket.budgetPeriodKey, "Anker = der Perioden-Stempel NACH der Buchung");
  assert.equal(bucket.spendMonthCostCents, gebucht);

  // Leseseite: der ECHTE Sweep (cost-truing.bookCorrectionFor) reicht chargeAnchorsOfCall
  // durch. Ist-Kosten 0 bei nachgewiesener Vollstaendigkeit -> volle Rueckerstattung.
  const { runCostTruingSweep } = makeCostTruing({
    store: makeStubStore(s, { nowMs }),
    config: fakeConfig({ costTruingRequiredRecordTypes: PFLICHT_RECORD_TYPES }),
    voiceControl: () => nullCostControl(),
    audit: () => {},
    now: () => nowMs,
  });
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(bucket.costCents, 0, "die Lebenszeit-Achse sinkt immer");
  assert.equal(
    bucket.spendMonthCostCents,
    0,
    "OHNE die durchgereichten Anker bliebe die Monatszahl auf dem vollen Schaetzbetrag stehen",
  );
  assert.equal(
    bucket.budgetPeriodBaselineCents,
    0,
    "die Belastung gehoert ins laufende Fenster - keine Baseline-Kompensation",
  );
});

// ---- P8: der Monatsgrenzen-Fall ----

test("P8 Monatsgrenze: der Anker ist der Monat der BUCHUNG, nicht der von call.startedAt", () => {
  const s = makeDefaultState();
  const call = createCall(s, { direction: "outbound", from: "+4930111", to: "+4930222", tenantId: TENANT });
  call.startedAt = JULI_LETZTE_MINUTE_ISO;
  call.answeredAt = JULI_LETZTE_MINUTE_ISO;
  call.endedAt = AUGUST_ENDE_ISO;

  makeMetering({ store: meteringStoreOn(s, AUGUST_BUCHUNG_ISO) }).reconcileVoiceBudget(call);

  assert.equal(call.estimatedCostSpendMonthKey, MONTH_AUGUST, "gebucht wurde im August, obwohl der Call im Juli begann");
  const gebucht = call.estimatedCostCents;

  bookCostCorrectionCents(s, {
    tenantId: TENANT,
    deltaCents: -AUGUST_GUTSCHRIFT_CENTS,
    chargeAnchors: chargeAnchorsOfCall(call),
    nowIso: AUGUST_BUCHUNG_ISO,
  });

  assert.equal(
    usageFor(s, TENANT).spendMonthCostCents,
    gebucht - AUGUST_GUTSCHRIFT_CENTS,
    "die August-Gutschrift wirkt auf der August-Zahl, in der die Belastung wirklich steht",
  );
});
