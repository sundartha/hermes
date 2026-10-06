import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMetering } from "../src/billing/metering.js";
import { config } from "../src/config.js";
import { NUMBER_STATUS, USAGE_EVENT_KIND, emptyUsage } from "../src/store/defaults.js";
import { makeDefaultState, recordUsageEvent } from "../src/store/state-ops.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { DOMESTIC_TEST_NUMBER } from "./helpers.js";

const TENANT_A = "tenant_a";
const MONTHLY_RENT_CENTS = 92;
const MONTHLY_RENT_CENTS_B = 137;
const BUCKET_SPEND_MONTH_KEY = "2026-01";
const BUCKET_PERIOD_KEY = "2026-01-01T00:00:00.000Z";

function fakeStore() {
  const usageEvents = [];
  const voiceCostCents = [];
  const estimatedCostCents = [];
  return {
    usageEvents,
    voiceCostCents,
    estimatedCostCents,
    recordUsageEvent(ev) {
      usageEvents.push(ev);
    },
    addVoiceUsageCostCents(tenantId, costCents) {
      voiceCostCents.push({ tenantId, costCents });
      return { ...emptyUsage(), spendMonthKey: BUCKET_SPEND_MONTH_KEY, budgetPeriodKey: BUCKET_PERIOD_KEY };
    },
    recordCallEstimatedCostCents(callId, input) {
      estimatedCostCents.push({ callId, ...input });
    },
  };
}

function makeCall(overrides = {}) {
  return {
    id: "call_1",
    tenantId: TENANT_A,
    to: "+491701234567",
    from: DOMESTIC_TEST_NUMBER.e164,
    direction: "outbound",
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

test("voiceMinutesOf: nie beantwortet (answeredAt ODER endedAt fehlt) -> 0", () => {
  const { voiceMinutesOf } = makeMetering({ store: fakeStore() });
  assert.equal(voiceMinutesOf(makeCall({ answeredAt: null })), 0);
  assert.equal(voiceMinutesOf(makeCall({ endedAt: null })), 0);
});

test("voiceMinutesOf: answeredAt == endedAt -> 0", () => {
  const { voiceMinutesOf } = makeMetering({ store: fakeStore() });
  const t = "2026-01-01T00:00:00.000Z";
  assert.equal(voiceMinutesOf(makeCall({ answeredAt: t, endedAt: t })), 0);
});

test("voiceMinutesOf: ceil-Rand (60001 ms Differenz -> 2 Minuten)", () => {
  const { voiceMinutesOf } = makeMetering({ store: fakeStore() });
  const call = makeCall({
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.001Z",
  });
  assert.equal(voiceMinutesOf(call), 2);
});

test("recordVoiceMinuteMeter: 0 Minuten -> kein Event", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store });
  recordVoiceMinuteMeter(makeCall({ answeredAt: null }));
  assert.equal(store.usageEvents.length, 0);
});

test("recordVoiceMinuteMeter: N Minuten -> Event mit kind/quantity/costCents aus tariffCentsPerMin", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store });
  const call = makeCall();
  recordVoiceMinuteMeter(call);
  assert.equal(store.usageEvents.length, 1);
  const [ev] = store.usageEvents;
  assert.equal(ev.tenantId, TENANT_A);
  assert.equal(ev.callId, call.id);
  assert.equal(ev.kind, USAGE_EVENT_KIND.VOICE_MINUTE);
  assert.equal(ev.quantity, 1);
  assert.equal(ev.costCents, 1 * tariffCentsPerMin(call.to, call.from));
});

test("reconcileVoiceBudget: inbound -> addVoiceUsageCostCents mit dem Inbound-Satz", () => {
  const store = fakeStore();
  const { reconcileVoiceBudget } = makeMetering({ store });
  const call = makeCall({ direction: "inbound" });
  reconcileVoiceBudget(call);
  assert.equal(store.voiceCostCents.length, 1);
  assert.deepEqual(store.voiceCostCents[0], {
    tenantId: TENANT_A,
    costCents: 1 * config.billing.voiceTariffInboundCents,
  });
});

test("reconcileVoiceBudget: outbound, 0 Minuten -> keiner", () => {
  const store = fakeStore();
  const { reconcileVoiceBudget } = makeMetering({ store });
  reconcileVoiceBudget(makeCall({ answeredAt: null }));
  assert.equal(store.voiceCostCents.length, 0);
});

