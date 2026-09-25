// IEL-B2 (E3): Minutensatz je Kostenprofil. Ein Inbound-Bein, dessen Gespraech der
// ElevenLabs-Agent fuehrt (Kostenprofil telnyx_inbound_el_convai), zahlt den Leg-Satz wie
// Outbound-EL fuer dasselbe Nummernpaar; jedes andere Inbound-Bein bleibt beim
// kalibrierten Inbound-Satz.
//
// Offline, ohne Spawn, ohne DB, ohne Netz (P12). Die Tarif-Env wird VOR dem ersten
// config.js-Import gesetzt, danach werden die config-lesenden Module dynamisch importiert -
// sonst entschiede eine lokale .env ueber den Minutensatz (Lehre test-base-env-drift).
//
// Testnamen beginnen mit "IEL-B2-" - das trifft weder i18nCatalogPattern noch
// abnahmePattern, die Faelle laufen also im Regressionslauf (npm test).
//
// Manuelle Mutationsproben (Muster kv-p2-inbound-budget.test.js):
//   (a) EL-Zweig in billsCalibratedInboundRate entfernen -> IEL-B2-3, -4, -6, -7, -8, -9
//       rot (7 statt 23 bzw. 37).
//   (b) Richtungspruefung im Praedikat entfernen -> IEL-B2-5 und -6 rot (Outbound zahlt
//       den Inbound-Satz).
//   (c) tariffCentsPerMin(call.from, call.to) vertauschen -> bleibt gruen, weil der Satz
//       symmetrisch ist. Gewollt; IEL-B2-6 belegt es am gemischten Nummernpaar.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { KOSTENPROFIL } from "../src/billing/kostenarten.js"; // importfrei, friert keine Config ein

// Bewusst ungleich den echten Defaults 20/30/6: ein Leck aus .env oder Defaults faellt an
// der ZAHL auf.
const DOMESTIC_CENTS = 23;
const DEFAULT_CENTS = 37;
const INBOUND_CENTS = 7;
const MS_PER_MINUTE = 60_000;
// 90 s liegen sicher in der zweiten angefangenen Minute (Muster ks-p2).
const TWO_MINUTE_LEG_MS = 90_000;
const BILLED_MINUTES = 2;
const ANSWERED_AT = "2026-09-14T10:00:00.000Z";
const ENDED_AT = new Date(Date.parse(ANSWERED_AT) + BILLED_MINUTES * MS_PER_MINUTE).toISOString();
const DE_OWN_DID = "+4930000011880";
const DE_CALLER = "+4915112345678";
const US_CALLER = "+12025550123";
const US_OWN_DID = "+15005550006";
const UNKNOWN_CALLER = "unbekannt"; // Bestands-Platzhalter aus /voice/incoming
const TENANT = "tenant_iel_b2";

let callTariffCentsPerMin, liveVoiceSpendCents, makeMetering, emptyUsage, config;

before(async () => {
  process.env.VOICE_TARIFF_DOMESTIC_CENTS = String(DOMESTIC_CENTS);
  process.env.VOICE_TARIFF_DEFAULT_CENTS = String(DEFAULT_CENTS);
  process.env.VOICE_TARIFF_INBOUND_CENTS = String(INBOUND_CENTS);
  ({ config } = await import("../src/config.js"));
  ({ callTariffCentsPerMin, liveVoiceSpendCents, makeMetering } = await import("../src/billing/metering.js"));
  ({ emptyUsage } = await import("../src/store/defaults.js"));
});

function inboundLeg(costProfile, overrides) {
  return {
    id: "call_iel_b2",
    tenantId: TENANT,
    direction: "inbound",
    costProfile,
    to: DE_OWN_DID,
    from: DE_CALLER,
    ...overrides,
  };
}

function elInboundLeg(overrides = {}) {
  return inboundLeg(KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, overrides);
}

function budgetInboundLeg(overrides = {}) {
  return inboundLeg(KOSTENPROFIL.TELNYX_INBOUND_BUDGET, overrides);
}

function outboundLeg(overrides = {}) {
  return { id: "call_iel_b2_out", tenantId: TENANT, direction: "outbound", ...overrides };
}

function runningLeg(leg) {
  const anchor = new Date(Date.now() - TWO_MINUTE_LEG_MS).toISOString();
  return { ...leg, status: "active", startedAt: anchor, answeredAt: anchor };
}

function endedLeg(leg) {
  return { ...leg, answeredAt: ANSWERED_AT, endedAt: ENDED_AT };
}

// Faengt die Geld-Nebeneffekte von reconcileVoiceBudget auf, ohne Store (Muster
// cost-origin-axis). recordUsageEvent fehlt bewusst: reconcileVoiceBudget ruft es nicht.
function fakeMeteringStore() {
  const voiceCostCents = [];
  const estimatedCostCents = [];
  return {
    voiceCostCents,
    estimatedCostCents,
    addVoiceUsageCostCents(tenantId, costCents) {
      voiceCostCents.push({ tenantId, costCents });
      return emptyUsage();
    },
    recordCallEstimatedCostCents(callId, { costCents }) {
      estimatedCostCents.push({ callId, costCents });
    },
  };
}

function reconcile(leg) {
  const store = fakeMeteringStore();
  makeMetering({ store }).reconcileVoiceBudget(leg);
  return store;
}

