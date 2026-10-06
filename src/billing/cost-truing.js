import {
  COST_TRUING_SOURCE,
  MAX_CALL_DURATION_CAP_S,
  MICRO_CENTS_PER_CENT,
  isBookableCents,
  isProviderMicroCents,
  istBeweisendeHerkunft,
} from "../store/defaults.js";
import { MS_PER_SECOND } from "../utils/timer.js";
import { chargeAnchorsOfCall, closeOutageAlert, nextCostTruingAttempt, openOutageAlert } from "../store/state-ops.js";
import { sendBootstrapAlertSms } from "../telephony/alert-sms.js";
import { meldeBetreiberNotiz, meldeVollBefund } from "../telephony/outage-report.js";
import { alarmKanalZeile, betreiberAlarmKanaele } from "../boot-guard.js";
import {
  tariffDriftReportFromConfig,
  alertableDriftFindings,
  driftLine,
  tarifpaarReport,
  tarifpaarZeile,
  alertbareTarifpaarBefunde,
} from "./cost-calibration.js";
import { istBekanntesKostenprofil, kostenprofilFuerAnruf, pflichttypenFuerProfil } from "./kostenarten.js";
import { schreibeSweepKostenbeleg } from "./sweep-kostenbeleg.js";
import { legRefOfCall } from "./call-leg-ref.js";
import { kostenBuchBericht, istBuchBefundCode } from "./kosten-deckung.js";
import { ABSCHLUSS_GRUND, abschlussFuerAnruf, faelligkeitsfensterMs, LEERE_LISTE, zaehlListe } from "./kosten-abschluss.js";
import { settlementProjektion } from "./kosten-projektion.js";
import { reifeElBelege } from "./el-reifung.js";

export const SWEEP_TRIGGER = Object.freeze({ INTERVAL: "interval", MANUAL: "manual" });

const PERCENT_BASE = 100;
const MS_PER_MINUTE = 60 * 1000;
const SWEEP_RUNNING_REASON = "sweep_running";
const POOL_INCOMPLETE_REASON = "pool_incomplete";
const COST_TRUING_FINDING = Object.freeze({
  COVERAGE_BELOW_THRESHOLD: "coverage_below_threshold",
  COVERAGE_STALLED: "coverage_stalled",
  REQUESTS_ABOVE_THRESHOLD: "requests_above_threshold",
  TTS_QUOTA_WARN_THRESHOLD: "tts_quota_warn_threshold",
  TTS_QUOTA_EXHAUSTED: "tts_quota_exhausted",
  TARIFPAAR_UNTERSCHAETZT: "tarifpaar_unterschaetzt",
});
const COST_TRUING_AUDIT_EVENT = "cost_truing_befund";

const KOSTEN_BUCKET_PREFIX = "kosten:";
const kostenBucket = (code) => `${KOSTEN_BUCKET_PREFIX}${code}`;

const COVERAGE_FINDING_CODES = Object.freeze([
  COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD,
  COST_TRUING_FINDING.COVERAGE_STALLED,
]);

const VOLL_BEFUND_CODES = new Set([...COVERAGE_FINDING_CODES, COST_TRUING_FINDING.TARIFPAAR_UNTERSCHAETZT]);

const COST_TRUING_RECOVERED_EVENT = "cost_truing_erholt";

function coverageDetail(coveragePercent, minCoveragePercent, seitIso) {
  return `deckung=${coveragePercent}% schwelle=${minCoveragePercent}% seit=${seitIso}`;
}

function coverageStallMs(stallSweeps, sweepIntervalMs) {
  return stallSweeps * sweepIntervalMs;
}

async function closeCoverageBefunde(store, audit, nowMs) {
  const geschlossen = await store.withStoreLock(() => {
    const state = store.load();
    return COVERAGE_FINDING_CODES
      .map((code) => closeOutageAlert(state, { code: kostenBucket(code), nowMs }))
      .filter(Boolean).length;
  });
  store.save();
  if (geschlossen === 0) return;
  const zeile = `marker=${geschlossen}`;
  console.log(`[cost-truing] erholt ${zeile}`);
  audit(COST_TRUING_RECOVERED_EVENT, null, zeile);
}

function abschlussNachMessung({ call, measured, records, sweepTraegerErledigt, sammler, store, config }) {
  if (measured) schreibeSweepKostenbeleg({ store, call, measured, records });
  return abschlussFuerAnruf({
    call, belege: store.callCostEvidence(call.id), nowMs: sammler.nowMs,
    deadlineMs: faelligkeitsfensterMs(config.billing), sweepTraegerErledigt,
  });
}

