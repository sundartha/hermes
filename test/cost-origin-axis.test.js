import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { makeOutboundGates, tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { callTariffCentsPerMin, makeMetering } from "../src/billing/metering.js";
import { RESERVE_LEAD_MINUTES, USAGE_EVENT_KIND, emptyUsage } from "../src/store/defaults.js";

const TENANT_A = "t_origin";
const DE_OWN_DID = "+4930111222333";
const US_OWN_DID = "+15005550006";
const DE_TARGET = "+4915112345678";
const US_TARGET = "+15551234567";
const FR_TARGET = "+33612345678";
const TOLL_FREE_TARGET = "+18005550123";

function fakeStore() {
  const usageEvents = [];
  const voiceCostCents = [];
  return {
    usageEvents,
    voiceCostCents,
    recordUsageEvent(ev) {
      usageEvents.push(ev);
    },
    addVoiceUsageCostCents(tenantId, costCents) {
      voiceCostCents.push({ tenantId, costCents });
      return emptyUsage();
    },
    recordCallEstimatedCostCents() {},
    tenantBudgetSnapshot: () => ({ capCents: 100000, spentCents: 0, remainingCents: 100000 }),
  };
}

function makeCall(overrides = {}) {
  return {
    id: "call_origin",
    tenantId: TENANT_A,
    direction: "outbound",
    to: DE_TARGET,
    from: US_OWN_DID,
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

const voiceCostOf = (store) =>
  store.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.VOICE_MINUTE).map((e) => e.costCents);

test("Vorbedingung: Inlandssatz und Default-Satz sind verschieden", () => {
  assert.notEqual(
    config.billing.voiceTariffDomesticCents,
    config.billing.voiceTariffDefaultCents,
    "ohne Unterschied zwischen den beiden Saetzen ist jede Tarif-Assertion inhaltsleer",
  );
  assert.ok(
    config.billing.voiceTariffDomesticPrefixes.includes("+49"),
    "die Fixture-Nummern setzen +49 als bekannte Inlands-Vorwahl voraus",
  );
});

test("Herkunfts-Achse (ORIG-01): tariffCentsPerMin nimmt Ziel UND Herkunft entgegen", () => {
  assert.equal(
    tariffCentsPerMin.length,
    2,
    "zwei Positionsstellen (Ziel, Herkunft) - ein Objekt-Parameter haette length === 1",
  );
});

test("Inland nur bei GLEICHER bekannter Inlands-Vorwahl an beiden Enden", () => {
  const domestic = config.billing.voiceTariffDomesticCents;
  const abroad = config.billing.voiceTariffDefaultCents;
  assert.equal(tariffCentsPerMin(DE_TARGET, DE_OWN_DID), domestic, "+49 -> +49 ist Inland");
  assert.equal(tariffCentsPerMin(DE_TARGET, US_OWN_DID), abroad, "+1 -> +49 ist Ausland");
  assert.equal(tariffCentsPerMin(US_TARGET, DE_OWN_DID), abroad, "+49 -> +1 ist Ausland");
  assert.equal(
    tariffCentsPerMin(FR_TARGET, DE_OWN_DID),
    abroad,
    "zwei VERSCHIEDENE bekannte Inlands-Vorwahlen sind kein Inlands-Leg",
  );
  assert.equal(
    tariffCentsPerMin(US_TARGET, US_OWN_DID),
    abroad,
    "gleiches Land OHNE gemessenen Inlandssatz (+1) bleibt Ausland - der guenstige Satz ist " +
      "fuer +49/+33/+44 erhoben, nicht fuer 'irgendwo gleich'",
  );
});

test("fail-closed: fehlende/unbrauchbare Herkunft -> teuerster Satz", () => {
  const abroad = config.billing.voiceTariffDefaultCents;
  assert.equal(tariffCentsPerMin(DE_TARGET, undefined), abroad);
  assert.equal(tariffCentsPerMin(DE_TARGET, null), abroad);
  assert.equal(
    tariffCentsPerMin(DE_TARGET),
    abroad,
    "vergessenes Argument ergibt nie den Inlandssatz",
  );
});

test("OUT-12 (Charakterisierung, gruen) - Toll-Free-Ziele werden zum Worst-Case-Tarif gerechnet, wie jedes andere +1-Ziel", () => {
  const abroad = config.billing.voiceTariffDefaultCents;
  assert.equal(tariffCentsPerMin(TOLL_FREE_TARGET, DE_OWN_DID), abroad);
  assert.equal(tariffCentsPerMin(TOLL_FREE_TARGET, US_OWN_DID), abroad);
  assert.equal(
    tariffCentsPerMin(TOLL_FREE_TARGET, US_OWN_DID),
    tariffCentsPerMin(US_TARGET, US_OWN_DID),
    "keine Toll-Free-Sonderbehandlung gegenueber einer gewoehnlichen US-Nummer",
  );
});

test("PAY-22: leere/unbekannte Zielvorwahl faellt auf den teuren Default-Tarif", () => {
  const abroad = config.billing.voiceTariffDefaultCents;
  assert.equal(tariffCentsPerMin("", DE_OWN_DID), abroad, "leeres Ziel");
  assert.equal(tariffCentsPerMin("+999", DE_OWN_DID), abroad, "erfundene Vorwahl");
  assert.equal(tariffCentsPerMin(undefined, DE_OWN_DID), abroad, "fehlendes Ziel");
});

test("Herkunfts-Achse (ORIG-02): DE-Ziel von einer US-DID bucht den Auslandssatz", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store, config });
  recordVoiceMinuteMeter(makeCall({ to: DE_TARGET, from: US_OWN_DID }));
  assert.deepEqual(voiceCostOf(store), [config.billing.voiceTariffDefaultCents]);
});

