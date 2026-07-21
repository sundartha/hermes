// Geteilte Fixturen der Sweep-Tests (src/billing/cost-truing.js): Stub-Store auf dem ECHTEN
// state-ops-Shape, Config-Fixture, Kandidaten-Bauer, Fake-Registry. EINE Quelle (G5) statt
// der bisher in cost-truing-observe.test.js und cost-truing-booking.test.js byte-identisch
// gepflegten Kopien - cost-truing-pool.test.js (KE-P2) waere die dritte gewesen.
//
// KEIN statischer src/config.js-Import an dieser Stelle waere sicherer, aber
// config-namespaces-helper.js importiert config.js bereits statisch (siehe dessen eigener
// Kopf-Kommentar) - GENAU wie im Bestand (cost-truing-observe.test.js importierte
// withConfigNamespaces bisher ebenfalls statisch). Dateien, die zusaetzlich den ECHTEN
// Telnyx-Adapter brauchen (cost-truing-pool.test.js), importieren DIESE Datei deshalb
// DYNAMISCH, NACH ihrem eigenen process.env-Setup (Lehre test-base-env-drift, Muster
// telnyx-cost-records.test.js) - genau wie sie telnyxVoice/cost-truing.js dynamisch holen.
import { createCall, recordCallCostTruingResult, applyCostCorrectionCents } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const MS_PER_MINUTE = 60 * 1000;

// Stub-Store (Muster metering-unit.test.js: faengt Schreibzugriffe in einem Array).
// store.load() liefert den ECHTEN state-Spiegel; recordCallCostTruingResult UND
// applyCostCorrectionCents delegieren an die ECHTEN state-ops-Funktionen (kein zweites,
// vereinfachtes Store-Mock-Verhalten). Die Stub hat BEWUSST keine query/pool/client-
// Methode (der Sweep darf nie eigenes SQL absetzen - ein Aufruf einer solchen Methode
// waere ein TypeError).
export function makeStubStore(state, { nowMs = Date.now() } = {}) {
  const writes = [];
  return {
    state,
    writes,
    load() {
      return state;
    },
    recordCallCostTruingResult(callId, outcome) {
      const { call, changed } = recordCallCostTruingResult(state, callId, outcome);
      if (changed) writes.push({ callId, outcome });
      return call;
    },
    applyCostCorrectionCents(tenantId, input) {
      return applyCostCorrectionCents(state, tenantId, input, new Date(nowMs).toISOString());
    },
  };
}

// Konfig-Fixture fuer die P3-Felder + LCT P5 (Drift-Waechter, billing-Namespace). Jeder
// Test ueberschreibt nur, was er wirklich pruefen will (F1: Default-Objekt statt loser
// Argumente). providerToBucketRateMicro NEUTRAL (Faktor 1,0) - haelt Cent-Fixturen direkt
// lesbar (die Waehrungsrichtung selbst ist test/cost-calibration.test.js vorbehalten).
// platformAlertSmsTo default leer (BASE_ENV-Zustand).
export function fakeConfig(overrides = {}) {
  return withConfigNamespaces({
    costTruingDelayMinutes: 180,
    costTruingMaxAttempts: 5,
    costTruingRequiredRecordTypes: [],
    costTruingMinCoveragePercent: 80,
    costTruingCoverageStallSweeps: 8,
    costDriftWarnPercent: 50,
    costAlertDebounceMs: 24 * 60 * 60 * 1000,
    voiceTariffDomesticCents: 20,
    voiceTariffDefaultCents: 300,
    voiceTariffDomesticPrefixes: ["+49", "+33", "+44"],
    providerToBucketRateMicro: 1_000_000,
    costCalibrationMinSamples: 20,
    platformAlertSmsTo: "",
    ...overrides,
  });
}

export function isoMinutesAgo(nowMs, minutes) {
  return new Date(nowMs - minutes * MS_PER_MINUTE).toISOString();
}

// Ein beendeter Outbound-Call, faellig fuer den Abgleich (endedAt lange genug her).
// legRef waehlt twilioSid ODER callControlId (providerLegIdOf: twilioSid || callControlId).
export function makeDueOutboundCall(state, { nowMs, tenantId = BOOTSTRAP_TENANT_ID, provider = "telnyx", legRef = { callControlId: "cc_1" }, endedMinutesAgo = 200, estimatedCostCents = null, to = "+49" } = {}) {
  const call = createCall(state, { direction: "outbound", from: "+49", to, tenantId, provider });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutesAgo + 1);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutesAgo);
  if (legRef.callControlId) call.callControlId = legRef.callControlId;
  if (legRef.twilioSid) call.twilioSid = legRef.twilioSid;
  if (estimatedCostCents !== null) call.estimatedCostCents = estimatedCostCents;
  return call;
}

export function fakeVoiceControl(byProvider) {
  return (provider) => {
    const impl = byProvider[provider];
    if (!impl) throw new Error(`Provider '${provider}' fuer Port 'voiceControl' nicht unterstuetzt`);
    return impl;
  };
}
