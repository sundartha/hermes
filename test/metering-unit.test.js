// Unit-Test fuer src/billing/metering.js (Server-Slim P1, reine Verschiebung aus server.js).
// Isoliert mit Fake-store (faengt recordUsageEvent/addVoiceUsageCostCents in Arrays) + Fake-
// config, kein Server/DB/Netz (P12). Bestaetigt zugleich Spec-Risiko INV-9: die
// config.paymentEnabled-Gate sitzt NICHT im Modul - die Funktionen buchen ungated, das
// Gating ist Sache des Aufrufers (finishCall / Provisioning-Drain).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMetering } from "../src/billing/metering.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { holdAmountForCountry } from "../src/telephony/provisioning-geo.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { DOMESTIC_TEST_NUMBER } from "./helpers.js";

const TENANT_A = "tenant_a";
const NUMBER_SETUP_FEE_CENTS = 500;

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
  const { voiceMinutesOf } = makeMetering({ store: fakeStore(), config: {} });
  assert.equal(voiceMinutesOf(makeCall({ answeredAt: null })), 0);
  assert.equal(voiceMinutesOf(makeCall({ endedAt: null })), 0);
});

test("voiceMinutesOf: answeredAt == endedAt -> 0", () => {
  const { voiceMinutesOf } = makeMetering({ store: fakeStore(), config: {} });
  const t = "2026-01-01T00:00:00.000Z";
  assert.equal(voiceMinutesOf(makeCall({ answeredAt: t, endedAt: t })), 0);
});

test("voiceMinutesOf: ceil-Rand (60001 ms Differenz -> 2 Minuten)", () => {
  const { voiceMinutesOf } = makeMetering({ store: fakeStore(), config: {} });
  const call = makeCall({
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.001Z",
  });
  assert.equal(voiceMinutesOf(call), 2);
});

test("recordVoiceMinuteMeter: 0 Minuten -> kein Event", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store, config: {} });
  recordVoiceMinuteMeter(makeCall({ answeredAt: null }));
  assert.equal(store.usageEvents.length, 0);
});

test("recordVoiceMinuteMeter: N Minuten -> Event mit kind/quantity/costCents aus tariffCentsPerMin", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store, config: {} });
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
  const { reconcileOutboundVoiceBudget } = makeMetering({ store, config: {} });
  reconcileOutboundVoiceBudget(makeCall({ direction: "inbound" }));
  assert.equal(store.voiceCostCents.length, 0);
});

test("reconcileOutboundVoiceBudget: outbound, 0 Minuten -> keiner", () => {
  const store = fakeStore();
  const { reconcileOutboundVoiceBudget } = makeMetering({ store, config: {} });
  reconcileOutboundVoiceBudget(makeCall({ answeredAt: null }));
  assert.equal(store.voiceCostCents.length, 0);
});

test("reconcileOutboundVoiceBudget: outbound, N Minuten -> addVoiceUsageCostCents(tenantId, N*tarif)", () => {
  const store = fakeStore();
  const { reconcileOutboundVoiceBudget } = makeMetering({ store, config: {} });
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

test("recordNumberMonthMeter: undefined (uebersprungener Job) -> kein Event", () => {
  const store = fakeStore();
  const config = withConfigNamespaces({ numberSetupFeeCents: NUMBER_SETUP_FEE_CENTS });
  const { recordNumberMonthMeter } = makeMetering({ store, config });
  recordNumberMonthMeter(undefined);
  assert.equal(store.usageEvents.length, 0);
});

test("recordNumberMonthMeter: Number -> Event mit kind/quantity/costCents aus holdAmountForCountry", () => {
  const store = fakeStore();
  const config = withConfigNamespaces({ numberSetupFeeCents: NUMBER_SETUP_FEE_CENTS });
  const { recordNumberMonthMeter } = makeMetering({ store, config });
  const number = { tenantId: TENANT_A, country: "DE" };
  recordNumberMonthMeter(number);
  assert.equal(store.usageEvents.length, 1);
  const [ev] = store.usageEvents;
  assert.equal(ev.tenantId, TENANT_A);
  assert.equal(ev.kind, USAGE_EVENT_KIND.NUMBER_MONTH);
  assert.equal(ev.quantity, 1);
  assert.equal(ev.costCents, holdAmountForCountry(number.country, config.numberSetupFeeCents));
});

// GAP-06 (SOLL, rot): pro angebrochenem Kalendermonat einer aktiven Nummer soll GENAU EIN
// number_month-Beleg existieren. Gemessen hat recordNumberMonthMeter GENAU EINE
// Aufrufstelle - den Provisioning-Drain bei der AKTIVIERUNG (src/worker/
// provisioning-orchestrator.js). Einen zweiten, zeitgesteuerten Pfad gibt es nicht; die
// Miete wird also genau einmal gebucht, egal wie lange die Nummer gehalten wird. Der rote
// Lauf dieses Tests IST der Beweis (R2) - es gibt heute keine Handlung, die ihn gruen
// machen koennte, und genau das ist der Befund.
const ACTIVE_MONTHS = 3;

test("GAP-06 (SOLL, rot): eine seit drei Monaten aktive Nummer traegt drei number_month-Belege", () => {
  const store = fakeStore();
  const { recordNumberMonthMeter } = makeMetering({
    store,
    config: withConfigNamespaces({ numberSetupFeeCents: NUMBER_SETUP_FEE_CENTS }),
  });
  recordNumberMonthMeter({ tenantId: TENANT_A, country: "DE" }); // der einzige Produktionspfad
  const belege = store.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.NUMBER_MONTH);
  assert.equal(
    belege.length,
    ACTIVE_MONTHS,
    "es gibt keinen wiederkehrenden Pfad - die Miete wird nur bei der Aktivierung gebucht, " +
      "die Anzeige (numberMonthlyCostCents) laeuft dem Ledger damit dauerhaft davon",
  );
});

test("Modul bucht ungated: paymentEnabled=false bucht trotzdem (Gate liegt beim Aufrufer, nicht im Modul)", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter, reconcileOutboundVoiceBudget, recordNumberMonthMeter } =
    makeMetering({
      store,
      config: withConfigNamespaces({ paymentEnabled: false, numberSetupFeeCents: NUMBER_SETUP_FEE_CENTS }),
    });
  const call = makeCall();
  recordVoiceMinuteMeter(call);
  reconcileOutboundVoiceBudget(call);
  recordNumberMonthMeter({ tenantId: TENANT_A, country: "DE" });
  assert.equal(store.usageEvents.length, 2, "Voice-Minute- + Number-Month-Event trotz paymentEnabled=false");
  assert.equal(store.voiceCostCents.length, 1, "Reconcile bucht trotz paymentEnabled=false");
});
