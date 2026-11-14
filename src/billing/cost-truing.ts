import {
  COST_TRUING_SOURCE,
  MICRO_CENTS_PER_CENT,
  isBookableCents,
  isProviderMicroCents,
  istBeweisendeHerkunft,
} from "../begriffe/abrechnung.js";
import { MAX_CALL_DURATION_CAP_S } from "../begriffe/anrufe.js";
import { MS_PER_DAY, MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.js";
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
} from "./cost-calibration.ts";
import { istBekanntesKostenprofil, kostenprofilFuerAnruf, pflichttypenFuerProfil } from "./kostenarten.js";
import { schreibeSweepKostenbeleg } from "./sweep-kostenbeleg.ts";
import { legRefOfCall } from "./call-leg-ref.ts";
import { kostenBuchBericht, istBuchBefundCode } from "./kosten-deckung.ts";
import { ABSCHLUSS_GRUND, abschlussFuerAnruf, faelligkeitsfensterMs, LEERE_LISTE, zaehlListe } from "./kosten-abschluss.ts";
import { settlementProjektion } from "./kosten-projektion.ts";
import { reifeElBelege } from "./el-reifung.ts";
import type { AbschlussAnruf, AbschlussBeleg } from "./kosten-abschluss.ts";

interface KostenAnruf extends AbschlussAnruf {
  id: string;
  tenantId: string;
  provider: string;
  to: string;
  from: string;
  startedAt: string;
  endedAt: string;
  answeredAt: string | null;
  costTruedAt: string | null;
  estimatedCostCents: number | null;
  actualCostMicroCents: number;
  costTruedSource: string | null;
  twilioSid?: string | null | undefined;
  callControlId?: string | null | undefined;
}

interface KostenBeleg extends AbschlussBeleg {
  callId: string;
  betragMikroCents: number;
  versuche?: number | undefined;
}

interface Zustand {
  calls: KostenAnruf[];
  callCostEvidence: KostenBeleg[];
}

interface Detailsatz {
  recordType: string;
  costMicroCents: number;
  billedSec: number;
  ttsCharacters: number;
}

interface Belegabruf {
  ok?: boolean;
  complete?: boolean;
  reason?: string;
  requests?: number;
  pages?: number;
  raw?: unknown[];
  records?: Detailsatz[] | undefined;
}

interface Kostensteuerung {
  fetchCostRecordPool(auswahl: { since: string | undefined }): Promise<Belegabruf>;
  assignCostRecords(pool: Belegabruf, bein: { legId: string | null; startedAt: string; endedAt: string }): Belegabruf;
}

interface TtsWarnung {
  exhausted: boolean;
  characters: number;
  quota: number;
  cycleKey: string;
}

interface Projektion {
  summeMikroCents: number | null;
  vollBelegt: boolean;
}

interface Speicher {
  withStoreLock<T>(arbeit: () => T | Promise<T>): Promise<T>;
  load(): Zustand;
  save(): void;
  callCostEvidence(callId: string): KostenBeleg[];
  recordCallCostEvidence(eintrag: Record<string, unknown>): unknown;
  schliesseKostenAbgleich(callId: string, ergebnis: { closedAt: string; source: string | null; actualCostMicroCents: number | null }): unknown;
  applyCostCorrectionCents(tenantId: string, korrektur: {
    actualCostMicroCents: number | null;
    estimatedCostCents: number | null;
    providerToBucketRateMicro: number;
    dataComplete: boolean;
    chargeAnchors: unknown;
  }): { booked: boolean; deltaCents: number };
  recordRelayTtsCharacters(tenantId: string, zeichen: number, zeitIso: string): TtsWarnung | null | undefined;
  recordCallCostTruingResult(callId: string, ergebnis: { source: string | null; actualCostMicroCents: number | null; closedAt: string | null }): unknown;
}

type Abrechnung = Parameters<typeof tarifpaarReport>[0]["billing"] & {
  costTruingDelayMinutes: number;
  costTruingMaxAttempts: number;
  costTruingMinCoveragePercent: number;
  costTruingSweepIntervalMs: number;
  costTruingCoverageStallSweeps: number;
  costTruingRequiredRecordTypes: string[];
  costAlertDebounceMs: number;
  costSettleDeadlineHours: number;
  kostenHeartbeatFensterH: number;
  elEvidenceMinAgeMinutes: number;
};