function meldeAbschluss(call, abschluss, sammler) {
  console.log(
    `[cost-truing] abschluss call=${call.id} zustand=${abschluss.endzustand} ` +
      `grund=${abschluss.grund} fehlend=${abschluss.fehlend.join(",") || LEERE_LISTE}`,
  );
  sammler.abschluesse.push(abschluss.endzustand);
}

function schliesseFaelligeOffene(candidates, sammler, { store, config }) {
  for (const call of candidates) {
    if (call.costTruedAt !== null) continue;
    const belege = store.callCostEvidence(call.id);
    const abschluss = abschlussFuerAnruf({
      call,
      belege,
      nowMs: sammler.nowMs,
      deadlineMs: faelligkeitsfensterMs(config.billing),
      sweepTraegerErledigt: false,
    });
    if (!abschluss.geschlossen) continue;
    const projektion = settlementProjektion({ call, belege });
    setteleAnruf({ call, projektion, store, config });
    store.schliesseKostenAbgleich(call.id, {
      closedAt: new Date(sammler.nowMs).toISOString(),
      source: herkunftOhneMessung(projektion),
      actualCostMicroCents: projektion.summeMikroCents,
    });
    meldeAbschluss(call, abschluss, sammler);
  }
}

const TARIFF_DRIFT_AUDIT_EVENT = "tarif_drift_befund";
const DRIFT_ALERT_SMS_PREFIX = "[hermes] Tarif-Drift: ";

const SWEEP_REQUESTS_WARN_THRESHOLD = 1440;

const COVERAGE_BUCKET = Object.freeze({
  ELIGIBLE: "eligible",
  NEVER_ANSWERED: "nie_beantwortet",
  NO_ESTIMATE: "ohne_schaetzung",
  OUTSIDE_WINDOW: "ausserhalb_fenster",
});

export const PROVIDER_COST_RECORD_WINDOW_DAYS = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
export const PROVIDER_COST_RECORD_WINDOW_MS =
  PROVIDER_COST_RECORD_WINDOW_DAYS * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

const isEndedCall = (call) => !!call.endedAt;
const providerLegIdOf = legRefOfCall;

const pflichttypenVon = (call, billing) =>
  pflichttypenFuerProfil(kostenprofilFuerAnruf(call), billing.costTruingRequiredRecordTypes);

const versucheUebrig = (call, billing) => nextCostTruingAttempt(call) <= billing.costTruingMaxAttempts;

const isRetrievable = (call, control) => control !== null && providerLegIdOf(call) !== null;

const nonNegativeCount = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

const sweepDarfKorrigieren = (call, projektion) =>
  isBookableCents(call.estimatedCostCents) &&
  isProviderMicroCents(projektion.summeMikroCents) &&
  istBekanntesKostenprofil(kostenprofilFuerAnruf(call));

function setteleAnruf({ call, projektion, store, config }) {
  if (!sweepDarfKorrigieren(call, projektion)) return;
  const { booked, deltaCents } = store.applyCostCorrectionCents(call.tenantId, {
    actualCostMicroCents: projektion.summeMikroCents,
    estimatedCostCents: call.estimatedCostCents,
    providerToBucketRateMicro: config.billing.providerToBucketRateMicro,
    dataComplete: projektion.vollBelegt,
    chargeAnchors: chargeAnchorsOfCall(call),
  });
  console.log(`[cost-truing] korrektur call=${call.id} delta_eur_cent=${deltaCents} gebucht=${booked}`);
}

function herkunftOhneMessung(projektion) {
  if (projektion.summeMikroCents === null) return null;
  return projektion.vollBelegt
    ? COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG
    : COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG;
}

async function meldeTarifpaar({ state, eigenCentJeAnruf, billing, emitFinding, nowMs }) {
  const report = tarifpaarReport({ state, eigenCentJeAnruf, billing });
  console.log(`[cost-truing] tarifpaar ${report.map(tarifpaarZeile).join(" | ")}`);
  const unterschaetzt = alertbareTarifpaarBefunde(report);
  if (unterschaetzt.length === 0) return;
  await emitFinding(
    COST_TRUING_FINDING.TARIFPAAR_UNTERSCHAETZT,
    unterschaetzt.map(tarifpaarZeile).join(" | "),
    nowMs,
  );
}

const endedAtMs = (call) => {
  const ms = Date.parse(call.endedAt);
  return Number.isFinite(ms) ? ms : null;
};

