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
import {
  createCall, recordCallCostTruingResult, applyCostCorrectionCents, recordRelayTtsCharacters,
  markCrossCheckAttempted, recordCallCostEvidence, callCostEvidence,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
// KV2-1: die drei neuen Kadenz-/Entprell-Defaults der fakeConfig lesen den ECHTEN
// Produktions-Fallback statt einen zweiten, hier getippten Zahlenwert zu erfinden (G5,
// G25 - kein neuer Magic-Number-Fund in dieser bereits an eslint-suppressions.json
// gepinnten Datei). config.js wird ueber config-namespaces-helper.js an dieser Stelle
// ohnehin schon statisch importiert (s. Kopf-Kommentar oben) - kein zweiter Importpfad,
// kein zusaetzliches test-base-env-drift-Risiko.
import { config as prodDefaults } from "../src/config.js";

const MS_PER_MINUTE = 60 * 1000;

// Stub-Store (Muster metering-unit.test.js: faengt Schreibzugriffe in einem Array).
// store.load() liefert den ECHTEN state-Spiegel; recordCallCostTruingResult UND
// applyCostCorrectionCents delegieren an die ECHTEN state-ops-Funktionen (kein zweites,
// vereinfachtes Store-Mock-Verhalten). Die Stub hat BEWUSST keine query/pool/client-
// Methode (der Sweep darf nie eigenes SQL absetzen - ein Aufruf einer solchen Methode
// waere ein TypeError).
// billing (KV-P7): Config-Fixture fuer recordRelayTtsCharacters (Zyklus/Quote/Schwelle).
// Default fakeConfig().billing, damit ein Aufrufer ohne eigene Config trotzdem eine echte
// Zyklus-Berechnung bekommt statt eines zweiten, vereinfachten Fixture-Werts (G5).
export function makeStubStore(state, { nowMs = Date.now(), billing = fakeConfig().billing } = {}) {
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
    // KV-P7 (Massnahme 3): Telnyx-Relay-Verbrauch - dieselbe Delegation an die ECHTE
    // state-ops-Funktion (kein zweites, vereinfachtes Verhalten), Facade-Signatur
    // (tenantId, chars, nowIso) wie store.js/store/pg.js. Ersetzt den frueheren
    // recordTenantTtsCharacters-Stub: der einzige Aufrufer (cost-truing.js,
    // bookTtsCharactersFor) ruft seit KV-P7 recordRelayTtsCharacters.
    recordRelayTtsCharacters(tenantId, chars, nowIso) {
      return recordRelayTtsCharacters(state, { tenantId, chars, cfg: billing, nowIso }).warning;
    },
    // KV-M4: Riegel der monatlichen Gegenprobe - dieselbe Delegation (ECHTE state-ops-
    // Funktion, kein zweites, vereinfachtes Verhalten).
    markCostCrossCheckAttempted(monthKey) {
      markCrossCheckAttempted(state, monthKey);
    },
    // KV2-5: das Kosten-Buch - dieselbe Delegation an die ECHTEN state-ops-Funktionen
    // (kein zweites, vereinfachtes Verhalten), damit die Sweep-Tests ueber den echten
    // Schreibweg laufen statt in schreibeSweepKostenbeleg's fail-soft-catch zu landen.
    recordCallCostEvidence(eingabe) {
      return recordCallCostEvidence(state, eingabe);
    },
    callCostEvidence(callId) {
      return callCostEvidence(state, callId);
    },
    // KV2-1: der Befundkanal laeuft ueber den Betreiber-Meldeweg und schreibt dabei den
    // durablen Marker (state.outageAlerts) - dieselben zwei Store-Methoden, die
    // outage-report.js ueberall nutzt. Der Lock ist hier ein Direktaufruf: der Stub kennt
    // keine Nebenlaeufigkeit, und ein zweites Lock-Verhalten waere eine zweite Wahrheit.
    withStoreLock(fn) { return Promise.resolve().then(fn); },
    save() {},
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
    // KV2-6: ECHTER Prod-Fallback (s. prodDefaults-Import oben) statt eines zweiten,
    // hier getippten Zahlenwerts - sonst waere das Herzschlag-Fenster in den
    // Bestands-Sweep-Tests undefined und der Herzschlag dort strukturell stumm.
    kostenHeartbeatFensterH: prodDefaults.billing.kostenHeartbeatFensterH,
    // KV2-1: die Kadenz-Quelle der zeitbasierten Stall-Terminierung (Default = ECHTER
    // Prod-Fallback, s. Import oben). Ohne einen Default hier waere
    // costTruingCoverageStallSweeps * undefined = NaN, und JEDER Vergleich mit NaN ist
    // false - coverage_stalled feuerte dann bei JEDEM Sweep 1, unabhaengig vom Fenster.
    costTruingSweepIntervalMs: prodDefaults.billing.costTruingSweepIntervalMs,
    costDriftWarnPercent: 50,
    costAlertDebounceMs: 24 * 60 * 60 * 1000,
    voiceTariffDomesticCents: 20,
    voiceTariffDefaultCents: 300,
    voiceTariffDomesticPrefixes: ["+49", "+33", "+44"],
    providerToBucketRateMicro: 1_000_000,
    costCalibrationMinSamples: 20,
    platformAlertSmsTo: "",
    // KV2-1: Entprellung der VOLL-Stufe (Plan 4.9). ECHTER Prod-Fallback (grosszuegig);
    // Tests, die die Entprellung selbst pruefen, setzen sie explizit herunter.
    outageAlertDebounceMs: prodDefaults.billing.outageAlertDebounceMs,
    outageAlertRetryMs: prodDefaults.billing.outageAlertRetryMs,
    // Alarm-Ziel default leer (BASE_ENV-Zustand) -> kanaele=keine, kein Versand.
    platformAlertMailTo: "",
    // KV-P7: Fallback-Werte aus src/config.js (ttsCharacterQuota/-WarnPercent/
    // ttsQuotaCycleAnchorDay) - ohne sie liest recordRelayTtsCharacters (bumpPlatformTtsQuota)
    // cfg.ttsCharacterQuota als undefined (withConfigNamespaces delegiert auf den flachen
    // Slot, der ohne Eintrag hier fehlt).
    ttsCharacterQuota: 39981,
    ttsCharacterQuotaWarnPercent: 75,
    ttsQuotaCycleAnchorDay: 3,
    ...overrides,
  });
}