test("IEL-B2-0: Positiv-Kontrolle - die drei Saetze sind gesetzt und paarweise verschieden", () => {
  const { voiceTariffDomesticCents, voiceTariffDefaultCents, voiceTariffInboundCents } = config.billing;
  const configuredRates = [voiceTariffDomesticCents, voiceTariffDefaultCents, voiceTariffInboundCents];
  assert.deepEqual(configuredRates, [DOMESTIC_CENTS, DEFAULT_CENTS, INBOUND_CENTS]);
  assert.equal(new Set(configuredRates).size, configuredRates.length);
});

test("IEL-B2-1: inbound ohne Profil zahlt den kalibrierten Inbound-Satz", () => {
  const withoutProfile = { direction: "inbound", to: DE_OWN_DID, from: DE_CALLER };
  const hydratedNullProfile = { ...withoutProfile, costProfile: null }; // pg-Hydrierung
  assert.equal(callTariffCentsPerMin(withoutProfile), INBOUND_CENTS);
  assert.equal(callTariffCentsPerMin(hydratedNullProfile), INBOUND_CENTS);
});

test("IEL-B2-2: inbound mit Budget-Profil zahlt den kalibrierten Inbound-Satz", () => {
  assert.equal(callTariffCentsPerMin(budgetInboundLeg()), INBOUND_CENTS);
});

test("IEL-B2-3: inbound mit EL-Profil, Inland/Inland, zahlt den Inlandssatz", () => {
  assert.equal(callTariffCentsPerMin(elInboundLeg()), DOMESTIC_CENTS);
});

test("IEL-B2-4: inbound mit EL-Profil, Gegenstelle nicht Inland, zahlt den Default-Satz", () => {
  assert.equal(callTariffCentsPerMin(elInboundLeg({ from: US_CALLER })), DEFAULT_CENTS);
  assert.equal(callTariffCentsPerMin(elInboundLeg({ from: UNKNOWN_CALLER })), DEFAULT_CENTS);
  assert.equal(callTariffCentsPerMin(elInboundLeg({ to: US_OWN_DID, from: US_CALLER })), DEFAULT_CENTS);
});

test("IEL-B2-5: outbound bleibt beim Leg-Satz, unabhaengig vom Profil", () => {
  const domestic = { to: DE_CALLER, from: DE_OWN_DID };
  assert.equal(callTariffCentsPerMin(outboundLeg(domestic)), DOMESTIC_CENTS);
  assert.equal(
    callTariffCentsPerMin(outboundLeg({ ...domestic, costProfile: KOSTENPROFIL.EL_CONVAI_SIP })),
    DOMESTIC_CENTS,
  );
  assert.equal(
    callTariffCentsPerMin(outboundLeg({ ...domestic, costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI })),
    DOMESTIC_CENTS,
  );
  assert.equal(callTariffCentsPerMin(outboundLeg({ to: US_CALLER, from: DE_OWN_DID })), DEFAULT_CENTS);
});

test("IEL-B2-6: EL-Inbound und Outbound-EL zahlen fuer dasselbe Nummernpaar denselben Satz", () => {
  const elOutbound = (to, from) => outboundLeg({ costProfile: KOSTENPROFIL.EL_CONVAI_SIP, to, from });
  assert.equal(
    callTariffCentsPerMin(elInboundLeg({ to: DE_OWN_DID, from: US_CALLER })),
    callTariffCentsPerMin(elOutbound(US_CALLER, DE_OWN_DID)),
  );
  assert.equal(
    callTariffCentsPerMin(elInboundLeg({ to: DE_OWN_DID, from: DE_CALLER })),
    callTariffCentsPerMin(elOutbound(DE_CALLER, DE_OWN_DID)),
  );
});

test("IEL-B2-7: Live-Term rechnet ein laufendes EL-Inbound-Bein zum Leg-Satz", () => {
  const spend = liveVoiceSpendCents([runningLeg(elInboundLeg())], Date.now());
  assert.equal(spend, BILLED_MINUTES * DOMESTIC_CENTS);
});

test("IEL-B2-8: Live-Term summiert je Bein seinen eigenen Satz", () => {
  const legs = [runningLeg(budgetInboundLeg({ id: "a" })), runningLeg(elInboundLeg({ id: "b" }))];
  assert.equal(liveVoiceSpendCents(legs, Date.now()), BILLED_MINUTES * (INBOUND_CENTS + DOMESTIC_CENTS));
});

test("IEL-B2-9: reconcileVoiceBudget bucht ein beendetes EL-Inbound-Bein zum Leg-Satz", () => {
  const store = reconcile(endedLeg(elInboundLeg()));
  const expectedCents = BILLED_MINUTES * DOMESTIC_CENTS;
  assert.deepEqual(store.voiceCostCents.map((entry) => entry.costCents), [expectedCents]);
  assert.deepEqual(store.estimatedCostCents.map((entry) => entry.costCents), [expectedCents]);
});

test("IEL-B2-10: reconcileVoiceBudget bucht ein beendetes Budget-Inbound-Bein unveraendert", () => {
  const store = reconcile(endedLeg(budgetInboundLeg()));
  const expectedCents = BILLED_MINUTES * INBOUND_CENTS;
  assert.deepEqual(store.voiceCostCents.map((entry) => entry.costCents), [expectedCents]);
  assert.deepEqual(store.estimatedCostCents.map((entry) => entry.costCents), [expectedCents]);
});
