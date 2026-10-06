import {
  createCall, recordCallCostTruingResult, applyCostCorrectionCents, recordRelayTtsCharacters,
  markCrossCheckAttempted, recordCallCostEvidence, callCostEvidence,
  schliesseKostenAbgleich, oeffneKostenAbgleichErneut,
} from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { config as prodDefaults } from "../src/config.js";

const MS_PER_MINUTE = 60 * 1000;

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
    recordRelayTtsCharacters(tenantId, chars, nowIso) {
      return recordRelayTtsCharacters(state, { tenantId, chars, cfg: billing, nowIso }).warning;
    },
    markCostCrossCheckAttempted(monthKey) {
      markCrossCheckAttempted(state, monthKey);
    },
    recordCallCostEvidence(eingabe) {
      return recordCallCostEvidence(state, eingabe);
    },
    callCostEvidence(callId) {
      return callCostEvidence(state, callId);
    },
    schliesseKostenAbgleich(callId, eingabe) {
      const { call, changed } = schliesseKostenAbgleich(state, callId, eingabe);
      if (changed) writes.push({ callId, ...eingabe });
      return call;
    },
    oeffneKostenAbgleichErneut(callId) {
      const { call } = oeffneKostenAbgleichErneut(state, callId);
      return call;
    },
    withStoreLock(fn) { return Promise.resolve().then(fn); },
    save() {},
  };
}

export function fakeConfig(overrides = {}) {
  return withConfigNamespaces({
    costTruingDelayMinutes: 180,
    costTruingMaxAttempts: 5,
    costTruingRequiredRecordTypes: [],
    costTruingMinCoveragePercent: 80,
    costTruingCoverageStallSweeps: 8,
    elEvidenceMinAgeMinutes: prodDefaults.billing.elEvidenceMinAgeMinutes,
    kostenHeartbeatFensterH: prodDefaults.billing.kostenHeartbeatFensterH,
    costTruingSweepIntervalMs: prodDefaults.billing.costTruingSweepIntervalMs,
    costDriftWarnPercent: 50,
    costAlertDebounceMs: 24 * 60 * 60 * 1000,
    voiceTariffDomesticCents: 20,
    voiceTariffDefaultCents: 300,
    voiceTariffDomesticPrefixes: ["+49", "+33", "+44"],
    providerToBucketRateMicro: 1_000_000,
    costCalibrationMinSamples: 20,
    platformAlertSmsTo: "",
    outageAlertDebounceMs: prodDefaults.billing.outageAlertDebounceMs,
    outageAlertRetryMs: prodDefaults.billing.outageAlertRetryMs,
    platformAlertMailTo: "",
    ttsCharacterQuota: 39981,
    ttsCharacterQuotaWarnPercent: 75,
    ttsQuotaCycleAnchorDay: 3,
    ...overrides,
  });
}

export function isoMinutesAgo(nowMs, minutes) {
  return new Date(nowMs - minutes * MS_PER_MINUTE).toISOString();
}

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
export const makeDueInboundCall = (state, opts = {}) => makeDueCall(state, { ...opts, direction: "inbound" });

export function fakeVoiceControl(byProvider) {
  return (provider) => {
    const impl = byProvider[provider];
    if (!impl) throw new Error(`Provider '${provider}' fuer Port 'voiceControl' nicht unterstuetzt`);
    return impl;
  };
}

export function fakeSpies() {
  const mailCalls = [];
  const smsCalls = [];
  const mailer = { async sendMail(args) { mailCalls.push(args); } };
  const messaging = () => ({ async sendSms(args) { smsCalls.push(args); } });
  return { mailCalls, smsCalls, mailer, messaging };
}

const BAIT_LEG_ID = "0bad0bad-0bad-11f1-0bad-0bad0bad0bad0";
export const MEASURED_PAGE_SIZE = 50;
export const NEVER_LAST_PAGE_TOTAL = 99;

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

export function measuredSipTrunkingRecord({ at, sessionId, callControlId = null, sipCallId = undefined, cost = "0.0401", billedSec = 60 }) {
  const record = {
    record_type: "sip-trunking",
    cost,
    currency: "USD",
    telnyx_session_id: sessionId,
    telnyx_leg_id: BAIT_LEG_ID,
    started_at: at,
    finished_at: at,
    billed_sec: billedSec,
  };
  if (callControlId) record.call_control_id = callControlId;
  if (sipCallId) record.sip_call_id = sipCallId;
  return record;
}

export function foreignSipTrunkingPage({ at, idPrefix, totalPages }) {
  const data = Array.from({ length: MEASURED_PAGE_SIZE }, (_, i) =>
    measuredSipTrunkingRecord({ at, callControlId: `${idPrefix}_${i}`, sessionId: `sess_${idPrefix}_${i}` }));
  return {
    data,
    meta: { total_results: MEASURED_PAGE_SIZE * totalPages, total_pages: totalPages, page_size: MEASURED_PAGE_SIZE },
  };
}