function coverageBucketOf(call, nowMs) {
  if (!call.answeredAt) return COVERAGE_BUCKET.NEVER_ANSWERED;
  if (!isBookableCents(call.estimatedCostCents)) return COVERAGE_BUCKET.NO_ESTIMATE;
  const endedMs = endedAtMs(call);
  if (endedMs === null || nowMs - endedMs > PROVIDER_COST_RECORD_WINDOW_MS)
    return COVERAGE_BUCKET.OUTSIDE_WINDOW;
  return COVERAGE_BUCKET.ELIGIBLE;
}

function coverageBreakdown(state, nowMs) {
  const ended = Array.isArray(state?.calls) ? state.calls.filter(isEndedCall) : [];
  const breakdown = { eligible: 0, proven: 0, noEstimate: 0, neverAnswered: 0, outsideWindow: 0 };
  for (const call of ended) {
    const bucket = coverageBucketOf(call, nowMs);
    if (bucket === COVERAGE_BUCKET.NEVER_ANSWERED) {
      breakdown.neverAnswered++;
      continue;
    }
    if (bucket === COVERAGE_BUCKET.NO_ESTIMATE) {
      breakdown.noEstimate++;
      continue;
    }
    if (bucket === COVERAGE_BUCKET.OUTSIDE_WINDOW) {
      breakdown.outsideWindow++;
      continue;
    }
    breakdown.eligible++;
    if (istBeweisendeHerkunft(call.costTruedSource)) breakdown.proven++;
  }
  return breakdown;
}

function percentFromBreakdown({ eligible, proven }) {
  return eligible === 0 ? 0 : Math.floor((proven * PERCENT_BASE) / eligible);
}

const POOL_SINCE_MARGIN_FACTOR = 12;
const POOL_SINCE_MARGIN_MS = POOL_SINCE_MARGIN_FACTOR * MAX_CALL_DURATION_CAP_S * MS_PER_SECOND;

function poolSinceFor(candidates) {
  let oldestMs = null;
  for (const call of candidates) {
    const ms = endedAtMs(call);
    if (ms !== null && (oldestMs === null || ms < oldestMs)) oldestMs = ms;
  }
  return oldestMs === null ? undefined : new Date(oldestMs - POOL_SINCE_MARGIN_MS).toISOString();
}

export function costTruingCoveragePercent(state, nowMs = Date.now()) {
  return percentFromBreakdown(coverageBreakdown(state, nowMs));
}

export function ohneBeweiskraft(source) {
  return istBeweisendeHerkunft(source) ? COST_TRUING_SOURCE.INCOMPLETE : source;
}