test("reconcileVoiceBudget: outbound, N Minuten -> addVoiceUsageCostCents(tenantId, N*tarif)", () => {
  const store = fakeStore();
  const { reconcileVoiceBudget } = makeMetering({ store });
  const call = makeCall();
  reconcileVoiceBudget(call);
  assert.equal(store.voiceCostCents.length, 1);
  assert.deepEqual(store.voiceCostCents[0], {
    tenantId: TENANT_A,
    costCents: 1 * tariffCentsPerMin(call.to, call.from),
  });
  assert.deepEqual(store.estimatedCostCents[0], {
    callId: call.id,
    costCents: 1 * tariffCentsPerMin(call.to, call.from),
    chargeAnchors: { spendMonthKey: BUCKET_SPEND_MONTH_KEY, periodKey: BUCKET_PERIOD_KEY },
  });
});

function makeNumber({ id = "num_1", tenantId = TENANT_A, monthlyCostCents } = {}) {
  return {
    id,
    tenantId,
    country: "DE",
    status: NUMBER_STATUS.ACTIVE,
    ...(monthlyCostCents === undefined ? {} : { monthlyCostCents }),
  };
}

const MONATE = Object.freeze([
  "2026-01-15T09:00:00.000Z",
  "2026-02-15T09:00:00.000Z",
  "2026-03-15T09:00:00.000Z",
]);
const [ERSTER_MONAT] = MONATE;

function stateWithNumbers(numbers) {
  const s = makeDefaultState();
  s.numbers = numbers;
  return { s, store: { recordUsageEvent: (ev) => recordUsageEvent(s, ev) } };
}

function numberMonthBelege(s) {
  return s.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.NUMBER_MONTH);
}

test("recordNumberMonthMeter: undefined (uebersprungener Job) -> kein Event", () => {
  const store = fakeStore();
  const { recordNumberMonthMeter } = makeMetering({ store });
  recordNumberMonthMeter(undefined, ERSTER_MONAT);
  assert.equal(store.usageEvents.length, 0);
});

test("recordNumberMonthMeter: Number -> Event mit kind/quantity/costCents aus number.monthlyCostCents", () => {
  const store = fakeStore();
  const { recordNumberMonthMeter } = makeMetering({ store });
  const number = makeNumber({ monthlyCostCents: MONTHLY_RENT_CENTS });
  recordNumberMonthMeter(number, ERSTER_MONAT);
  assert.equal(store.usageEvents.length, 1);
  const [ev] = store.usageEvents;
  assert.equal(ev.tenantId, TENANT_A);
  assert.equal(ev.numberId, number.id, "der Beleg identifiziert die Nummer (Idempotenz-Anker)");
  assert.equal(ev.kind, USAGE_EVENT_KIND.NUMBER_MONTH);
  assert.equal(ev.quantity, 1);
  assert.equal(ev.costCents, MONTHLY_RENT_CENTS, "die gelernte Miete, NICHT die Einrichtungsgebuehr");
  assert.equal(ev.occurredAt, ERSTER_MONAT, "gestempelt wird die Uhr der Faelligkeits-Pruefung");
});

test("recordNumberMonthMeter: ohne gelernten Preis -> kein Event (fail-closed)", () => {
  const store = fakeStore();
  const { recordNumberMonthMeter } = makeMetering({ store });
  recordNumberMonthMeter(makeNumber(), ERSTER_MONAT);
  assert.equal(
    store.usageEvents.length,
    0,
    "die Einrichtungsgebuehr ist ausdruecklich kein Miet-Fallback",
  );
});

test("GAP-06: der wiederkehrende Ausloeser bucht ueber drei Kalendermonate genau drei Belege (einen je Monat)", () => {
  const { s, store } = stateWithNumbers([makeNumber({ monthlyCostCents: MONTHLY_RENT_CENTS })]);
  const { recordDueNumberMonthMeters } = makeMetering({ store });

  for (const nowIso of MONATE) recordDueNumberMonthMeters(s, { nowIso });

  const belege = numberMonthBelege(s);
  assert.equal(belege.length, MONATE.length, "ein Beleg je Kalendermonat");
  assert.deepEqual(
    belege.map((e) => e.occurredAt.slice(0, "YYYY-MM".length)),
    MONATE.map((iso) => iso.slice(0, "YYYY-MM".length)),
    "je Monat genau einer, in der Reihenfolge der Monate",
  );
  for (const beleg of belege) {
    assert.equal(beleg.numberId, "num_1");
    assert.equal(beleg.costCents, MONTHLY_RENT_CENTS);
  }
});

