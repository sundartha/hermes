// Unit-Test fuer src/billing/metering.js (Server-Slim P1, reine Verschiebung aus server.js).
// Isoliert mit Fake-store (faengt recordUsageEvent/addVoiceUsageCostCents in Arrays) bzw. -
// fuer die wiederkehrende Monatsmiete - einem zustands-gestuetzten state-ops-Store; kein
// Server/DB/Netz (P12). Bestaetigt zugleich Spec-Risiko INV-9: das paymentEnabled-Gate
// sitzt NICHT im Modul - die Funktionen buchen ungated, das Gating ist Sache des Aufrufers
// (finishCall / Provisioning-Drain / Monatsmiete-Ausloeser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMetering } from "../src/billing/metering.js";
import { NUMBER_STATUS, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { makeDefaultState, recordUsageEvent } from "../src/store/state-ops.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { DOMESTIC_TEST_NUMBER } from "./helpers.js";

const TENANT_A = "tenant_a";
// Die beim Kauf gelernte Monatsmiete (P4) - seit P5 die EINZIGE Betrags-Quelle des
// number_month-Belegs. Zwei verschiedene Werte, damit eine Verwechslung zweier Nummern
// nicht zufaellig gruen laeuft.
const MONTHLY_RENT_CENTS = 92;
const MONTHLY_RENT_CENTS_B = 137;

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
    },
    // LCT P2: reconcileOutboundVoiceBudget persistiert den gebuchten Schaetzbetrag zusaetzlich
    // am Call (store.recordCallEstimatedCostCents). Ohne diesen Stub wuerfe der reale Aufruf
    // einen TypeError (echte Interface-Erweiterung, kein Testartefakt).
    recordCallEstimatedCostCents(callId, costCents) {
      estimatedCostCents.push({ callId, costCents });
    },
  };
}

// from = eine Inlands-DID: seit der Herkunfts-Achse (P5) haengt der Satz am LEG, und ein
// Fixture mit US-Absender + DE-Ziel wuerde beide Seiten der Assertion auf denselben
// Default-Satz ziehen (die Assertion waere gruen, aber inhaltsleer).
function makeCall(overrides = {}) {
  return {
    id: "call_1",
    tenantId: TENANT_A,
    to: "+491701234567",
    from: DOMESTIC_TEST_NUMBER.e164,
    direction: "outbound",
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z", // 60000 ms = 1 Minute
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

// PAY-08 (Buchhaltung, kein eigener Test): "ein Inbound-Anruf zieht das Tenant-Budget nie
// ab" ist woertlich die Aussage des Tests darunter (Beleg: `if (call.direction !==
// "outbound") return;` als erste Zeile von reconcileOutboundVoiceBudget in
// src/billing/metering.js). Ein zweiter Test waere ein Duplikat (G5); die Katalog-ID steht
// deshalb hier und nicht im Testnamen - der Test bleibt damit im Regressionslauf.
test("reconcileOutboundVoiceBudget: inbound -> kein addVoiceUsageCostCents", () => {
  const store = fakeStore();
  const { reconcileOutboundVoiceBudget } = makeMetering({ store });
  reconcileOutboundVoiceBudget(makeCall({ direction: "inbound" }));
  assert.equal(store.voiceCostCents.length, 0);
});

test("reconcileOutboundVoiceBudget: outbound, 0 Minuten -> keiner", () => {
  const store = fakeStore();
  const { reconcileOutboundVoiceBudget } = makeMetering({ store });
  reconcileOutboundVoiceBudget(makeCall({ answeredAt: null }));
  assert.equal(store.voiceCostCents.length, 0);
});

test("reconcileOutboundVoiceBudget: outbound, N Minuten -> addVoiceUsageCostCents(tenantId, N*tarif)", () => {
  const store = fakeStore();
  const { reconcileOutboundVoiceBudget } = makeMetering({ store });
  const call = makeCall();
  reconcileOutboundVoiceBudget(call);
  assert.equal(store.voiceCostCents.length, 1);
  assert.deepEqual(store.voiceCostCents[0], {
    tenantId: TENANT_A,
    costCents: 1 * tariffCentsPerMin(call.to, call.from),
  });
  // LCT P2 (E2): derselbe Betrag wird IM SELBEN Schritt am Call persistiert - nicht spaeter
  // aus dem Tarif rekonstruiert.
  assert.deepEqual(store.estimatedCostCents[0], {
    callId: call.id,
    costCents: 1 * tariffCentsPerMin(call.to, call.from),
  });
});

// Eine aktive Nummer, wie sie nach dem Kauf im Store steht (P4: monthlyCostCents nur bei
// gelerntem Provider-Preis - ohne Preis bleibt das Feld ABWESEND, nicht 0).
function makeNumber({ id = "num_1", tenantId = TENANT_A, monthlyCostCents } = {}) {
  return {
    id,
    tenantId,
    country: "DE",
    status: NUMBER_STATUS.ACTIVE,
    ...(monthlyCostCents === undefined ? {} : { monthlyCostCents }),
  };
}

// Drei aufeinanderfolgende UTC-Kalendermonate - die Uhr des wiederkehrenden Ausloesers.
const MONATE = Object.freeze([
  "2026-01-15T09:00:00.000Z",
  "2026-02-15T09:00:00.000Z",
  "2026-03-15T09:00:00.000Z",
]);
const [ERSTER_MONAT] = MONATE;

// Zustands-gestuetzter Store fuer die wiederkehrende Miete: recordUsageEvent schreibt in
// DENSELBEN State, den numbersDueForMonthMeter liest - sonst pruefte der Test einen
// Idempotenz-Riegel gegen ein Ledger, das er nie sieht. Die Nummern kommen als Fixture
// hinein; der Rest ist echter state-ops-Code (kein Nachbau der Buchungsregel).
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

// GAP-06 (neu gefasst, Spec-Nachtrag 2026-07-28): die DID-Monatsmiete muss WIEDERKEHREND
// gebucht werden UND je Nummer und Kalendermonat genau einmal. Beide Haelften stehen
// unter Test - eine allein waere eine Abschwaechung des Gates.

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
  recordDueNumberMonthMeters(s, { nowIso: "2026-01-28T23:59:59.000Z" }); // andere Stunde, selber Monat

  assert.equal(numberMonthBelege(s).length, 1);
});