test("DE-Ziel von einer DE-DID bucht den Inlandssatz", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store, config });
  recordVoiceMinuteMeter(makeCall({ to: DE_TARGET, from: DE_OWN_DID }));
  assert.deepEqual(voiceCostOf(store), [config.billing.voiceTariffDomesticCents]);
});

test("Herkunfts-Achse (ORIG-03): Inbound bucht den kalibrierten Inbound-Satz - unabhaengig vom Land der eigenen DID", () => {
  const storeUs = fakeStore();
  makeMetering({ store: storeUs, config }).recordVoiceMinuteMeter(
    makeCall({ direction: "inbound", to: US_OWN_DID, from: DE_TARGET }),
  );
  assert.deepEqual(
    voiceCostOf(storeUs),
    [config.billing.voiceTariffInboundCents],
    "US-DID: kein Auslands-Worst-Case mehr fuer Inbound",
  );

  const storeDe = fakeStore();
  makeMetering({ store: storeDe, config }).recordVoiceMinuteMeter(
    makeCall({ direction: "inbound", to: DE_OWN_DID, from: US_TARGET }),
  );
  assert.deepEqual(
    voiceCostOf(storeDe),
    [config.billing.voiceTariffInboundCents],
    "DE-DID: derselbe Inbound-Satz, kein Inlandsrabatt mehr ueber die eigene DID",
  );
});

test("Reserve und Buchung rechnen dieselbe Konstellation mit demselben Satz", async () => {
  const store = fakeStore();
  const { gates } = makeOutboundGates({ store, config });
  const computeReserve = gates.find((g) => g.name === "compute_reserve");
  assert.ok(computeReserve, "compute_reserve-Gate existiert");

  const ctx = { b: {}, to: DE_TARGET, fromNumber: US_OWN_DID, tenantId: "t_origin" };
  await computeReserve.run(ctx);
  const reservedPerMinute = ctx.reserveCents / RESERVE_LEAD_MINUTES;

  const { reconcileVoiceBudget } = makeMetering({ store, config });
  reconcileVoiceBudget(makeCall({ to: DE_TARGET, from: US_OWN_DID }));
  const [booked] = store.voiceCostCents;

  assert.equal(
    reservedPerMinute,
    config.billing.voiceTariffDefaultCents,
    "die Reserve sieht die Herkunft",
  );
  assert.equal(
    booked.costCents,
    reservedPerMinute,
    "reserviert und gebucht wird derselbe Minutensatz",
  );
});

test("callTariffCentsPerMin: outbound tarifiert das Leg, inbound den kalibrierten Satz", () => {
  assert.equal(
    callTariffCentsPerMin({ direction: "outbound", to: DE_TARGET, from: DE_OWN_DID }),
    config.billing.voiceTariffDomesticCents,
    "outbound: die eigene DID steht in call.from, der Satz haengt am Leg",
  );
  assert.equal(
    callTariffCentsPerMin({ direction: "inbound", to: DE_OWN_DID, from: US_TARGET }),
    config.billing.voiceTariffInboundCents,
    "inbound: kein gewaehltes Ziel - der kalibrierte Inbound-Satz gilt, unabhaengig von to/from",
  );
});