export function isoMinutesAgo(nowMs, minutes) {
  return new Date(nowMs - minutes * MS_PER_MINUTE).toISOString();
}

// Ein beendeter, fuer den Abgleich faelliger Call. RICHTUNG als Parameter, weil der Sweep
// seit KV-P3 richtungsoffen ist - zwei nebeneinander gepflegte Bauer waeren dieselbe
// Fixtur zweimal (G5/S2) und liefen beim ersten Nachziehen auseinander. Die zwei
// exportierten Wrapper darunter halten die Namen ehrlich (N2): keiner behauptet eine
// Richtung, die er nicht baut.
// legRef waehlt twilioSid ODER callControlId (providerLegIdOf: twilioSid || callControlId).
function makeDueCall(state, { direction, nowMs, tenantId = BOOTSTRAP_TENANT_ID, provider = "telnyx", legRef = { callControlId: "cc_1" }, endedMinutesAgo = 200, estimatedCostCents = null, from = "+49", to = "+49" }) {
  const call = createCall(state, { direction, from, to, tenantId, provider });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutesAgo + 1);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutesAgo);
  if (legRef.callControlId) call.callControlId = legRef.callControlId;
  if (legRef.twilioSid) call.twilioSid = legRef.twilioSid;
  if (estimatedCostCents !== null) call.estimatedCostCents = estimatedCostCents;
  return call;
}