test("GAP-06: der zweite Ausloeser bucht den vom ersten bereits gebuchten Monat nicht nach", () => {
  const number = makeNumber({ monthlyCostCents: MONTHLY_RENT_CENTS });
  const { s, store } = stateWithNumbers([number]);
  const { recordNumberMonthMeter, recordDueNumberMonthMeters } = makeMetering({ store });

  // Ausloeser 1: der Aktivierungs-Beleg des Provisioning-Drains.
  recordNumberMonthMeter(number, ERSTER_MONAT);
  // Ausloeser 2: Abo-Verlaengerung / stuendlicher Sweep im selben Monat.
  const bilanz = recordDueNumberMonthMeters(s, { nowIso: ERSTER_MONAT });

  assert.equal(bilanz.faellig, 0, "die Nummer ist in diesem Monat nicht mehr faellig");
  assert.equal(numberMonthBelege(s).length, 1, "beide Ausloeser zusammen -> genau EIN Beleg");
});

// Das vom Review hergeleitete Doppelbuchungs-Szenario der verworfenen Tenant-Zaehlung:
// A hat keinen gelernten Preis, B schon. Zaehlte der Riegel Belege je TENANT, absorbierte
// A im zweiten Lauf den Zaehler und B wuerde ein zweites Mal gebucht.
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

// INV-9 seit P5 strukturell: das Modul bekommt gar kein config mehr (die Miete kommt aus
// dem Nummern-Datensatz) - es KANN nicht auf paymentEnabled gaten. Die Funktionen buchen,
// wenn man sie ruft; gegated wird ausschliesslich beim Aufrufer.
test("Modul bucht ungated: ohne jedes config-Gate im Modul (Gate liegt beim Aufrufer)", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter, reconcileOutboundVoiceBudget, recordNumberMonthMeter } =
    makeMetering({ store });
  const call = makeCall();
  recordVoiceMinuteMeter(call);
  reconcileOutboundVoiceBudget(call);
  recordNumberMonthMeter(makeNumber({ monthlyCostCents: MONTHLY_RENT_CENTS }), ERSTER_MONAT);
  assert.equal(store.usageEvents.length, 2, "Voice-Minute- + Number-Month-Event trotz paymentEnabled=false");
  assert.equal(store.voiceCostCents.length, 1, "Reconcile bucht trotz paymentEnabled=false");
});
