// ORIG-01, ORIG-02, ORIG-03, ORIG-05 (Katalog: tasks/i18n-tests/13-live-env-befund.md,
// Abschnitt 6 "Nachtrag: jeder Tenant hat eine US-Nummer - der Tarif weiss davon nichts").
// Kosten-Invariante: jeder Tenant hat eine US-DID, tariffCentsPerMin() verzweigt aber
// AUSSCHLIESSLICH am Ziel (call.to), nie an der Herkunft (call.from/die eigene DID).
//
// ORIG-01/02/03 sind SOLL(rot): sie formulieren, wie eine herkunfts-bewusste Tarifierung
// aussehen MUESSTE, und fallen heute. ORIG-05 ist wie PAY-04/GAP-32 eine gruene
// CHARAKTERISIERUNG der Reserve-Rechnung (Mechanismus bleibt richtig, der Defekt sitzt
// in der fehlenden Herkunfts-Achse selbst, s. ORIG-01/02) - das SOLL fuer "der Anruf soll
// durchkommen" fuehrt test/prod-config-smoke.test.js (GAP-33, Auslandsziel).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { makeMetering } from "../src/billing/metering.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { makeDefaultState, registerTenant, reserveExceedsBudget } from "../src/store/state-ops.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";

const TENANT_A = "t_orig";
const US_OWN_DID = "+15005550006"; // eigene DID des Tenants (keine +49/+33/+44-Vorwahl)
const DE_TARGET = "+4915112345678"; // +49 steht in VOICE_TARIFF_DOMESTIC_PREFIXES
const US_TARGET = "+15551234567"; // ebenfalls keine Domestic-Vorwahl

// ---- Fake-Store (Muster test/metering-unit.test.js): faengt recordUsageEvent/
// addVoiceUsageCostCents auf, ohne Netz/DB. Zusaetzlich die von makeCallFinish
// benoetigten Primitive (withStoreLock/releaseOutboundReserve/save/markBilled/
// addNotification) - No-ops, ausser den beiden Aufzeichnern oben.
function fakeStore() {
  const usageEvents = [];
  return {
    usageEvents,
    recordUsageEvent(ev) {
      usageEvents.push(ev);
    },
    addVoiceUsageCostCents() {},
    recordCallEstimatedCostCents() {},
    withStoreLock: (fn) => Promise.resolve(fn()),
    releaseOutboundReserve: () => {},
    save: () => {},
    markBilled: () => {},
    addNotification: () => {},
  };
}

function makeCall(overrides = {}) {
  return {
    id: "call_orig",
    tenantId: TENANT_A,
    direction: "outbound",
    to: DE_TARGET,
    from: US_OWN_DID,
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z", // 1 Minute
    status: "no-answer", // != completed -> finishCall kehrt nach der Abrechnung frueh zurueck
    transcript: [],
    billedAt: null,
    ...overrides,
  };
}

// ---- ORIG-01 --------------------------------------------------------------------
test("ORIG-01 SOLL: tariffCentsPerMin nimmt Ziel UND Herkunft entgegen (heute nur 1 Parameter)", () => {
  assert.equal(
    tariffCentsPerMin.length,
    2,
    "SOLL: eine zweite Parameter-Stelle fuer die Absendernummer (Herkunft) ist noetig, um " +
      `Ziel+Herkunft gemeinsam zu tarifieren; heute Function.length=${tariffCentsPerMin.length} ` +
      "(outbound-gates.js:145)",
  );
});

// ---- ORIG-02 --------------------------------------------------------------------
test("ORIG-02 SOLL: DE-Ziel von einer US-DID aus muesste den internationalen Satz buchen (heute: Inlandssatz)", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store, config });
  const call = makeCall({ to: DE_TARGET, from: US_OWN_DID });
  recordVoiceMinuteMeter(call);
  assert.equal(store.usageEvents.length, 1);
  const [ev] = store.usageEvents;
  assert.equal(
    ev.costCents,
    1 * config.billing.voiceTariffDefaultCents,
    "SOLL: US->DE ist ein internationales Leg und muss den Worst-Case-Satz buchen " +
      `(heute gebucht: ${ev.costCents} ct, das ist der Inlandssatz - metering.js rechnet ` +
      "ausschliesslich ueber tariffCentsPerMin(call.to), Herkunft fliesst nirgends ein)",
  );
});

// ---- ORIG-03 --------------------------------------------------------------------
test("ORIG-03 SOLL: Inbound auf die eigene US-DID darf NICHT mit dem Auslands-Worst-Case bewertet werden (heute: doch)", async () => {
  const store = fakeStore();
  const metering = makeMetering({ store, config });
  const finishConfig = { billing: { paymentEnabled: true }, privacy: {} };
  const { finishCall } = makeCallFinish({
    store,
    config: finishConfig,
    metering,
    messaging: () => {},
    summarizeCall: async () => null,
    planSummarySms: () => ({ send: false, reason: null }),
    audit: () => {},
  });
  // Inbound: to = die EIGENE DID des Tenants (Anrufer waehlt sie an), from = der externe Anrufer.
  const call = makeCall({ direction: "inbound", to: US_OWN_DID, from: "+4915112345678" });
  await finishCall(call);
  const voiceEvents = store.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.VOICE_MINUTE);
  assert.equal(
    voiceEvents.length,
    0,
    "SOLL: ein Inbound-Call darf kein Voice-Minuten-Event mit dem Auslands-Worst-Case " +
      `erzeugen; heute erzeugt: ${JSON.stringify(voiceEvents)} - call-finish.js:48 ruft ` +
      "recordVoiceMinuteMeter OHNE Richtungsfilter (Inbound wie Outbound)",
  );
});

// ---- ORIG-05 (Charakterisierung, wie PAY-04) -------------------------------------
test("Charakterisierung ORIG-05: US-Tenant ruft +1 (DID-Land == Ziel-Land) - Reserve 1500 ct gegen Tenant-Decke 600 ct blockt trotzdem", () => {
  const reserveCents = tariffCentsPerMin(US_TARGET) * Math.ceil(MAX_CALL_DURATION_CAP_S / 60);
  assert.equal(reserveCents, 1500, "Vorbedingung: live-gemessene Worst-Case-Reserve");
  assert.equal(
    config.billing.defaultTenantBudgetCents,
    600,
    "Vorbedingung: generische Tenant-Decke (Code-Fallback == render.yaml:294-295)",
  );

  const s = makeDefaultState();
  registerTenant(s, TENANT_A, {});
  // KEIN eigener Plan-Cap gesetzt -> effectiveCapCents faellt auf defaultTenantBudgetCents (600)
  // zurueck (state-ops.js:1941-1946) - das ist die Situation "US-Tenant ohne eigenen Plan".
  assert.equal(
    reserveExceedsBudget(s, TENANT_A, reserveCents, config.billing),
    true,
    "heutiger Stand: selbst wenn DID-Land und Ziel-Land beide US sind, tarifiert " +
      "tariffCentsPerMin(to) trotzdem den Auslands-Worst-Case (keine Herkunfts-Achse, " +
      "ORIG-01/02) - die Reserve sprengt die generische Tenant-Decke VOR dem Dial. Das " +
      "SOLL fuer 'der Anruf soll durchkommen' fuehrt test/prod-config-smoke.test.js " +
      "(GAP-33, Auslandsziel)",
  );
});