test("GAP-06: derselbe Ausloeser zweimal im selben Monat -> ein Beleg, nicht zwei", () => {
  const { s, store } = stateWithNumbers([makeNumber({ monthlyCostCents: MONTHLY_RENT_CENTS })]);
  const { recordDueNumberMonthMeters } = makeMetering({ store });

  recordDueNumberMonthMeters(s, { nowIso: ERSTER_MONAT });
  recordDueNumberMonthMeters(s, { nowIso: ERSTER_MONAT });
  recordDueNumberMonthMeters(s, { nowIso: "2026-01-28T23:59:59.000Z" });

  assert.equal(numberMonthBelege(s).length, 1);
});

test("GAP-06: der zweite Ausloeser bucht den vom ersten bereits gebuchten Monat nicht nach", () => {
  const number = makeNumber({ monthlyCostCents: MONTHLY_RENT_CENTS });
  const { s, store } = stateWithNumbers([number]);
  const { recordNumberMonthMeter, recordDueNumberMonthMeters } = makeMetering({ store });

  recordNumberMonthMeter(number, ERSTER_MONAT);
  const bilanz = recordDueNumberMonthMeters(s, { nowIso: ERSTER_MONAT });

  assert.equal(bilanz.faellig, 0, "die Nummer ist in diesem Monat nicht mehr faellig");
  assert.equal(numberMonthBelege(s).length, 1, "beide Ausloeser zusammen -> genau EIN Beleg");
});

test("zwei aktive Nummern, eine ohne gelernten Preis: die andere wird NIE doppelt gebucht", () => {
  const { s, store } = stateWithNumbers([
    makeNumber({ id: "num_a" }),
    makeNumber({ id: "num_b", monthlyCostCents: MONTHLY_RENT_CENTS_B }),
  ]);
  const { recordDueNumberMonthMeters } = makeMetering({ store });

  recordDueNumberMonthMeters(s, { nowIso: ERSTER_MONAT });
  const bilanz = recordDueNumberMonthMeters(s, { nowIso: ERSTER_MONAT });

  const belege = numberMonthBelege(s);
  assert.equal(belege.length, 1, "genau ein Beleg insgesamt");
  assert.equal(belege[0].numberId, "num_b");
  assert.equal(belege[0].costCents, MONTHLY_RENT_CENTS_B);
  assert.equal(bilanz.ohnePreis, 1, "die preislose Nummer bleibt faellig und wird sichtbar gezaehlt");
});

test("ein Fehler an EINER Nummer beendet den Lauf nicht", () => {
  const { s, store } = stateWithNumbers([
    makeNumber({ id: "num_a", monthlyCostCents: MONTHLY_RENT_CENTS }),
    makeNumber({ id: "num_b", monthlyCostCents: MONTHLY_RENT_CENTS_B }),
  ]);
  const echtesRecord = store.recordUsageEvent;
  store.recordUsageEvent = (ev) => {
    if (ev.numberId === "num_a") throw new Error("Ledger-Schreibung fehlgeschlagen");
    return echtesRecord(ev);
  };
  const { recordDueNumberMonthMeters } = makeMetering({ store });

  const bilanz = recordDueNumberMonthMeters(s, { nowIso: ERSTER_MONAT });

  assert.equal(bilanz.fehler, 1);
  assert.equal(bilanz.gebucht, 1, "die zweite Nummer wurde trotzdem gebucht");
  assert.deepEqual(
    numberMonthBelege(s).map((e) => e.numberId),
    ["num_b"],
  );
});

test("eine freigegebene Nummer erzeugt keine Miete mehr", () => {
  const released = makeNumber({ monthlyCostCents: MONTHLY_RENT_CENTS });
  released.status = NUMBER_STATUS.RELEASED;
  const { s, store } = stateWithNumbers([released]);
  const { recordDueNumberMonthMeters } = makeMetering({ store });

  const bilanz = recordDueNumberMonthMeters(s, { nowIso: ERSTER_MONAT });

  assert.equal(bilanz.faellig, 0);
  assert.equal(numberMonthBelege(s).length, 0);
});

test("Modul bucht ungated: ohne jedes config-Gate im Modul (Gate liegt beim Aufrufer)", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter, reconcileVoiceBudget, recordNumberMonthMeter } =
    makeMetering({ store });
  const call = makeCall();
  recordVoiceMinuteMeter(call);
  reconcileVoiceBudget(call);
  recordNumberMonthMeter(makeNumber({ monthlyCostCents: MONTHLY_RENT_CENTS }), ERSTER_MONAT);
  assert.equal(store.usageEvents.length, 2, "Voice-Minute- + Number-Month-Event trotz paymentEnabled=false");
  assert.equal(store.voiceCostCents.length, 1, "Reconcile bucht trotz paymentEnabled=false");
});