interface Konfiguration {
  billing: Abrechnung;
  mail: unknown;
}

interface Sammler {
  ttsWarnungen: TtsWarnung[];
  abschluesse: string[];
  nowMs: number;
}

interface Messung {
  actualCostMicroCents: number;
  source: string;
  billedSecTotal: number;
  ttsCharacters: number;
}

interface Abdeckung {
  eligible: number;
  proven: number;
  noEstimate: number;
  neverAnswered: number;
  outsideWindow: number;
}

interface Zaehlwerk {
  measured: number;
  incomplete: number;
  noEstimate: number;
  unavailable: number;
  skippedCalls: number;
  failed: number;
}

interface Abrufzaehler {
  requests: number;
  pages: number;
  records: number;
  incompletePools: number;
}

interface Abrufstatistik {
  requests: number;
  pages: number;
  records: number;
  incomplete: boolean;
}

interface Abrufergebnis {
  control: Kostensteuerung | null | undefined;
  pool: Belegabruf;
  stats: Abrufstatistik;
}

interface Alarmmarke {
  firstSeenAt: string;
}

type Sweepergebnis =
  | { skipped: true; reason: string }
  | ({
      skipped: false;
      candidates: number;
      coveragePercent: number;
      coverageNoEstimate: number;
      coverageNeverAnswered: number;
      coverageOutsideWindow: number;
    } & Zaehlwerk);

const kostenprofilVon: (call: KostenAnruf) => string = kostenprofilFuerAnruf;
const nextAttemptOf: (call: KostenAnruf) => number = nextCostTruingAttempt;
const closeAlertOf: (state: Zustand, auswahl: { code: string; nowMs: number }) => unknown = closeOutageAlert;
const openAlertOf: (state: Zustand, code: string) => Alarmmarke | null | undefined = openOutageAlert;
const pflichttypenFuer: (profil: string, envPflichttypen: string[]) => string[] = pflichttypenFuerProfil;
const kanalZeileVon: (kanaele: unknown) => string = alarmKanalZeile;

type Auditschreiber = (ereignis: string, ziel: null, zeile: string) => unknown;
type Befundmelder = (code: string, detail: string, nowMs: number) => Promise<void>;

export const SWEEP_TRIGGER = Object.freeze({ INTERVAL: "interval", MANUAL: "manual" });

const PERCENT_BASE = 100;
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
const kostenBucket = (code: string): string => `${KOSTEN_BUCKET_PREFIX}${code}`;

const COVERAGE_FINDING_CODES = Object.freeze([
  COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD,
  COST_TRUING_FINDING.COVERAGE_STALLED,
]);

const VOLL_BEFUND_CODES = new Set<string>([...COVERAGE_FINDING_CODES, COST_TRUING_FINDING.TARIFPAAR_UNTERSCHAETZT]);

const COST_TRUING_RECOVERED_EVENT = "cost_truing_erholt";

function coverageDetail(coveragePercent: number, minCoveragePercent: number, seitIso: string): string {
  return `deckung=${String(coveragePercent)}% schwelle=${String(minCoveragePercent)}% seit=${seitIso}`;
}

function coverageStallMs(stallSweeps: number, sweepIntervalMs: number): number {
  return stallSweeps * sweepIntervalMs;
}

async function closeCoverageBefunde(store: Speicher, audit: Auditschreiber, nowMs: number): Promise<void> {
  const geschlossen = await store.withStoreLock(() => {
    const state = store.load();
    return COVERAGE_FINDING_CODES
      .map((code) => closeAlertOf(state, { code: kostenBucket(code), nowMs }))
      .filter(Boolean).length;
  });
  store.save();
  if (geschlossen === 0) return;
  const zeile = `marker=${String(geschlossen)}`;
  console.log(`[cost-truing] erholt ${zeile}`);
  audit(COST_TRUING_RECOVERED_EVENT, null, zeile);
}

function abschlussNachMessung({ call, measured, records = [], sweepTraegerErledigt, sammler, store, config }: {
  call: KostenAnruf;
  measured: Messung | null;
  records?: Detailsatz[] | undefined;
  sweepTraegerErledigt: boolean;
  sammler: Sammler;
  store: Speicher;
  config: Konfiguration;
}) {
  if (measured) schreibeSweepKostenbeleg({ store, call, measured, records });
  return abschlussFuerAnruf({
    call, belege: store.callCostEvidence(call.id), nowMs: sammler.nowMs,
    deadlineMs: faelligkeitsfensterMs(config.billing), sweepTraegerErledigt,
  });
}