export function makeCostTruing({ store, config, voiceControl, audit, messaging, mailer, elKostenRead = null, eigenCentJeAnruf = null, now = Date.now }) {
  let sweepRunning = false;

  const lastFindingMs = new Map();

  function isTruingCandidate(call, nowMs) {
    if (!isEndedCall(call) || call.costTruedAt !== null) return false;
    const endedMs = endedAtMs(call);
    if (endedMs === null) return false;
    return nowMs - endedMs >= config.billing.costTruingDelayMinutes * MS_PER_MINUTE;
  }

  function sumRecordMicroCents(records) {
    let total = 0;
    for (const r of records) {
      if (!Number.isSafeInteger(r?.costMicroCents) || r.costMicroCents < 0) return null;
      total += r.costMicroCents;
      if (!Number.isSafeInteger(total)) return null;
    }
    return total;
  }

  function sumIntegerField(records, field) {
    return records.reduce(
      (sum, r) => sum + (Number.isSafeInteger(r?.[field]) && r[field] > 0 ? r[field] : 0), 0);
  }

  function classifyRecords(records, requiredRecordTypes) {
    if (!Array.isArray(records) || records.length === 0) return null;
    const total = sumRecordMicroCents(records);
    if (total === null) return null;
    const found = new Set(records.map((r) => r.recordType));
    const complete = requiredRecordTypes.length > 0 && requiredRecordTypes.every((t) => found.has(t));
    return {
      actualCostMicroCents: total,
      source: complete ? COST_TRUING_SOURCE.DETAIL_RECORDS : COST_TRUING_SOURCE.INCOMPLETE,
      billedSecTotal: sumIntegerField(records, "billedSec"),
      ttsCharacters: sumIntegerField(records, "ttsCharacters"),
    };
  }

  function warnOnCostDrift(call, actualMicroCents) {
    const estimateCents = call.estimatedCostCents;
    if (!Number.isSafeInteger(estimateCents) || estimateCents <= 0) return;
    const estimateMicroCents = estimateCents * MICRO_CENTS_PER_CENT;
    const deviationPercent = Math.floor(
      (Math.abs(actualMicroCents - estimateMicroCents) * PERCENT_BASE) / estimateMicroCents,
    );
    if (deviationPercent <= config.billing.costDriftWarnPercent) return;
    console.warn(
      `[cost-truing] Kosten-Drift call=${call.id} ist_usd_mikrocent=${actualMicroCents} ` +
        `schaetzung_eur_cent=${estimateCents} abweichung=${deviationPercent}%`,
    );
  }

  function shouldEmitFinding(key, nowMs) {
    const last = lastFindingMs.get(key);
    if (last !== undefined && nowMs - last < config.billing.costAlertDebounceMs) return false;
    lastFindingMs.set(key, nowMs);
    return true;
  }

  async function emitFinding(code, detail, nowMs) {
    const voll = VOLL_BEFUND_CODES.has(code) || istBuchBefundCode(code);
    if (!voll && !shouldEmitFinding(code, nowMs)) return;
    const zeile = `grund=${code} ${detail}`;
    console.warn(`[cost-truing] Befund ${zeile}`);
    const meldung = { store, config, audit, messaging, mailer, bucket: kostenBucket(code), aktion: COST_TRUING_AUDIT_EVENT, zeile, nowMs };
    if (voll) await meldeVollBefund(meldung);
    else await meldeBetreiberNotiz(meldung);
  }

  async function reportCoverage(coveragePercent, coverage, nowMs) {
    const min = config.billing.costTruingMinCoveragePercent;
    console.log(
      `[cost-truing] deckung=${coveragePercent}% schwelle=${min}% ` +
        `ohne_schaetzung=${coverage.noEstimate} nie_beantwortet=${coverage.neverAnswered} ` +
        `ausserhalb_fenster=${coverage.outsideWindow}`,
    );
    if (coveragePercent >= min) {
      await closeCoverageBefunde(store, audit, nowMs);
      return;
    }
    const marker = openOutageAlert(store.load(), kostenBucket(COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD));
    const seitIso = marker ? marker.firstSeenAt : new Date(nowMs).toISOString();
    const detail = coverageDetail(coveragePercent, min, seitIso);
    await emitFinding(COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD, detail, nowMs);
    const stallMs = coverageStallMs(config.billing.costTruingCoverageStallSweeps, config.billing.costTruingSweepIntervalMs);
    if (nowMs - Date.parse(seitIso) < stallMs) return;
    await emitFinding(COST_TRUING_FINDING.COVERAGE_STALLED, detail, nowMs);
  }

  function countOutcome(tally, truedSource, closed) {
    if (truedSource === COST_TRUING_SOURCE.UNAVAILABLE) {
      if (closed) tally.failed++;
      else tally.unavailable++;
      return;
    }
    if (istBeweisendeHerkunft(truedSource)) tally.measured++;
    else if (truedSource === COST_TRUING_SOURCE.NO_ESTIMATE) tally.noEstimate++;
    else tally.incomplete++;
  }

  function truedSourceOf({ call, measured, projektion, abschluss }) {
    if (!isBookableCents(call.estimatedCostCents)) return projektion.vollBelegt ? COST_TRUING_SOURCE.NO_ESTIMATE : ohneBeweiskraft(measured.source);
    if (projektion.vollBelegt) return COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG;
    if (abschluss.grund === ABSCHLUSS_GRUND.FRIST) return COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG;
    return ohneBeweiskraft(measured.source);
  }

  function projektionVon(call) {
    return settlementProjektion({ call, belege: store.callCostEvidence(call.id) });
  }

  function bookTtsCharactersFor(call, measured, sammler) {
    if (measured.ttsCharacters <= 0) return;
    const nowMs = now();
    const warnung = store.recordRelayTtsCharacters(call.tenantId, measured.ttsCharacters, new Date(nowMs).toISOString());
    if (warnung) sammler.ttsWarnungen.push(warnung);
  }

  async function reportTtsQuotaFinding(warning, nowMs) {
    const code = warning.exhausted
      ? COST_TRUING_FINDING.TTS_QUOTA_EXHAUSTED
      : COST_TRUING_FINDING.TTS_QUOTA_WARN_THRESHOLD;
    await emitFinding(code, `zeichen=${warning.characters}/${warning.quota} zyklus=${warning.cycleKey}`, nowMs);
  }

  function poolFetchStats(pool) {
    return {
      requests: nonNegativeCount(pool?.requests), pages: nonNegativeCount(pool?.pages),
      records: Array.isArray(pool?.raw) ? pool.raw.length : 0,
      incomplete: !(pool?.ok === true && pool.complete !== false),
    };
  }

  function emptyFetchTally() {
    return { requests: 0, pages: 0, records: 0, incompletePools: 0 };
  }

  function addPoolFetchStats(fetchTally, stats) {
    fetchTally.requests += stats.requests;
    fetchTally.pages += stats.pages;
    fetchTally.records += stats.records;
    if (stats.incomplete) fetchTally.incompletePools++;
  }

  function costRecordControlFor(provider) {
    let control;
    try {
      control = voiceControl(provider);
    } catch {
      return null;
    }
    const hasCostRecordMethods =
      typeof control.fetchCostRecordPool === "function" && typeof control.assignCostRecords === "function";
    return hasCostRecordMethods ? control : null;
  }

  function costRecordControlsFor(candidates) {
    const controls = new Map();
    for (const call of candidates)
      if (!controls.has(call.provider)) controls.set(call.provider, costRecordControlFor(call.provider));
    return controls;
  }

  function bookablePool(pool) {
    if (!pool?.ok) return pool ?? { ok: false };
    return pool.complete === false ? { ok: false, reason: POOL_INCOMPLETE_REASON } : pool;
  }

  async function fetchCostRecordPoolFor(control, since) {
    try {
      const answer = await control.fetchCostRecordPool({ since });
      return { control, pool: bookablePool(answer), stats: poolFetchStats(answer) };
    } catch {
      return { control, pool: { ok: false }, stats: poolFetchStats(null) };
    }
  }

  async function fetchCostRecordPools(retrievable, controls) {
    const since = poolSinceFor(retrievable);
    const pools = new Map();
    const fetchTally = emptyFetchTally();
    for (const call of retrievable) {
      if (pools.has(call.provider)) continue;
      const fetched = await fetchCostRecordPoolFor(controls.get(call.provider), since);
      pools.set(call.provider, fetched);
      addPoolFetchStats(fetchTally, fetched.stats);
    }
    return { pools, fetchTally };
  }

  function trueOneCall(call, { control, pool }, sammler) {
    const legId = providerLegIdOf(call);
    let result;
    try {
      result = pool.ok
        ? control.assignCostRecords(pool, { legId, startedAt: call.startedAt, endedAt: call.endedAt })
        : pool;
    } catch {
      result = { ok: false };
    }

    const measured = result?.ok
      ? classifyRecords(result.records, pflichttypenVon(call, config.billing))
      : null;
    const attempt = nextCostTruingAttempt(call);
    const sweepTraegerErledigt = measured !== null || attempt >= config.billing.costTruingMaxAttempts;
    const abschluss = abschlussNachMessung({
      call,
      measured,
      records: result.records,
      sweepTraegerErledigt,
      sammler,
      store,
      config,
    });
    const closed = abschluss.geschlossen;
    const projektion = projektionVon(call);
    const truedSource = measured
      ? truedSourceOf({ call, measured, projektion, abschluss })
      : COST_TRUING_SOURCE.UNAVAILABLE;

    store.recordCallCostTruingResult(call.id, {
      source: truedSource,
      actualCostMicroCents: projektion.summeMikroCents,
      closedAt: closed ? new Date(now()).toISOString() : null,
    });

    if (measured && closed) {
      warnOnCostDrift(call, measured.actualCostMicroCents);
      bookTtsCharactersFor(call, measured, sammler);
    }
    if (closed) setteleAnruf({ call, projektion, store, config });
    countOutcome(sammler.tally, truedSource, closed);
    if (closed) meldeAbschluss(call, abschluss, sammler);
  }

  function alertDrift(entry, nowMs) {
    if (!shouldEmitFinding(`${entry.prefix} ${entry.code}`, nowMs)) return;
    const detail = driftLine(entry);
    console.warn(`[cost-truing] Tarif-Drift ${detail}`);
    audit(TARIFF_DRIFT_AUDIT_EVENT, null, detail);
    sendBootstrapAlertSms({ messaging, config, store, prefix: DRIFT_ALERT_SMS_PREFIX, detail, logTag: "cost-truing" });
  }

  async function reportTariffDrift(state, nowMs) {
    const report = tariffDriftReportFromConfig(state.calls, config.billing);
    console.log(`[cost-truing] tarif-drift ${report.map(driftLine).join(" | ")}`);
    for (const entry of alertableDriftFindings(report)) alertDrift(entry, nowMs);
    await meldeTarifpaar({ state, eigenCentJeAnruf, billing: config.billing, emitFinding, nowMs });
  }

  function logSweepLine({ trigger, candidateCount, tally, fetchTally, kanaele, buch, erschoepft, abschluesse, elReifung }) {
    console.log(
      `[cost-truing] sweep trigger=${trigger} kandidaten=${candidateCount} ` +
        `gemessen=${tally.measured} unvollstaendig=${tally.incomplete} ` +
        `ohne_schaetzung=${tally.noEstimate} ` +
        `unbestimmt=${tally.unavailable} uebersprungen=${tally.skippedCalls} ` +
        `anfragen=${fetchTally.requests} seiten=${fetchTally.pages} ` +
        `pool=${fetchTally.records} vollstaendig=${fetchTally.incompletePools === 0} ` +
        `kanaele=${kanaele} ${buch.zeile} erschoepft=${erschoepft} abschluesse=${zaehlListe(abschluesse)} ` +
        `el_reifung=${zaehlListe(elReifung.ergebnisse)} el_abweichung=${elReifung.abweichungen} el_uebrig=${elReifung.uebrig}`,
    );
  }

  async function reportFetchVolume(fetchTally, nowMs) {
    if (fetchTally.requests <= SWEEP_REQUESTS_WARN_THRESHOLD) return;
    await emitFinding(
      COST_TRUING_FINDING.REQUESTS_ABOVE_THRESHOLD,
      `anfragen=${fetchTally.requests} schwelle=${SWEEP_REQUESTS_WARN_THRESHOLD}`,
      nowMs,
    );
  }

  async function sweepAllCandidates(trigger) {
    const nowMs = now();
    const candidates = store.load().calls.filter((c) => isTruingCandidate(c, nowMs));
    const controls = costRecordControlsFor(candidates);
    const retrievable = candidates.filter((c) => isRetrievable(c, controls.get(c.provider)));
    const skippedCalls = candidates.length - retrievable.length;
    const messbar = retrievable.filter((call) => versucheUebrig(call, config.billing));
    const elReifung = await reifeElBelege({ candidates, store, elKostenRead, billing: config.billing, nowMs });
    const { pools, fetchTally } = await fetchCostRecordPools(messbar, controls);
    const tally = { measured: 0, incomplete: 0, noEstimate: 0, unavailable: 0, skippedCalls, failed: 0 };
    const sammler = { tally, ttsWarnungen: [], abschluesse: [], nowMs };
    for (const call of messbar) trueOneCall(call, pools.get(call.provider), sammler);
    schliesseFaelligeOffene(candidates, sammler, { store, config });
    const coverage = coverageBreakdown(store.load(), nowMs);
    const coveragePercent = percentFromBreakdown(coverage);
    const buch = kostenBuchBericht({ state: store.load(), billing: config.billing, nowMs, deckungFensterMs: PROVIDER_COST_RECORD_WINDOW_MS });
    const kanaele = alarmKanalZeile(betreiberAlarmKanaele({ billing: config.billing, mail: config.mail }));
    logSweepLine({ trigger, candidateCount: candidates.length, tally, fetchTally, kanaele, buch, erschoepft: retrievable.length - messbar.length, abschluesse: sammler.abschluesse, elReifung });
    await reportFetchVolume(fetchTally, nowMs);
    for (const warnung of sammler.ttsWarnungen) await reportTtsQuotaFinding(warnung, nowMs);
    await reportCoverage(coveragePercent, coverage, nowMs);
    for (const befund of buch.befunde) await emitFinding(befund.code, befund.detail, nowMs);
    await reportTariffDrift(store.load(), nowMs);
    return {
      skipped: false,
      candidates: candidates.length,
      coveragePercent,
      coverageNoEstimate: coverage.noEstimate,
      coverageNeverAnswered: coverage.neverAnswered,
      coverageOutsideWindow: coverage.outsideWindow,
      ...tally,
    };
  }

  async function runCostTruingSweep({ trigger }) {
    if (sweepRunning) {
      console.log(`[cost-truing] Lauf laeuft bereits - trigger=${trigger} verworfen (No-op)`);
      return { skipped: true, reason: SWEEP_RUNNING_REASON };
    }
    sweepRunning = true;
    try {
      return await sweepAllCandidates(trigger);
    } finally {
      sweepRunning = false;
    }
  }

  return { runCostTruingSweep };
}