export const makeDueOutboundCall = (state, opts = {}) => makeDueCall(state, { ...opts, direction: "outbound" });
// KV-P3: Gegenstueck fuer die Inbound-Abnahmen. `to` ist hier die EIGENE DID, `from` der
// Anrufer - fuer den Abgleich ohne Belang (er rechnet gegen estimatedCostCents, nie gegen
// einen Tarif), aber falsch herum benannte Fixturen sind der Anfang der naechsten
// Fehlannahme.
export const makeDueInboundCall = (state, opts = {}) => makeDueCall(state, { ...opts, direction: "inbound" });

export function fakeVoiceControl(byProvider) {
  return (provider) => {
    const impl = byProvider[provider];
    if (!impl) throw new Error(`Provider '${provider}' fuer Port 'voiceControl' nicht unterstuetzt`);
    return impl;
  };
}

// Der KOEDER aller Beleg-Fixturen (Spec A2): ein Feld, das der Code NICHT als
// Zuordnungsquelle verwenden darf. Es traegt immer dieselbe FREMDE UUID - liest der Code
// telnyx_leg_id, kommt kein einziger erwarteter Beleg herein und jede Erwartung faellt.
const BAIT_LEG_ID = "0bad0bad-0bad-11f1-0bad-0bad0bad0bad0";
// Gemessenes hartes page[size]-Maximum bzw. eine total_pages-Zahl, die keine Seite je zur
// letzten macht (Spec A1) - so kann nur die Seitenobergrenze oder `since` die Schleife enden.
export const MEASURED_PAGE_SIZE = 50;
export const NEVER_LAST_PAGE_TOTAL = 99;

// Zaehlender, NETZFREIER fetch-Stub der Sweep-Tests mit dem ECHTEN Telnyx-Adapter.
// bodyFor(recordType, pageNumber) waehlt den Antwortkoerper - genau die beiden
// Query-Parameter, von denen der Belegabruf abhaengt. Rueckgabe ist die Aufruf-Liste; ihre
// LAENGE ist in mehreren Tests die eigentliche Zusage (KE-P2/KE-P5).
export function stubCountingFetch({ status = 200, ok = true, bodyFor = () => ({ data: [] }) } = {}) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const params = new URL(String(url)).searchParams;
    const body = bodyFor(params.get("filter[record_type]"), Number(params.get("page[number]")));
    return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return calls;
}

// GEMESSENE sip-trunking-Belegform (Spec A1): Zuordnungs-IDs call_control_id (Anker) +
// telnyx_session_id, Zeitfelder started_at/finished_at, cost als STRING, billed_sec als
// Zahl - dazu der Koeder. Der Anker fehlt bewusst, wenn callControlId null ist: das ZWEITE
// Bein desselben Anrufs traegt ihn laut Messung nicht und kommt nur ueber die Session herein.
export function measuredSipTrunkingRecord({ at, sessionId, callControlId = null, sipCallId = undefined, cost = "0.0401", billedSec = 60 }) {
  const record = {
    record_type: "sip-trunking",
    cost,
    currency: "USD",
    telnyx_session_id: sessionId,
    telnyx_leg_id: BAIT_LEG_ID, // Koeder (A2)
    started_at: at,
    finished_at: at,
    billed_sec: billedSec,
  };
  if (callControlId) record.call_control_id = callControlId;
  if (sipCallId) record.sip_call_id = sipCallId;
  return record;
}

// Eine VOLLE Seite FREMDER Belege (keiner traegt den Anker eines Kandidaten) in der
// gemessenen Listen-Form {data, meta}.
export function foreignSipTrunkingPage({ at, idPrefix, totalPages }) {
  const data = Array.from({ length: MEASURED_PAGE_SIZE }, (_, i) =>
    measuredSipTrunkingRecord({ at, callControlId: `${idPrefix}_${i}`, sessionId: `sess_${idPrefix}_${i}` }));
  return {
    data,
    meta: { total_results: MEASURED_PAGE_SIZE * totalPages, total_pages: totalPages, page_size: MEASURED_PAGE_SIZE },
  };
}