function meldeAbschluss(
  call: KostenAnruf,
  abschluss: { grund: string; endzustand: string; fehlend: string[] },
  sammler: Sammler,
): void {
  console.log(
    `[cost-truing] abschluss call=${call.id} zustand=${abschluss.endzustand} ` +
      `grund=${abschluss.grund} fehlend=${abschluss.fehlend.join(",") || LEERE_LISTE}`,
  );
  sammler.abschluesse.push(abschluss.endzustand);
}

function schliesseFaelligeOffene(candidates: KostenAnruf[], sammler: Sammler, { store, config }: { store: Speicher; config: Konfiguration }): void {
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
export const PROVIDER_COST_RECORD_WINDOW_MS = PROVIDER_COST_RECORD_WINDOW_DAYS * MS_PER_DAY;

const isEndedCall = (call: KostenAnruf): boolean => !!call.endedAt;
const providerLegIdOf = legRefOfCall;

const pflichttypenVon = (call: KostenAnruf, billing: Abrechnung): string[] =>
  pflichttypenFuer(kostenprofilVon(call), billing.costTruingRequiredRecordTypes);

const versucheUebrig = (call: KostenAnruf, billing: Abrechnung): boolean => nextCostTruingAttempt(call) <= billing.costTruingMaxAttempts;

const isRetrievable = (call: KostenAnruf, control: Kostensteuerung | null | undefined): boolean => control !== null && providerLegIdOf(call) !== null;

const nonNegativeCount = (count: number | undefined): number =>
  count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : 0;

const sweepDarfKorrigieren = (call: KostenAnruf, projektion: Projektion): boolean =>
  isBookableCents(call.estimatedCostCents) &&
  isProviderMicroCents(projektion.summeMikroCents) &&
  istBekanntesKostenprofil(kostenprofilFuerAnruf(call));

function setteleAnruf({ call, projektion, store, config }: { call: KostenAnruf; projektion: Projektion; store: Speicher; config: Konfiguration }): void {
  if (!sweepDarfKorrigieren(call, projektion)) return;
  const { booked, deltaCents } = store.applyCostCorrectionCents(call.tenantId, {
    actualCostMicroCents: projektion.summeMikroCents,
    estimatedCostCents: call.estimatedCostCents,
    providerToBucketRateMicro: config.billing.providerToBucketRateMicro,
    dataComplete: projektion.vollBelegt,
    chargeAnchors: chargeAnchorsOfCall(call),
  });
  console.log(`[cost-truing] korrektur call=${call.id} delta_eur_cent=${String(deltaCents)} gebucht=${String(booked)}`);
}

function herkunftOhneMessung(projektion: Projektion): string | null {
  if (projektion.summeMikroCents === null) return null;
  return projektion.vollBelegt
    ? COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG
    : COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG;
}

async function meldeTarifpaar({ state, eigenCentJeAnruf, billing, emitFinding, nowMs }: {
  state: Zustand;
  eigenCentJeAnruf: Map<string, number> | null;
  billing: Abrechnung;
  emitFinding: Befundmelder;
  nowMs: number;
}): Promise<void> {
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

const endedAtMs = (call: KostenAnruf): number | null => {
  const ms = Date.parse(call.endedAt);
  return Number.isFinite(ms) ? ms : null;
};

function coverageBucketOf(call: KostenAnruf, nowMs: number): string {
  if (!call.answeredAt) return COVERAGE_BUCKET.NEVER_ANSWERED;
  if (!isBookableCents(call.estimatedCostCents)) return COVERAGE_BUCKET.NO_ESTIMATE;
  const endedMs = endedAtMs(call);
  if (endedMs === null || nowMs - endedMs > PROVIDER_COST_RECORD_WINDOW_MS)
    return COVERAGE_BUCKET.OUTSIDE_WINDOW;
  return COVERAGE_BUCKET.ELIGIBLE;
}

function coverageBreakdown(state: Zustand | null | undefined, nowMs: number): Abdeckung {
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

function percentFromBreakdown({ eligible, proven }: Pick<Abdeckung, "eligible" | "proven">): number {
  return eligible === 0 ? 0 : Math.floor((proven * PERCENT_BASE) / eligible);
}

const POOL_SINCE_MARGIN_FACTOR = 12;
const POOL_SINCE_MARGIN_MS = POOL_SINCE_MARGIN_FACTOR * MAX_CALL_DURATION_CAP_S * MS_PER_SECOND;

function poolSinceFor(candidates: KostenAnruf[]): string | undefined {
  let oldestMs = null;
  for (const call of candidates) {
    const ms = endedAtMs(call);
    if (ms !== null && (oldestMs === null || ms < oldestMs)) oldestMs = ms;
  }
  return oldestMs === null ? undefined : new Date(oldestMs - POOL_SINCE_MARGIN_MS).toISOString();
}

export function costTruingCoveragePercent(state: Zustand | null | undefined, nowMs = Date.now()): number {
  return percentFromBreakdown(coverageBreakdown(state, nowMs));
}

export function ohneBeweiskraft(source: string | null): string | null {
  return istBeweisendeHerkunft(source) ? COST_TRUING_SOURCE.INCOMPLETE : source;
}

export function makeCostTruing({ store, config, voiceControl, audit, messaging, mailer, elKostenRead = null, eigenCentJeAnruf = null, now = Date.now }: {
  store: Speicher;
  config: Konfiguration;
  voiceControl: (provider: string) => Kostensteuerung;
  audit: Auditschreiber;
  messaging: unknown;
  mailer: unknown;
  elKostenRead?: Parameters<typeof reifeElBelege>[0]["elKostenRead"];
  eigenCentJeAnruf?: Map<string, number> | null;
  now?: () => number;
}): { runCostTruingSweep(auswahl: { trigger: string }): Promise<Sweepergebnis> } {
  let sweepRunning = false;

  const lastFindingMs = new Map<string, number>();

  function isTruingCandidate(call: KostenAnruf, nowMs: number): boolean {
    if (!isEndedCall(call) || call.costTruedAt !== null) return false;
    const endedMs = endedAtMs(call);
    if (endedMs === null) return false;
    return nowMs - endedMs >= config.billing.costTruingDelayMinutes * MS_PER_MINUTE;
  }

  function sumRecordMicroCents(records: (Detailsatz | null | undefined)[]): number | null {
    let total = 0;
    for (const record of records) {
      const betrag = record?.costMicroCents;
      if (betrag === undefined || !Number.isSafeInteger(betrag) || betrag < 0) return null;
      total += betrag;
      if (!Number.isSafeInteger(total)) return null;
    }
    return total;
  }

  function sumIntegerField(records: (Detailsatz | null | undefined)[], field: "billedSec" | "ttsCharacters"): number {
    return records.reduce((sum, record) => {
      const wert = record?.[field];
      return sum + (wert !== undefined && Number.isSafeInteger(wert) && wert > 0 ? wert : 0);
    }, 0);
  }

  function classifyRecords(records: Detailsatz[] | undefined, requiredRecordTypes: string[]): Messung | null {
    if (!Array.isArray(records) || records.length === 0) return null;
    const total = sumRecordMicroCents(records);
    if (total === null) return null;
    const found = new Set(records.map((record) => record.recordType));
    const complete = requiredRecordTypes.length > 0 && requiredRecordTypes.every((type) => found.has(type));
    return {
      actualCostMicroCents: total,
      source: complete ? COST_TRUING_SOURCE.DETAIL_RECORDS : COST_TRUING_SOURCE.INCOMPLETE,
      billedSecTotal: sumIntegerField(records, "billedSec"),
      ttsCharacters: sumIntegerField(records, "ttsCharacters"),
    };
  }

  function warnOnCostDrift(call: KostenAnruf, actualMicroCents: number): void {
    const estimateCents = call.estimatedCostCents;
    if (estimateCents === null || !Number.isSafeInteger(estimateCents) || estimateCents <= 0) return;
    const estimateMicroCents = estimateCents * MICRO_CENTS_PER_CENT;
    const deviationPercent = Math.floor(
      (Math.abs(actualMicroCents - estimateMicroCents) * PERCENT_BASE) / estimateMicroCents,
    );
    if (deviationPercent <= config.billing.costDriftWarnPercent) return;
    console.warn(
      `[cost-truing] Kosten-Drift call=${call.id} ist_usd_mikrocent=${String(actualMicroCents)} ` +
        `schaetzung_eur_cent=${String(estimateCents)} abweichung=${String(deviationPercent)}%`,
    );
  }

  function shouldEmitFinding(key: string, nowMs: number): boolean {
    const last = lastFindingMs.get(key);
    if (last !== undefined && nowMs - last < config.billing.costAlertDebounceMs) return false;
    lastFindingMs.set(key, nowMs);
    return true;
  }

  async function emitFinding(code: string, detail: string, nowMs: number): Promise<void> {
    const voll = VOLL_BEFUND_CODES.has(code) || istBuchBefundCode(code);
    if (!voll && !shouldEmitFinding(code, nowMs)) return;
    const zeile = `grund=${code} ${detail}`;
    console.warn(`[cost-truing] Befund ${zeile}`);
    const meldung = { store, config, audit, messaging, mailer, bucket: kostenBucket(code), aktion: COST_TRUING_AUDIT_EVENT, zeile, nowMs };
    if (voll) await meldeVollBefund(meldung);
    else await meldeBetreiberNotiz(meldung);
  }

  async function reportCoverage(coveragePercent: number, coverage: Abdeckung, nowMs: number): Promise<void> {
    const min = config.billing.costTruingMinCoveragePercent;
    console.log(
      `[cost-truing] deckung=${String(coveragePercent)}% schwelle=${String(min)}% ` +
        `ohne_schaetzung=${String(coverage.noEstimate)} nie_beantwortet=${String(coverage.neverAnswered)} ` +
        `ausserhalb_fenster=${String(coverage.outsideWindow)}`,
    );
    if (coveragePercent >= min) {
      await closeCoverageBefunde(store, audit, nowMs);
      return;
    }
    const marker = openAlertOf(store.load(), kostenBucket(COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD));
    const seitIso = marker ? marker.firstSeenAt : new Date(nowMs).toISOString();
    const detail = coverageDetail(coveragePercent, min, seitIso);
    await emitFinding(COST_TRUING_FINDING.COVERAGE_BELOW_THRESHOLD, detail, nowMs);
    const stallMs = coverageStallMs(config.billing.costTruingCoverageStallSweeps, config.billing.costTruingSweepIntervalMs);
    if (nowMs - Date.parse(seitIso) < stallMs) return;
    await emitFinding(COST_TRUING_FINDING.COVERAGE_STALLED, detail, nowMs);
  }

  function outcomeKey(truedSource: string | null, closed: boolean): keyof Zaehlwerk {
    if (truedSource === COST_TRUING_SOURCE.UNAVAILABLE) return closed ? "failed" : "unavailable";
    if (istBeweisendeHerkunft(truedSource)) return "measured";
    if (truedSource === COST_TRUING_SOURCE.NO_ESTIMATE) return "noEstimate";
    return "incomplete";
  }

  function truedSourceOf({ call, measured, projektion, abschluss }: {
    call: KostenAnruf;
    measured: Messung;
    projektion: Projektion;
    abschluss: { geschlossen: boolean; grund?: string };
  }): string | null {
    if (!isBookableCents(call.estimatedCostCents)) return projektion.vollBelegt ? COST_TRUING_SOURCE.NO_ESTIMATE : ohneBeweiskraft(measured.source);
    if (projektion.vollBelegt) return COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG;
    if (abschluss.grund === ABSCHLUSS_GRUND.FRIST) return COST_TRUING_SOURCE.KOSTENBUCH_TEILBELEG;
    return ohneBeweiskraft(measured.source);
  }

  function projektionVon(call: KostenAnruf): Projektion {
    return settlementProjektion({ call, belege: store.callCostEvidence(call.id) });
  }

  function bookTtsCharactersFor(call: KostenAnruf, measured: Messung, sammler: Sammler): void {
    if (measured.ttsCharacters <= 0) return;
    const nowMs = now();
    const warnung = store.recordRelayTtsCharacters(call.tenantId, measured.ttsCharacters, new Date(nowMs).toISOString());
    if (warnung) sammler.ttsWarnungen.push(warnung);
  }

  async function reportTtsQuotaFinding(warning: TtsWarnung, nowMs: number): Promise<void> {
    const code = warning.exhausted
      ? COST_TRUING_FINDING.TTS_QUOTA_EXHAUSTED
      : COST_TRUING_FINDING.TTS_QUOTA_WARN_THRESHOLD;
    await emitFinding(code, `zeichen=${String(warning.characters)}/${String(warning.quota)} zyklus=${warning.cycleKey}`, nowMs);
  }

  function poolFetchStats(pool: Belegabruf | null | undefined): Abrufstatistik {
    return {
      requests: nonNegativeCount(pool?.requests), pages: nonNegativeCount(pool?.pages),
      records: Array.isArray(pool?.raw) ? pool.raw.length : 0,
      incomplete: !(pool?.ok === true && pool.complete !== false),
    };
  }

  function emptyFetchTally(): Abrufzaehler {
    return { requests: 0, pages: 0, records: 0, incompletePools: 0 };
  }

  function addPoolFetchStats(fetchTally: Abrufzaehler, stats: Abrufstatistik): Abrufzaehler {
    return {
      requests: fetchTally.requests + stats.requests,
      pages: fetchTally.pages + stats.pages,
      records: fetchTally.records + stats.records,
      incompletePools: fetchTally.incompletePools + (stats.incomplete ? 1 : 0),
    };
  }

  function costRecordControlFor(provider: string): Kostensteuerung | null {
    let control: Kostensteuerung;
    try {
      control = voiceControl(provider);
    } catch {
      return null;
    }
    const hasCostRecordMethods =
      typeof control.fetchCostRecordPool === "function" && typeof control.assignCostRecords === "function";
    return hasCostRecordMethods ? control : null;
  }

  function costRecordControlsFor(candidates: KostenAnruf[]): Map<string, Kostensteuerung | null> {
    const controls = new Map<string, Kostensteuerung | null>();
    for (const call of candidates)
      if (!controls.has(call.provider)) controls.set(call.provider, costRecordControlFor(call.provider));
    return controls;
  }

  function bookablePool(pool: Belegabruf | null | undefined): Belegabruf {
    if (!pool?.ok) return pool ?? { ok: false };
    return pool.complete === false ? { ok: false, reason: POOL_INCOMPLETE_REASON } : pool;
  }

  async function fetchCostRecordPoolFor(control: Kostensteuerung | null | undefined, since: string | undefined): Promise<Abrufergebnis> {
    try {
      const answer = await control?.fetchCostRecordPool({ since });
      return { control, pool: bookablePool(answer), stats: poolFetchStats(answer) };
    } catch {
      return { control, pool: { ok: false }, stats: poolFetchStats(null) };
    }
  }

  async function fetchCostRecordPools(retrievable: KostenAnruf[], controls: Map<string, Kostensteuerung | null>): Promise<{ pools: Map<string, Abrufergebnis>; fetchTally: Abrufzaehler }> {
    const since = poolSinceFor(retrievable);
    const pools = new Map<string, Abrufergebnis>();
    let fetchTally = emptyFetchTally();
    for (const call of retrievable) {
      if (pools.has(call.provider)) continue;
      const fetched = await fetchCostRecordPoolFor(controls.get(call.provider), since);
      pools.set(call.provider, fetched);
      fetchTally = addPoolFetchStats(fetchTally, fetched.stats);
    }
    return { pools, fetchTally };
  }

  function trueOneCall(call: KostenAnruf, { control, pool = { ok: false } }: Partial<Abrufergebnis> = {}, sammler: Sammler): keyof Zaehlwerk {
    const legId = providerLegIdOf(call);
    let result: Belegabruf | undefined;
    try {
      result = pool.ok
        ? control?.assignCostRecords(pool, { legId, startedAt: call.startedAt, endedAt: call.endedAt })
        : pool;
    } catch {
      result = { ok: false };
    }

    const measured = result?.ok
      ? classifyRecords(result.records, pflichttypenVon(call, config.billing))
      : null;
    const attempt = nextAttemptOf(call);
    const sweepTraegerErledigt = measured !== null || attempt >= config.billing.costTruingMaxAttempts;
    const abschluss = abschlussNachMessung({
      call,
      measured,
      records: result?.records,
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
    if (closed) meldeAbschluss(call, abschluss, sammler);
    return outcomeKey(truedSource, closed);
  }

  function alertDrift(entry: Parameters<typeof driftLine>[0], nowMs: number): void {
    if (!shouldEmitFinding(`${entry.prefix} ${String(entry.code)}`, nowMs)) return;
    const detail = driftLine(entry);
    console.warn(`[cost-truing] Tarif-Drift ${detail}`);
    audit(TARIFF_DRIFT_AUDIT_EVENT, null, detail);
    sendBootstrapAlertSms({ config, prefix: DRIFT_ALERT_SMS_PREFIX, detail, logTag: "cost-truing" });
  }

  async function reportTariffDrift(state: Zustand, nowMs: number): Promise<void> {
    const report = tariffDriftReportFromConfig(state.calls, config.billing);
    console.log(`[cost-truing] tarif-drift ${report.map(driftLine).join(" | ")}`);
    for (const entry of alertableDriftFindings(report)) alertDrift(entry, nowMs);
    await meldeTarifpaar({ state, eigenCentJeAnruf, billing: config.billing, emitFinding, nowMs });
  }

  function logSweepLine({ trigger, candidateCount, tally, fetchTally, kanaele, buch, erschoepft, abschluesse, elReifung }: {
    trigger: string;
    candidateCount: number;
    tally: Zaehlwerk;
    fetchTally: Abrufzaehler;
    kanaele: string;
    buch: { zeile: string };
    erschoepft: number;
    abschluesse: string[];
    elReifung: Awaited<ReturnType<typeof reifeElBelege>>;
  }): void {
    console.log(
      `[cost-truing] sweep trigger=${trigger} kandidaten=${String(candidateCount)} ` +
        `gemessen=${String(tally.measured)} unvollstaendig=${String(tally.incomplete)} ` +
        `ohne_schaetzung=${String(tally.noEstimate)} ` +
        `unbestimmt=${String(tally.unavailable)} uebersprungen=${String(tally.skippedCalls)} ` +
        `anfragen=${String(fetchTally.requests)} seiten=${String(fetchTally.pages)} ` +
        `pool=${String(fetchTally.records)} vollstaendig=${String(fetchTally.incompletePools === 0)} ` +
        `kanaele=${kanaele} ${buch.zeile} erschoepft=${String(erschoepft)} abschluesse=${zaehlListe(abschluesse)} ` +
        `el_reifung=${zaehlListe(elReifung.ergebnisse)} el_abweichung=${String(elReifung.abweichungen)} el_uebrig=${String(elReifung.uebrig)}`,
    );
  }

  async function reportFetchVolume(fetchTally: Abrufzaehler, nowMs: number): Promise<void> {
    if (fetchTally.requests <= SWEEP_REQUESTS_WARN_THRESHOLD) return;
    await emitFinding(
      COST_TRUING_FINDING.REQUESTS_ABOVE_THRESHOLD,
      `anfragen=${String(fetchTally.requests)} schwelle=${String(SWEEP_REQUESTS_WARN_THRESHOLD)}`,
      nowMs,
    );
  }

  async function sweepAllCandidates(trigger: string): Promise<Sweepergebnis> {
    const nowMs = now();
    const candidates = store.load().calls.filter((call) => isTruingCandidate(call, nowMs));
    const controls = costRecordControlsFor(candidates);
    const retrievable = candidates.filter((call) => isRetrievable(call, controls.get(call.provider)));
    const skippedCalls = candidates.length - retrievable.length;
    const messbar = retrievable.filter((call) => versucheUebrig(call, config.billing));
    const elReifung = await reifeElBelege({ candidates, store, elKostenRead, billing: config.billing, nowMs });
    const { pools, fetchTally } = await fetchCostRecordPools(messbar, controls);
    const tally = { measured: 0, incomplete: 0, noEstimate: 0, unavailable: 0, skippedCalls, failed: 0 };
    const sammler = { ttsWarnungen: [], abschluesse: [], nowMs };
    for (const call of messbar) tally[trueOneCall(call, pools.get(call.provider), sammler)]++;
    schliesseFaelligeOffene(candidates, sammler, { store, config });
    const coverage = coverageBreakdown(store.load(), nowMs);
    const coveragePercent = percentFromBreakdown(coverage);
    const buch = kostenBuchBericht({ state: store.load(), billing: config.billing, nowMs, deckungFensterMs: PROVIDER_COST_RECORD_WINDOW_MS });
    const kanaele = kanalZeileVon(betreiberAlarmKanaele({ billing: config.billing, mail: config.mail }));
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

  async function runCostTruingSweep({ trigger }: { trigger: string }): Promise<Sweepergebnis> {
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
