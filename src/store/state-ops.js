import crypto from "crypto";
import {
  defaultSettingsMap,
  calendarMap,
  emptyUsageMap,
  emptyPlatformTtsUsage,
  emptyCostCrossCheck,
  BOOTSTRAP_TENANT_ID,
  MAX_NOTIFICATIONS,
  WEBHOOK_ANCHOR_HISTORY,
  DEFAULT_PROVIDER,
  PROVIDER,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
  normNum,
  E164,
  NUMBER_STATUS,
  KEY_FACTS_LIMITS,
  CONSULT_STATUS,
  CONSULT_ANSWER,
  CONSULT_WAIT,
  TENANT_STATUS,
  USAGE_EVENT_KIND,
  CENTS_PER_EUR,
  MICRO_CENTS_PER_CENT,
  TOKENS_PER_M_TOK,
  MODEL_PRICE_RATE_FIELDS,
  isBookableCents,
  isCorrectionCents,
  isProviderMicroCents,
  PROVIDER_RATE_SCALE,
  USAGE_CORRUPT_REASON,
  globalCapCents,
  COST_TRUING_SOURCE,
} from "./defaults.js";
import {
  assertCostEvidenceInput,
  buildCostEvidenceRow,
  canSetEvidenceMaturity,
  costEvidenceFortschreibung,
  isTerminalMaturity,
} from "./cost-evidence.js";
import { languageForCountry } from "../i18n/locales.js";
import { planCapCents } from "../billing/plan-caps.js";
import { istBekanntesKostenprofil } from "../billing/kostenarten.js";
import { BRIDGE_STATE, bridgeStateOf } from "../elevenlabs/inbound-bridge-state.js";
import { isKnownPlanSlug } from "../plans.js";
import { isTelnyxSipCallId } from "../telephony/sip-call-id.js";
import { stripResultEvidence, resultCardView } from "../call-result.js";
import { safeEqual } from "../util.js";
import { MEMORY_MAX_CALLS } from "../call-memory.js";
import { MS_PER_DAY, newId, tenantsOf } from "./zustand/grundlagen.js";
export { newId, tenantsOf } from "./zustand/grundlagen.js";
import {
  findTenant,
  applyOwnerIdentity,
  seedBootstrapKyc,
  normalizePrivateNumber,
} from "./zustand/mandant.js";
export {
  numberRecordByE164,
  findTenantByNumber,
  seedBootstrapIdpSubject,
  canTransitionNumber,
  findNumber,
  findTenant,
  applyOwnerIdentity,
  setTenantIdentityIfAbsent,
  setKycLevel,
  seedBootstrapKyc,
  kycReached,
  tenantActiveSubscriber,
  tenantInactive,
  setSuspendedAtIfAbsent,
  clearSuspendedAt,
  tenantSuspendedAt,
  setTenantStripe,
  tenantStripe,
  setTenantSubscription,
  tenantSubscription,
  findTenantBySubscription,
  findTenantByCustomer,
  tenantExists,
  setBillingHold,
  clearBillingHold,
  billingHoldActive,
  normalizePrivateNumber,
  setPrivateNumber,
  tenantPrivateNumber,
  setTenantGeo,
  tenantGeo,
  tenantTimezone,
  failedNumberCount,
  tenantMayRequestNumber,
} from "./zustand/mandant.js";
import {
  usageFor,
  globalUsageTotals,
  inputTokensOf,
  pendingMeterEvents,
  METER_FLUSH_SKIP,
  PLATFORM_TTS_COST_CENTER_ID,
  ttsQuotaExhausted,
  recordTenantTtsCharacters,
} from "./zustand/nutzung.js";
export {
  usageFor,
  usageOf,
  globalUsageTotals,
  inputTokensOf,
  recordUsageEvent,
  dailySmsCount,
  voiceMinutesUsedSince,
  planMinutesExceeded,
  pendingMeterEvents,
  METER_FLUSH_SKIP,
  markMeterEventsSent,
  callCostEvidence,
  PLATFORM_TTS_COST_CENTER_ID,
  ttsQuotaExhausted,
  actualCostMicroCentsForMonth,
  recordTenantTtsCharacters,
} from "./zustand/nutzung.js";
import { settingsFor } from "./zustand/einstellungen.js";
export {
  settingsFor,
  updateSettings,
  resolveProfile,
  bindSubToTenant,
  resolveTenant,
  listProfiles,
  setProfile,
  deleteProfile,
} from "./zustand/einstellungen.js";
export {
  tenantHasLiveNumber,
  markTenantNeedsManualReconcile,
  requestNumber,
  platformNumberBindings,
  openPlatformBindingByPurpose,
  numberBusyReason,
  bindPlatformNumber,
  unbindPlatformNumber,
  unbindOwnPlatformBindings,
  syncPlatformBindings,
  openOutageAlert,
  claimOutageAlert,
  closeOutageAlert,
  transitionNumber,
  beginProvisioning,
  attachNumberPaymentIntent,
  attachNumberRegistration,
  markNumberElInboundTrunkBelegt,
  clearNumberElInboundTrunkBeleg,
  beginCapturing,
  activateNumber,
  failNumber,
  releaseNumber,
  recordProvisioningJob,
  redriveAgeHoldReason,
  classifyQueuedProvisioningJobs,
  RELEASE_VERDICT,
  numberReleaseVerdict,
  classifyNumbersForRelease,
  tenantNumbersForErase,
  setContractEndCleanupPending,
  contractEndCleanupPending,
  tenantsPendingContractEndCleanup,
  platformHoldEscalationCandidates,
  paidWithoutNumberCandidates,
} from "./zustand/nummern.js";

const MS_PER_SECOND = 1000;

export function makeDefaultState() {
  return {
    settings: defaultSettingsMap(),
    calls: [],
    actionItems: [],
    calendar: calendarMap(),
    usage: emptyUsageMap(),
    notifications: [],
    profiles: {},
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: TENANT_STATUS.ACTIVE }],
    numbers: [],
    numberAssignments: [],
    platformNumberUse: [],
    outageAlerts: [],
    provisioningJobs: [],
    tenantBudgets: [],
    usageEvents: [],
    callCostEvidence: [],
    reservations: {},
    platformSpendWarnedMonth: null,
    platformTtsUsage: emptyPlatformTtsUsage(),
    costCrossCheck: emptyCostCrossCheck(),
    anrufpause: false,
    subIndex: {},
  };
}

export async function anrufpauseSetzen(speicher, an) {
  const zustand = speicher.load();
  const vorher = zustand.anrufpause;
  zustand.anrufpause = an;
  try {
    speicher.save();
    await speicher.drainFlushes();
  } catch (err) {
    zustand.anrufpause = vorher;
    throw err;
  }
  return an;
}

function requireTenantId(tenantId) {
  if (!tenantId) throw new Error("createCall: tenantId ist Pflicht (kein Default-Tenant)");
  return tenantId;
}

export function openingLineHash(line) {
  return crypto.createHash("sha256").update(line, "utf8").digest("hex");
}

function ownerMarkierungen({ calleeIsOwner, callerIsOwner }) {
  return { calleeIsOwner: calleeIsOwner === true, callerIsOwner: callerIsOwner === true };
}

export function createCall(
  s,
  {
    direction,
    from,
    to,
    goal,
    openingLine,
    twilioSid,
    briefing,
    constraints,
    context,
    mandate,
    language,
    maxDurationS,
    requestedBy,
    tenantId,
    provider,
    reserveCents,
    diagnostic,
    calleeIsOwner,
    callerIsOwner,
  },
) {
  const call = {
    id: newId("call"),
    streamToken: crypto.randomBytes(16).toString("hex"),
    twilioSid: twilioSid || null,
    provider: provider || DEFAULT_PROVIDER,
    direction,
    from,
    to,
    goal: goal || null,
    openingLine: openingLine || null,
    openingLineSha256: openingLine ? openingLineHash(openingLine) : null,
    briefing: briefing || null,
    constraints: constraints || null,
    context: context || null,
    mandate: mandate || null,
    callerName: null,
    language: language || "de",
    maxDurationS: maxDurationS || null,
    requestedBy: requestedBy || null,
    tenantId: requireTenantId(tenantId),
    status: "active",
    startedAt: new Date().toISOString(),
    answeredAt: null,
    answeredUnclearReason: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    result: null,
    consults: null,
    lookupLog: null,
    elDetectorCounts: null,
    summarySmsSentAt: null,
    summaryMailSentAt: null,
    failureReason: null,
    billedAt: null,
    estimatedCostCents: null,
    estimatedCostSpendMonthKey: null,
    estimatedCostPeriodKey: null,
    actualCostMicroCents: null,
    costTruedAt: null,
    costTruedSource: null,
    costTruingAttempts: 0,
    callControlId: null,
    assistantId: null,
    diagnostic: diagnostic === true,
    ...ownerMarkierungen({ calleeIsOwner, callerIsOwner }),
    reserveCents: reserveCents || 0,
    reserveReleased: false,
    noSpeechStreak: 0,
    consultPolledAtMs: 0,
    telnyxConversationId: null,
    elevenlabsConversationId: null,
    elBoundAt: null, elFallbackAt: null, elNachlaufStartedAt: null,
    sipCallId: null,
    costProfile: null,
    appointmentDate: null,
    appointmentTime: null,
    amount: null,
    currency: null,
    calleeConfirmedTimezone: null,
    calleeConfirmedTimezoneOrigin: null,
    calleeConfirmedTimezoneAt: null,
    callerTurns: 0,
    inboxEntryAt: null,
    inboxSeenAt: null,
    fromActualE164: null,
    fromSource: null,
    fromRegistrationSource: null,
    webhookAnchors: [],
    actionItemIds: [],
  };
  s.calls.unshift(call);
  usageFor(s, call.tenantId).calls++;
  return call;
}

export function getCall(state, id) {
  return state.calls.find((call) => call.id === id || call.twilioSid === id) || null;
}

export function addTranscript(s, callId, role, text) {
  const call = getCall(s, callId);
  if (!call) return false;
  call.transcript.push({ role, text, at: new Date().toISOString() });
  return true;
}

export function purgeTranscript(state, callId) {
  const call = getCall(state, callId);
  if (!call || call.transcript.length === 0) return false;
  call.transcript = [];
  return true;
}

export function tenantCallScope(state, tenantId) {
  const calls = state.calls.filter((call) => call.tenantId === tenantId);
  return { calls, callIds: new Set(calls.map((call) => call.id)) };
}

export function eraseTenantData(s, tenantId) {
  const { calls: targetCalls, callIds } = tenantCallScope(s, tenantId);
  const removed = {
    calls: targetCalls.length,
    transcriptSegments: targetCalls.reduce((sum, c) => sum + c.transcript.length, 0),
    actionItems: 0,
    notifications: 0,
    privateNumber: 0,
  };
  const itemsBefore = s.actionItems.length;
  const notifsBefore = s.notifications.length;
  s.calls = s.calls.filter((c) => !callIds.has(c.id));
  s.actionItems = s.actionItems.filter((a) => !callIds.has(a.callId));
  s.notifications = s.notifications.filter((n) => !callIds.has(n.callId));
  removed.actionItems = itemsBefore - s.actionItems.length;
  removed.notifications = notifsBefore - s.notifications.length;
  const tenant = findTenant(s, tenantId);
  if (tenant && tenant.privateNumber != null) {
    delete tenant.privateNumber;
    removed.privateNumber = 1;
  }
  return removed;
}

export function exportTenantData(state, tenantId) {
  const { calls, callIds } = tenantCallScope(state, tenantId);
  return {
    tenantId,
    exportedAt: new Date().toISOString(),
    privateNumber: findTenant(state, tenantId)?.privateNumber ?? null,
    calls,
    actionItems: state.actionItems.filter((actionItem) => callIds.has(actionItem.callId)),
    notifications: state.notifications.filter((notification) => callIds.has(notification.callId)),
  };
}

function setOnceTimestamp(call, fieldName, atIso = new Date().toISOString()) {
  let changed = false;
  if (call && !call[fieldName]) {
    call[fieldName] = atIso;
    changed = true;
  }
  return { call, changed };
}

export function markAnswered(state, callId) {
  return setOnceTimestamp(getCall(state, callId), "answeredAt");
}

export function trueUpAnsweredAt(state, callId, answeredAtIso) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.answeredAt = answeredAtIso;
  return { call, changed: true };
}

export function setCallEndedAt(s, callId, status, endedAtIso) {
  const call = getCall(s, callId);
  if (!call) return { call: null, changed: false };
  let changed = false;
  if (call.status === "active") {
    call.status = status;
    call.endedAt = endedAtIso;
    changed = true;
    expireOpenConsults(s, callId);
  }
  return { call, changed };
}

export function endCallRecord(state, callId, status = "completed") {
  return setCallEndedAt(state, callId, status, new Date().toISOString());
}

export function markSummarySmsSent(state, callId) {
  return setOnceTimestamp(getCall(state, callId), "summarySmsSentAt");
}

export function markSummaryMailSent(state, callId) {
  return setOnceTimestamp(getCall(state, callId), "summaryMailSentAt");
}

export function markBilled(state, callId) {
  return setOnceTimestamp(getCall(state, callId), "billedAt");
}

function istKanonischerIsoZeitpunkt(wert) {
  if (typeof wert !== "string" || Number.isNaN(Date.parse(wert))) return false;
  return new Date(wert).toISOString() === wert;
}

const markOnceAt = (fieldName) => (state, callId, atIso) => {
  const call = getCall(state, callId);
  if (!istKanonischerIsoZeitpunkt(atIso)) return { call, changed: false };
  return setOnceTimestamp(call, fieldName, atIso);
};

export const markInboundElFallback = markOnceAt("elFallbackAt");

export const markInboundElNachlaufStarted = markOnceAt("elNachlaufStartedAt");

export function bindInboundElConversation(state, callId, { conversationId, nowIso }) {
  const call = getCall(state, callId);
  const eingabeGueltig =
    typeof conversationId === "string" && conversationId !== "" && istKanonischerIsoZeitpunkt(nowIso);
  if (!eingabeGueltig) return { call, changed: false, bound: false };
  const zustand = bridgeStateOf(call);
  if (zustand === BRIDGE_STATE.GEBUNDEN) {
    return { call, changed: false, bound: call.elevenlabsConversationId === conversationId };
  }
  if (zustand !== BRIDGE_STATE.WARTET) return { call, changed: false, bound: false };
  call.elevenlabsConversationId = conversationId;
  call.elBoundAt = nowIso;
  return { call, changed: true, bound: true };
}

export function recordWebhookAnchors(state, callId, anchors) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  const known = call.webhookAnchors ?? [];
  const fresh = anchors.filter((anchor) => !known.includes(anchor));
  if (!fresh.length) return { call, changed: false };
  call.webhookAnchors = [...known, ...fresh].slice(-WEBHOOK_ANCHOR_HISTORY);
  return { call, changed: true };
}

export function markInboxEntry(state, callId, qualifies) {
  if (!qualifies) return { call: null, changed: false };
  return setOnceTimestamp(getCall(state, callId), "inboxEntryAt");
}

export function inboxEntryView(call, actionItemTexts) {
  const summary = call.summary ?? null;
  return {
    call_id: call.id,
    caller: call.from ?? null,
    started_at: call.startedAt ?? null,
    summary,
    summary_unavailable: summary === null,
    ...resultCardView(call.result),
    action_items: actionItemTexts,
    action_required: actionItemTexts.length > 0,
  };
}

function openActionItemTexts(state, callId) {
  return callActionItems(state, callId)
    .filter((item) => !item.done)
    .map((item) => item.text);
}

export function takeInboxEntries(state, tenantId, { limit, includeSeen }) {
  const { calls } = tenantCallScope(state, tenantId);
  const candidates = calls
    .filter((call) => Boolean(call.inboxEntryAt) && (includeSeen || !call.inboxSeenAt))
    .sort((left, right) =>
      left.startedAt < right.startedAt ? -1 : left.startedAt > right.startedAt ? 1 : 0,
    );
  const delivered = candidates.slice(0, limit);
  let marked = 0;
  const entries = delivered.map((call) => {
    const entry = inboxEntryView(call, openActionItemTexts(state, call.id));
    if (!includeSeen && setOnceTimestamp(call, "inboxSeenAt").changed) marked += 1;
    return entry;
  });
  return { entries, remaining: candidates.length - delivered.length, marked };
}

export function chargeAnchorsOfUsage(bucket) {
  return { spendMonthKey: bucket.spendMonthKey, periodKey: bucket.budgetPeriodKey };
}

export function chargeAnchorsOfCall(call) {
  return { spendMonthKey: call.estimatedCostSpendMonthKey, periodKey: call.estimatedCostPeriodKey };
}

export const NO_CHARGE_ANCHORS = Object.freeze({ spendMonthKey: null, periodKey: null });

export function recordCallEstimatedCostCents(state, callId, { costCents, chargeAnchors }) {
  const call = getCall(state, callId);
  if (!call || call.estimatedCostCents !== null || !isBookableCents(costCents))
    return { call: call || null, changed: false };
  call.estimatedCostCents = costCents;
  call.estimatedCostSpendMonthKey = chargeAnchors.spendMonthKey;
  call.estimatedCostPeriodKey = chargeAnchors.periodKey;
  return { call, changed: true };
}

export function nextCostTruingAttempt(call) {
  const attempts = call?.costTruingAttempts;
  return (Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0) + 1;
}

export function recordCallCostTruingResult(state, callId, { source, actualCostMicroCents, closedAt }) {
  const call = getCall(state, callId);
  if (!call || call.costTruedAt !== null || !Object.values(COST_TRUING_SOURCE).includes(source))
    return { call: call || null, changed: false };
  call.costTruingAttempts = nextCostTruingAttempt(call);
  if (isProviderMicroCents(actualCostMicroCents))
    call.actualCostMicroCents = actualCostMicroCents;
  call.costTruedSource = source;
  if (closedAt) call.costTruedAt = closedAt;
  return { call, changed: true };
}

export function schliesseKostenAbgleich(state, callId, { closedAt, source = null, actualCostMicroCents = null }) {
  const call = getCall(state, callId);
  if (!call || call.costTruedAt !== null || !closedAt) return { call: call || null, changed: false };
  if (source !== null && Object.values(COST_TRUING_SOURCE).includes(source)) call.costTruedSource = source;
  if (isProviderMicroCents(actualCostMicroCents)) call.actualCostMicroCents = actualCostMicroCents;
  call.costTruedAt = closedAt;
  return { call, changed: true };
}

export function oeffneKostenAbgleichErneut(state, callId) {
  const call = getCall(state, callId);
  if (!call || call.costTruedAt === null) return { call: call || null, changed: false };
  call.costTruedAt = null;
  return { call, changed: true };
}

export function callStartAnchorMs(call) {
  return Date.parse(call.answeredAt ?? call.startedAt ?? "");
}

function callLimitMs(call, defaultMaxDurationS) {
  return (call.maxDurationS || defaultMaxDurationS) * MS_PER_SECOND;
}

export function remainingMaxDurationMs(call, nowMs, defaultMaxDurationS) {
  const anchor = callStartAnchorMs(call);
  if (Number.isNaN(anchor)) return 0;
  return Math.max(0, callLimitMs(call, defaultMaxDurationS) - (nowMs - anchor));
}

export function classifyCallTime(call, nowMs, defaultMaxDurationS) {
  const remaining = remainingMaxDurationMs(call, nowMs, defaultMaxDurationS);
  return { remaining, expired: remaining <= 0 };
}

export function cappedEndedAtMs(call, nowMs, defaultMaxDurationS) {
  const anchor = callStartAnchorMs(call);
  if (Number.isNaN(anchor)) return 0;
  return Math.min(nowMs, anchor + callLimitMs(call, defaultMaxDurationS));
}

export function carrierEndMsOf(call, nowMs) {
  const nachlaufStartIso = call.elNachlaufStartedAt;
  if (!nachlaufStartIso) return nowMs;
  return Math.min(nowMs, Date.parse(nachlaufStartIso));
}

export function recordFailureReason(state, callId, reason) {
  const call = getCall(state, callId);
  let changed = false;
  if (call && reason && !call.failureReason) {
    call.failureReason = reason;
    changed = true;
  }
  return { call, changed };
}

const recordProviderHandleOnce = (field) => (state, callId, handle) => {
  const call = getCall(state, callId);
  let changed = false;
  if (call && handle && !call[field]) {
    call[field] = handle;
    changed = true;
  }
  return { call, changed };
};

export const recordElevenlabsConversationId = recordProviderHandleOnce(
  "elevenlabsConversationId",
);

const setSipCallIdOnce = recordProviderHandleOnce("sipCallId");

export function recordSipCallId(state, callId, sipCallId) {
  if (sipCallId && !isTelnyxSipCallId(sipCallId)) {
    console.error(
      `[join-schluessel] verworfen grund=keine_telnyx_sip_call_id call=${callId} wert=${sipCallId}`,
    );
    return { call: getCall(state, callId), changed: false };
  }
  return setSipCallIdOnce(state, callId, sipCallId);
}

const setCostProfileOnce = recordProviderHandleOnce("costProfile");

export function recordCostProfile(state, callId, profil) {
  if (!profil) {
    console.warn(`[kostenprofil] fehlt call=${callId} - Anruf entsteht trotzdem, kein Settlement`);
    return { call: getCall(state, callId), changed: false };
  }
  if (!istBekanntesKostenprofil(profil)) {
    throw new Error(`recordCostProfile: unbekanntes Kostenprofil '${profil}'`);
  }
  return setCostProfileOnce(state, callId, profil);
}

export const recordAnsweredUnclearReason = recordProviderHandleOnce("answeredUnclearReason");

export const recordFromRegistrationSource = recordProviderHandleOnce("fromRegistrationSource");

export const recordElDetectorCounts = recordProviderHandleOnce("elDetectorCounts");

export const FROM_SOURCE = Object.freeze({
  TENANT_DID: "tenant_did",
  PROVIDER_MEASURED: "provider_measured",
});

export function recordActualSender(state, callId, { e164, source }) {
  const call = getCall(state, callId);
  if (!call || call.direction !== "outbound" || call.fromActualE164) return { call, changed: false };
  if (!e164 || !E164.test(e164)) return { call, changed: false };
  call.fromActualE164 = e164;
  call.fromSource = source;
  return { call, changed: true };
}

export function recordProviderCallResult(state, callId, { summary, objectiveAchieved }) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.summary = summary;
  call.objectiveAchieved = objectiveAchieved;
  return { call, changed: true };
}

export function recordProviderCollectedFields(state, callId, { appointmentDate, appointmentTime, amount, currency }) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.appointmentDate = appointmentDate ?? null;
  call.appointmentTime = appointmentTime ?? null;
  call.amount = amount ?? null;
  call.currency = currency ?? null;
  return { call, changed: true };
}

export function recordCalleeConfirmedTimezone(state, callId, { timezone, origin, confirmedAt }) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.calleeConfirmedTimezone = timezone;
  call.calleeConfirmedTimezoneOrigin = origin;
  call.calleeConfirmedTimezoneAt = confirmedAt;
  return { call, changed: true };
}

export function countCallerTurn(state, callId) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.callerTurns = (Number.isSafeInteger(call.callerTurns) ? call.callerTurns : 0) + 1;
  return { call, changed: true };
}

const CONSULT_ID_PREFIX = "c";
const CONSULT_ID_PATTERN = /^c(\d+)$/;
const consultIdOf = (seq) => `${CONSULT_ID_PREFIX}${seq}`;

function consultSeqOf(eventId) {
  const match = typeof eventId === "string" ? eventId.match(CONSULT_ID_PATTERN) : null;
  return match ? Number(match[1]) : null;
}

export function isConsultEventId(eventId) {
  return typeof eventId === "string" && CONSULT_ID_PATTERN.test(eventId);
}

function cleanQuestions(questions) {
  return Array.isArray(questions) ? questions.filter((question) => typeof question === "string" && question) : [];
}

export function emitConsult(state, callId, questions) {
  const call = getCall(state, callId);
  const asked = cleanQuestions(questions);
  if (!call || !asked.length) return { call: call || null, changed: false, consult: null };
  const chain = (call.consults ||= []);
  const consult = {
    id: consultIdOf(chain.length),
    seq: chain.length,
    questions: asked,
    status: CONSULT_STATUS.OPEN,
    askedAt: new Date().toISOString(),
    answeredAt: null,
    answeredFacts: 0,
  };
  chain.push(consult);
  return { call, changed: true, consult };
}

export function pendingConsult(state, callId, afterEventId) {
  const call = getCall(state, callId);
  if (!call || !Array.isArray(call.consults)) return null;
  const afterSeq = consultSeqOf(afterEventId);
  return (
    call.consults.find(
      (consult) => consult.status === CONSULT_STATUS.OPEN && (afterSeq === null || consult.seq > afterSeq),
    ) ?? null
  );
}

function keyFactsCount(call) {
  const facts = call?.context?.key_facts;
  return Array.isArray(facts) ? facts.length : 0;
}

function mergeContextFacts(call, facts) {
  const incoming = Array.isArray(facts) ? facts : [];
  if (!incoming.length) return 0;
  const context = (call.context ||= {});
  const existing = Array.isArray(context.key_facts) ? context.key_facts : [];
  const room = KEY_FACTS_LIMITS.maxItems - existing.length;
  if (room <= 0) return 0;
  const taken = incoming.slice(0, room);
  context.key_facts = [...existing, ...taken];
  return taken.length;
}

function consultAgeMs(consult, nowMs) {
  return nowMs - Date.parse(consult?.askedAt ?? "");
}

function consultAlive(ageMs, openMs) {
  return Number.isFinite(ageMs) && Number.isFinite(openMs) && ageMs < openMs;
}

function openConsultFor(state, callId, eventId) {
  const call = getCall(state, callId);
  if (!call || call.status !== "active")
    return { call: call || null, consult: null, outcome: CONSULT_ANSWER.CALL_ENDED };
  const consult = Array.isArray(call.consults)
    ? call.consults.find((consultEntry) => consultEntry.id === eventId)
    : null;
  if (!consult) return { call, consult: null, outcome: CONSULT_ANSWER.UNKNOWN_EVENT };
  if (consult.status !== CONSULT_STATUS.OPEN)
    return { call, consult, outcome: CONSULT_ANSWER.ALREADY_ANSWERED };
  return { call, consult, outcome: null };
}

export function answerConsult(state, callId, { eventId, facts, nowMs, openMs }) {
  const { call, consult, outcome } = openConsultFor(state, callId, eventId);
  const reject = (rejectedOutcome) => ({ call: call || null, changed: false, outcome: rejectedOutcome, mergedFacts: 0 });
  if (outcome) return reject(outcome);
  if (isInCallConsult(call, consult) && !consultAlive(consultAgeMs(consult, nowMs), openMs))
    return reject(CONSULT_ANSWER.DEADLINE_PASSED);
  const answeredFactsFrom = keyFactsCount(call);
  const mergedFacts = mergeContextFacts(call, facts);
  consult.status = CONSULT_STATUS.ANSWERED;
  consult.answeredAt = new Date().toISOString();
  consult.answeredFacts = mergedFacts;
  consult.answeredFactsFrom = answeredFactsFrom;
  return { call, changed: true, outcome: CONSULT_ANSWER.ACCEPTED, mergedFacts };
}

export function addLookupFacts(state, callId, facts) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false, added: 0 };
  const added = mergeContextFacts(call, facts);
  return { call, changed: added > 0, added };
}

export function countCallLookup(state, callId) {
  const call = getCall(state, callId);
  if (!call) return 0;
  call.lookups = (call.lookups || 0) + 1;
  return call.lookups;
}

export function callLookups(call) {
  return call?.lookups || 0;
}

export function recordCallLookup(state, callId, query) {
  const call = getCall(state, callId);
  if (!call || typeof query !== "string" || !query) {
    return { call: call || null, changed: false, seq: null };
  }
  const log = (call.lookupLog ||= []);
  const eintrag = {
    seq: log.length,
    query,
    askedAt: new Date().toISOString(),
    dauerMs: null,
    ok: null,
    factCount: null,
  };
  log.push(eintrag);
  return { call, changed: true, seq: eintrag.seq };
}

export function finishCallLookup(state, callId, { seq, ok, factCount, dauerMs }) {
  const call = getCall(state, callId);
  const log = Array.isArray(call?.lookupLog) ? call.lookupLog : [];
  const eintrag = log.find((zeile) => zeile.seq === seq);
  if (!eintrag) return { call: call || null, changed: false };
  eintrag.ok = ok === true;
  eintrag.factCount = Number.isFinite(factCount) ? factCount : 0;
  eintrag.dauerMs = Number.isFinite(dauerMs) ? dauerMs : null;
  return { call, changed: true };
}

export function elevenLabsLookupCount(call) {
  return Array.isArray(call?.lookupLog) ? call.lookupLog.length : 0;
}

export function expireOpenConsults(state, callId) {
  const call = getCall(state, callId);
  if (!call || !Array.isArray(call.consults)) return { call: call || null, changed: false };
  let changed = false;
  for (const consult of call.consults) {
    if (consult.status !== CONSULT_STATUS.OPEN) continue;
    consult.status = CONSULT_STATUS.EXPIRED;
    changed = true;
  }
  return { call, changed };
}

export function expireOrphanedConsults(state, callId, { nowMs, openMs }) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false, orphaned: 0 };
  const orphanedAt = new Date().toISOString();
  let orphaned = 0;
  for (const consult of inCallConsults(call)) {
    if (consult.status !== CONSULT_STATUS.OPEN) continue;
    if (!consultAlive(consultAgeMs(consult, nowMs), openMs)) continue;
    consult.orphanedAt = orphanedAt;
    orphaned += 1;
  }
  const { changed } = expireOpenConsults(state, callId);
  return { call, changed, orphaned };
}

export function isInCallConsult(call, consult) {
  const answeredAtMs = Date.parse(call?.answeredAt ?? "");
  const askedAtMs = Date.parse(consult?.askedAt ?? "");
  if (Number.isNaN(answeredAtMs) || Number.isNaN(askedAtMs)) return false;
  return askedAtMs >= answeredAtMs;
}

export function inCallConsults(call) {
  if (!Array.isArray(call?.consults)) return [];
  return call.consults.filter((consult) => isInCallConsult(call, consult));
}

export function consultQuotaUsed(call) {
  return inCallConsults(call).filter((consult) => !consult.orphanedAt).length;
}

function answerAwaitsDelivery(consult) {
  return (
    consult.status === CONSULT_STATUS.ANSWERED &&
    !consult.deliveredAt &&
    consult.answeredFacts > 0
  );
}

export function consultAnswerAwaitingDelivery(call) {
  return inCallConsults(call).some(answerAwaitsDelivery);
}

export function markConsultAnswerDelivered(state, callId) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false, marked: 0 };
  const deliveredAt = new Date().toISOString();
  let marked = 0;
  for (const consult of inCallConsults(call))
    if (answerAwaitsDelivery(consult)) {
      consult.deliveredAt = deliveredAt;
      marked += 1;
    }
  return { call, changed: marked > 0, marked };
}

export function markConsultAskDelivered(state, callId, eventId) {
  const call = getCall(state, callId);
  const consult = Array.isArray(call?.consults)
    ? call.consults.find((consultEntry) => consultEntry.id === eventId)
    : null;
  if (!consult || consult.status !== CONSULT_STATUS.OPEN || consult.askDeliveredAt)
    return { call: call || null, changed: false };
  consult.askDeliveredAt = new Date().toISOString();
  return { call, changed: true };
}

export function ackConsult(state, callId, { eventId }) {
  const { call, consult, outcome } = openConsultFor(state, callId, eventId);
  if (outcome) return { call: call || null, changed: false, outcome };
  if (consult.ackedAt) return { call, changed: false, outcome: CONSULT_ANSWER.ACCEPTED };
  consult.ackedAt = new Date().toISOString();
  return { call, changed: true, outcome: CONSULT_ANSWER.ACCEPTED };
}

export function timeOutStagedConsult(state, callId, { consultId, reason, nowMs, stageMs }) {
  const call = getCall(state, callId);
  const consult = call?.consults?.find((consultEntry) => consultEntry.id === consultId) ?? null;
  const idle = { call: call || null, changed: false, wait: CONSULT_WAIT.NONE };
  if (!consult || consult.status !== CONSULT_STATUS.OPEN) return idle;
  if (consultAlive(consultAgeMs(consult, nowMs), stageMs)) return idle;
  consult.status = CONSULT_STATUS.TIMED_OUT;
  consult.timeoutReason = reason;
  return { call, changed: true, wait: CONSULT_WAIT.TIMED_OUT };
}

export function noteConsultPoll(state, callId, nowMs = Date.now()) {
  const call = getCall(state, callId);
  if (call) call.consultPolledAtMs = nowMs;
}

export function advanceInCallConsult(state, callId, { nowMs, waitMs, openMs }) {
  const call = getCall(state, callId);
  const idle = { call: call || null, changed: false, wait: CONSULT_WAIT.NONE };
  if (!call) return idle;
  if (consultAnswerAwaitingDelivery(call))
    return { call, changed: false, wait: CONSULT_WAIT.ANSWERED };
  const consult = inCallConsults(call).find((consultEntry) => consultEntry.status === CONSULT_STATUS.OPEN);
  if (!consult) return idle;
  const ageMs = consultAgeMs(consult, nowMs);
  if (!consultAlive(ageMs, openMs)) {
    consult.status = CONSULT_STATUS.TIMED_OUT;
    return { call, changed: true, wait: CONSULT_WAIT.TIMED_OUT };
  }
  if (!consult.held && ageMs < waitMs) {
    consult.held = true;
    return { call, changed: true, wait: CONSULT_WAIT.HOLD };
  }
  if (!consult.pendingNoted) {
    consult.pendingNoted = true;
    return { call, changed: true, wait: CONSULT_WAIT.PENDING };
  }
  return idle;
}

export function countNoSpeechTurn(state, callId) {
  const call = getCall(state, callId);
  if (!call) return 0;
  call.noSpeechStreak = (call.noSpeechStreak || 0) + 1;
  return call.noSpeechStreak;
}

export function clearNoSpeechStreak(state, callId) {
  const call = getCall(state, callId);
  if (call) call.noSpeechStreak = 0;
}

export function countOutboundCallsSince(
  state,
  sinceIso,
  { requestedBy = null, tenantId = null, to = null } = {},
) {
  return state.calls.filter(
    (call) =>
      call.direction === "outbound" &&
      call.startedAt >= sinceIso &&
      (requestedBy == null || call.requestedBy === requestedBy) &&
      (tenantId == null || call.tenantId === tenantId) &&
      (to == null || call.to === to),
  ).length;
}

export function activeCallsFor(state, tenantId) {
  return state.calls.filter((call) => call.tenantId === tenantId && call.status === "active");
}

export function counterpartyMemory(s, tenantId, e164) {
  if (!e164) return [];
  if (settingsFor(s, tenantId).allowCallMemory !== true) return [];
  return s.calls
    .filter((c) => c.tenantId === tenantId && c.direction === "outbound" && c.to === e164)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .map(memoryEntryOf)
    .filter(Boolean)
    .slice(0, MEMORY_MAX_CALLS);
}

function memoryEntryOf(call) {
  const outcome = call.result?.outcome ?? null;
  const facts = Array.isArray(call.result?.facts) ? call.result.facts : [];
  return outcome || facts.length ? { outcome, facts } : null;
}

const ACTION_ITEM_TRAILING_PUNCTUATION = /[.,;:!?\s]+$/;

function actionItemKey(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(ACTION_ITEM_TRAILING_PUNCTUATION, "");
}

function existingActionItem(state, callId, key) {
  return state.actionItems.find((actionItem) => actionItem.callId === callId && actionItemKey(actionItem.text) === key) || null;
}

export function addActionItem(s, callId, text, type = "todo") {
  const existing = existingActionItem(s, callId, actionItemKey(text));
  if (existing) return { item: existing, duplicate: true };
  const item = {
    id: newId("ai"),
    callId,
    text,
    type,
    done: false,
    createdAt: new Date().toISOString(),
  };
  s.actionItems.unshift(item);
  const call = getCall(s, callId);
  if (call) call.actionItemIds.push(item.id);
  return { item, duplicate: false };
}

export function callActionItems(state, callId) {
  return state.actionItems.filter((item) => item.callId === callId).reverse();
}

export function toggleActionItem(state, id) {
  const item = state.actionItems.find((actionItem) => actionItem.id === id);
  if (item) item.done = !item.done;
  return item;
}

export function calendarFor(s, tenantId) {
  return (s.calendar[tenantId] ||= []);
}

export function getCalendar(state, tenantId) {
  return calendarFor(state, tenantId).sort((entryA, entryB) => entryA.start.localeCompare(entryB.start));
}

export function addCalendarEvent(state, { tenantId, title, startIso, endIso }) {
  const ev = { id: newId("ev"), title, start: startIso, end: endIso };
  calendarFor(state, tenantId).push(ev);
  return ev;
}

export function findConflict(s, tenantId, startIso, endIso) {
  return getCalendar(s, tenantId).find((ev) => ev.start < endIso && startIso < ev.end) || null;
}

export function resolveCallLanguage(state, { tenantId, numberRecord }) {
  const settingsLang = settingsFor(state, tenantId).language;
  const tenant = findTenant(state, tenantId);
  return settingsLang || numberRecord?.language || tenant?.defaultLanguage || DEFAULT_LANGUAGE;
}

export function seedBootstrapNumber(
  s,
  e164,
  tenantId,
  provider = DEFAULT_PROVIDER,
  country = DEFAULT_COUNTRY,
  language = languageForCountry(country),
) {
  const norm = normNum(e164);
  if (!norm) return;
  if (s.numbers.some((n) => n.e164 === norm)) return;
  s.numbers.push({
    id: newId("num"),
    e164: norm,
    tenantId,
    provider,
    country,
    language,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: null,
  });
}

export function seedBootstrapNumberFromConfig(s, e164, tenantId, provider) {
  if (!Object.values(PROVIDER).includes(provider)) return;
  seedBootstrapNumber(s, e164, tenantId, provider);
}

export function bootstrapTenant(s, e164, tenantId, provider = DEFAULT_PROVIDER) {
  if (!findTenant(s, tenantId)) s.tenants.push({ id: tenantId, status: TENANT_STATUS.ACTIVE });
  seedBootstrapNumber(s, e164, tenantId, provider);
  if (tenantId === BOOTSTRAP_TENANT_ID) seedBootstrapKyc(s, tenantId);
}

export function tenantContext(state, ownerName, tenantId) {
  const tenant = findTenant(state, tenantId);
  const effectiveOwner = (tenant && tenant.ownerName) || ownerName;
  return {
    tenantId,
    ownerName: effectiveOwner,
    firstName: (tenant && tenant.firstName) || firstNameOf(effectiveOwner),
    settings: settingsFor(state, tenantId),
    calendar: calendarFor(state, tenantId),
  };
}

function firstNameOf(fullName) {
  return typeof fullName === "string" ? fullName.trim().split(/\s+/)[0] || "" : "";
}

function tenantBudgetRow(state, tenantId) {
  return state.tenantBudgets.find((budget) => budget.tenantId === tenantId) || null;
}

function seedTenantDefaultBudget(state, tenantId, defaultBudgetCents) {
  if (!defaultBudgetCents) return;
  if (tenantBudgetRow(state, tenantId)) return;
  setTenantBudget(state, tenantId, { budgetCents: defaultBudgetCents, hardCapCents: defaultBudgetCents });
}

export function registerTenant(
  state,
  id,
  { firstName, lastName, privateNumber, idpSubject, defaultBudgetCents, country } = {},
) {
  const e164 = normalizePrivateNumber(privateNumber, country);
  const existing = findTenant(state, id);
  if (existing) {
    if (idpSubject && !existing.idpSubject) existing.idpSubject = idpSubject;
    if (!existing.ownerName) applyOwnerIdentity(existing, firstName, lastName);
    if (e164 && !existing.privateNumber) existing.privateNumber = e164;
    seedTenantDefaultBudget(state, id, defaultBudgetCents);
    return existing;
  }
  const tenant = { id, status: TENANT_STATUS.ACTIVE };
  applyOwnerIdentity(tenant, firstName, lastName);
  if (idpSubject) tenant.idpSubject = idpSubject;
  if (e164) tenant.privateNumber = e164;
  state.tenants.push(tenant);
  seedTenantDefaultBudget(state, id, defaultBudgetCents);
  return tenant;
}

export function deriveTenantBudgetFromPlan(state, tenantId, cfg) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return;
  const slug = tenant.stripePlanSlug;
  if (!slug) return;
  if (!isKnownPlanSlug(slug)) {
    console.warn(
      `[budget] plan-cap grund=slug_unbekannt slug=${slug} tenant=${tenantId} -> ` +
        "Ableitung uebersprungen (bestehende Decke bleibt, Tenant-Achse fail-closed)",
    );
    return;
  }
  const capCents = planCapCents(slug, cfg);
  if (capCents <= 0) {
    console.warn(
      `[budget] plan-cap grund=tarif_null slug=${slug} tenant=${tenantId} -> ` +
        "Ableitung uebersprungen (bestehende Decke bleibt, VOICE_TARIFF_DEFAULT_CENTS=0)",
    );
    return;
  }
  setTenantBudget(state, tenantId, { budgetCents: capCents, hardCapCents: capCents });
}

export function markProvisioningJob(s, jobId, status, lastError = null) {
  const job = s.provisioningJobs.find((j) => j.id === jobId);
  if (!job) return null;
  job.status = status;
  job.attempts += 1;
  if (lastError) job.lastError = lastError;
  return job;
}

export function allTenantIds(state) {
  return tenantsOf(state).map((tenant) => tenant.id);
}

export function tenantIdpSubject(state, tenantId) {
  return findTenant(state, tenantId)?.idpSubject ?? null;
}

export function setCancellationMailPending(state, tenantId, { pending, receivedAt } = {}) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) return null;
  if (pending !== undefined) tenant.cancellationMailPending = pending;
  if (receivedAt !== undefined) tenant.cancellationMailReceivedAt = receivedAt;
  return tenant;
}

export function cancellationMailPending(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return {
    pending: tenant?.cancellationMailPending ?? false,
    receivedAt: tenant?.cancellationMailReceivedAt ?? null,
  };
}

export function tenantsPendingCancellationMail(state) {
  return tenantsOf(state).filter((tenant) => tenant.cancellationMailPending);
}

export function tenantsForStripeReconcile(state) {
  return tenantsOf(state).filter((tenant) => tenant.stripeSubscriptionId && !tenant.suspendedAt);
}

export function tenantsForStaleSubscriptionReconcile(state) {
  return tenantsOf(state).filter(
    (tenant) => tenant.stripeSubscriptionId && tenant.status !== TENANT_STATUS.ACTIVE,
  );
}

export function tenantsForPaymentMethodTypeReconcile(state) {
  return tenantsOf(state).filter(
    (tenant) => tenant.stripePaymentMethodId && !tenant.stripePaymentMethodType,
  );
}

export function setNewsletterConsent(state, tenantId, consent) {
  if (typeof consent !== "boolean")
    throw new Error("setNewsletterConsent: consent muss boolean sein");
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`setNewsletterConsent: Tenant ${tenantId} nicht gefunden`);
  tenant.newsletterConsent = consent;
  tenant.newsletterConsentAt = new Date().toISOString();
  return tenant;
}

export function tenantNewsletterConsent(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  return {
    consent: tenant?.newsletterConsent === true,
    consentAt: tenant?.newsletterConsentAt ?? null,
  };
}

export function tenantNewsletterRecipients(state, tenantId) {
  return findTenant(state, tenantId)?.newsletterRecipients ?? [];
}

export function confirmedNewsletterRecipients(state, tenantId) {
  return tenantNewsletterRecipients(state, tenantId).filter((recipient) => recipient.status === "confirmed");
}

export function dailyNewsletterConfirmMailCount(state, tenantId, sinceIso) {
  const tenant = findTenant(state, tenantId);
  return (tenant?.newsletterConfirmMailLog ?? []).filter((sentAt) => sentAt >= sinceIso).length;
}

export function addNewsletterRecipient(state, tenantId, { email, tokenHash, tokenExpiresAt, unsubToken, now }) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`addNewsletterRecipient: Tenant ${tenantId} nicht gefunden`);
  const nowIso = now ?? new Date().toISOString();
  tenant.newsletterRecipients ??= [];
  tenant.newsletterRecipients.push({
    email,
    status: "pending",
    createdAt: nowIso,
    confirmedAt: null,
    tokenHash,
    tokenExpiresAt,
    unsubToken,
  });
  const cutoff = new Date(Date.parse(nowIso) - MS_PER_DAY).toISOString();
  tenant.newsletterConfirmMailLog = (tenant.newsletterConfirmMailLog ?? [])
    .filter((sentAt) => sentAt >= cutoff)
    .concat(nowIso);
  return tenant.newsletterRecipients[tenant.newsletterRecipients.length - 1];
}

export function removeNewsletterRecipient(state, tenantId, email) {
  const tenant = findTenant(state, tenantId);
  if (!tenant) throw new Error(`removeNewsletterRecipient: Tenant ${tenantId} nicht gefunden`);
  const before = (tenant.newsletterRecipients ?? []).length;
  tenant.newsletterRecipients = (tenant.newsletterRecipients ?? []).filter((recipient) => recipient.email !== email);
  return tenant.newsletterRecipients.length !== before;
}

export function confirmNewsletterRecipientByToken(state, tokenHash, nowIso) {
  for (const tenant of tenantsOf(state)) {
    const match = (tenant.newsletterRecipients ?? []).find(
      (recipient) =>
        recipient.status === "pending" &&
        recipient.tokenHash &&
        safeEqual(recipient.tokenHash, tokenHash) &&
        recipient.tokenExpiresAt > nowIso,
    );
    if (match) {
      match.status = "confirmed";
      match.confirmedAt = nowIso;
      match.tokenHash = null;
      match.tokenExpiresAt = null;
      return { tenantId: tenant.id, email: match.email };
    }
  }
  return null;
}

export function unsubscribeNewsletterRecipientByToken(state, token) {
  for (const tenant of tenantsOf(state)) {
    const recipients = tenant.newsletterRecipients ?? [];
    const idx = recipients.findIndex((recipient) => recipient.unsubToken && safeEqual(recipient.unsubToken, token));
    if (idx !== -1) {
      const [removed] = recipients.splice(idx, 1);
      return { tenantId: tenant.id, email: removed.email };
    }
  }
  return null;
}

function worstCasePrice(prices) {
  const rates = Object.values(prices);
  if (!rates.length)
    throw new Error("modelPricesUsd ist leer - keine Preisquelle fuer den Budget-Guard (Regel 1)");
  const worst = {};
  for (const field of MODEL_PRICE_RATE_FIELDS)
    worst[field] = rates.reduce((max, price) => (price[field] > max ? price[field] : max), 0);
  return worst;
}

function priceForModel(model, prices) {
  return Object.hasOwn(prices, model) ? prices[model] : worstCasePrice(prices);
}

function tokenCostUsd(tokens, cfg) {
  const price = priceForModel(tokens.model, cfg.modelPricesUsd);
  return (
    (tokens.inputUncachedTokens / TOKENS_PER_M_TOK) * price.inPerMTok +
    (tokens.inputCacheWriteTokens / TOKENS_PER_M_TOK) * price.cacheWritePerMTok +
    (tokens.inputCacheReadTokens / TOKENS_PER_M_TOK) * price.cacheReadPerMTok +
    (tokens.outputTokens / TOKENS_PER_M_TOK) * price.outPerMTok
  );
}

export function tokenCostMicroCents(tokens, cfg) {
  return Math.round(tokenCostUsd(tokens, cfg) * cfg.usdToEur * CENTS_PER_EUR * MICRO_CENTS_PER_CENT);
}

function discardCorruptWrite(usage, kante, wert) {
  console.error(`[usage] grund=${USAGE_CORRUPT_REASON} verworfen kante=${kante} wert=${wert}`);
  return usage;
}

function denyCorruptUsage(kante, feld, wert) {
  console.error(`[budget] grund=${USAGE_CORRUPT_REASON} kante=${kante} feld=${feld} wert=${wert}`);
  return true;
}

function turnIncrementsBookable(tokens, microInc) {
  return (
    isBookableCents(tokens.inputUncachedTokens) &&
    isBookableCents(tokens.inputCacheWriteTokens) &&
    isBookableCents(tokens.inputCacheReadTokens) &&
    isBookableCents(tokens.outputTokens) &&
    isBookableCents(microInc)
  );
}

function parseValidDate(nowIso) {
  const at = new Date(nowIso);
  return Number.isNaN(at.getTime()) ? null : at;
}

function yearMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function spendMonthKeyOf(nowIso) {
  const at = parseValidDate(nowIso);
  return at ? yearMonthKey(at) : null;
}

function previousMonthKeyOf(nowIso) {
  const at = parseValidDate(nowIso);
  if (at === null) return null;
  return yearMonthKey(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1)));
}

export function laterMonotonicKey(storedKey, nowKey) {
  if (!nowKey) return storedKey ?? null;
  if (!storedKey) return nowKey;
  return storedKey > nowKey ? storedKey : nowKey;
}

function authoritativeSpendMonthKey(storedKey, nowKey) {
  return laterMonotonicKey(storedKey, nowKey);
}

export function spendMonthUsageCents(bucket, nowIso) {
  if (!spendMonthCounterCurrent(bucket, nowIso)) return 0;
  return Math.max(0, bucket.spendMonthCostCents);
}

function spendMonthCounterCurrent(bucket, nowIso) {
  return spendMonthWindowKey(bucket, nowIso) === bucket.spendMonthKey;
}

export function spendMonthWindowKey(bucket, nowIso) {
  return authoritativeSpendMonthKey(bucket.spendMonthKey, spendMonthKeyOf(nowIso));
}

function bookCents(usage, cents, nowIso) {
  usage.costCents += cents;
  const key = authoritativeSpendMonthKey(usage.spendMonthKey, spendMonthKeyOf(nowIso));
  if (key === null) return;
  usage.spendMonthCostCents = key === usage.spendMonthKey ? usage.spendMonthCostCents + cents : cents;
  usage.spendMonthKey = key;
}

function carryMicroRemainder(remMicro, incrementMicro, divisor) {
  const totalMicro = remMicro + incrementMicro;
  return { carryCents: Math.floor(totalMicro / divisor), remMicro: totalMicro % divisor };
}

export function trackUsage(s, tenantId, tokens, cfg, nowIso) {
  const usage = usageFor(s, tenantId);
  const microInc = tokenCostMicroCents(tokens, cfg);
  if (!turnIncrementsBookable(tokens, microInc))
    return discardCorruptWrite(usage, `trackUsage tenant:${tenantId}`, microInc);
  usage.inputTokens += inputTokensOf(tokens);
  usage.outputTokens += tokens.outputTokens;
  const { carryCents, remMicro } = carryMicroRemainder(usage.costMicroCentsRem, microInc, MICRO_CENTS_PER_CENT);
  bookCents(usage, carryCents, nowIso);
  usage.costMicroCentsRem = remMicro;
  return usage;
}

function addUsageCostCents(state, { tenantId, costCents, nowIso, quelle }) {
  const usage = usageFor(state, tenantId);
  if (!isBookableCents(costCents))
    return discardCorruptWrite(usage, `${quelle} tenant:${tenantId}`, costCents);
  bookCents(usage, costCents, nowIso);
  return usage;
}

export function addVoiceUsageCostCents(s, tenantId, costCents, nowIso) {
  return addUsageCostCents(s, { tenantId, costCents, nowIso, quelle: "addVoiceUsageCostCents" });
}

export function addResearchFeeCostCents(s, tenantId, costCents, nowIso) {
  return addUsageCostCents(s, { tenantId, costCents, nowIso, quelle: "addResearchFeeCostCents" });
}

const CORRECTION_DIVISOR = MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE;

export function convertProviderMicroToBucketCents({ remMicro, actualCostMicroCents, providerToBucketRateMicro }) {
  const safeRemMicro =
    Number.isSafeInteger(remMicro) && remMicro >= 0 && remMicro < CORRECTION_DIVISOR ? remMicro : 0;
  const { carryCents, remMicro: carriedRem } = carryMicroRemainder(
    safeRemMicro,
    actualCostMicroCents * providerToBucketRateMicro,
    CORRECTION_DIVISOR,
  );
  return { bucketCents: carryCents, remMicro: carriedRem };
}

function creditHitsSpendMonth(bucket, spendMonthKey, nowIso) {
  return (
    spendMonthKey !== null &&
    spendMonthKey === bucket.spendMonthKey &&
    spendMonthCounterCurrent(bucket, nowIso)
  );
}

function creditHitsBudgetPeriod(bucket, periodKey) {
  return periodKey === bucket.budgetPeriodKey;
}

function applyCreditCents(usage, { deltaCents, chargeAnchors, nowIso }) {
  const vorher = usage.costCents;
  usage.costCents = Math.max(0, vorher + deltaCents);
  const wirksam = usage.costCents - vorher;
  if (creditHitsSpendMonth(usage, chargeAnchors.spendMonthKey, nowIso))
    usage.spendMonthCostCents += wirksam;
  if (!creditHitsBudgetPeriod(usage, chargeAnchors.periodKey))
    usage.budgetPeriodBaselineCents = Math.max(0, usage.budgetPeriodBaselineCents + wirksam);
}

export function bookCostCorrectionCents(state, { tenantId, deltaCents, chargeAnchors, nowIso }) {
  const usage = usageFor(state, tenantId);
  if (!isCorrectionCents(deltaCents))
    return { usage: discardCorruptWrite(usage, `bookCostCorrectionCents tenant:${tenantId}`, deltaCents), booked: false };
  if (deltaCents > 0) bookCents(usage, deltaCents, nowIso);
  else if (deltaCents < 0) applyCreditCents(usage, { deltaCents, chargeAnchors, nowIso });
  return { usage, booked: true };
}

export function applyCostCorrectionCents(s, tenantId,
  { actualCostMicroCents, estimatedCostCents, providerToBucketRateMicro, dataComplete,
    chargeAnchors = NO_CHARGE_ANCHORS }, nowIso) {
  const usage = usageFor(s, tenantId);
  const { bucketCents, remMicro } = convertProviderMicroToBucketCents({
    remMicro: usage.costCorrectionMicroCentsRem,
    actualCostMicroCents,
    providerToBucketRateMicro,
  });
  const deltaCents = bucketCents - estimatedCostCents;
  if (deltaCents < 0 && !dataComplete) return { usage, booked: false, deltaCents };
  const booked = bookCostCorrectionCents(s, { tenantId, deltaCents, chargeAnchors, nowIso });
  if (!booked.booked) return { usage, booked: false, deltaCents };
  usage.costCorrectionMicroCentsRem = remMicro;
  return { usage, booked: true, deltaCents };
}

function effectiveCapCents(state, tenantId, cfg) {
  const budget = tenantBudgetRow(state, tenantId);
  if (budget) return budget.hardCapCents;
  const tenantDefaultCents = cfg.defaultTenantBudgetCents;
  return tenantDefaultCents > 0 ? tenantDefaultCents : globalCapCents(cfg);
}

function budgetPeriodUsageCents(bucket) {
  if (!bucket.budgetPeriodKey) return bucket.costCents;
  return Math.max(0, bucket.costCents - bucket.budgetPeriodBaselineCents);
}

export function stampBudgetPeriod(state, tenantId, periodStartIso) {
  if (!periodStartIso) return { changed: false };
  const bucket = usageFor(state, tenantId);
  if (laterMonotonicKey(bucket.budgetPeriodKey, periodStartIso) !== periodStartIso)
    return { changed: false };
  if (bucket.budgetPeriodKey === periodStartIso) return { changed: false };
  bucket.budgetPeriodKey = periodStartIso;
  bucket.budgetPeriodBaselineCents = bucket.costCents;
  return { changed: true };
}

export function gateUsageCents(s, tenantId, cfg, nowIso) {
  const bucket = usageFor(s, tenantId);
  return cfg.budgetMonthEnabled ? spendMonthUsageCents(bucket, nowIso) : budgetPeriodUsageCents(bucket);
}

function platformSpendMonthCents(state, nowIso) {
  return Object.values(state.usage).reduce((sum, bucket) => sum + spendMonthUsageCents(bucket, nowIso), 0);
}

export function gatePlatformUsageCents(state, cfg, nowIso) {
  return cfg.budgetMonthEnabled ? platformSpendMonthCents(state, nowIso) : globalUsageTotals(state).costCents;
}

function usageAxesBookable({ gateCents, lifetimeCents }) {
  return isBookableCents(gateCents) && isBookableCents(lifetimeCents);
}

function spendOrDeny({ label, gateCents, lifetimeCents }) {
  if (usageAxesBookable({ gateCents, lifetimeCents })) return { deny: false, spent: gateCents };
  const gateBookable = isBookableCents(gateCents);
  const feld = gateBookable ? "lifetimeCents" : "gateCents";
  denyCorruptUsage(label, feld, gateBookable ? lifetimeCents : gateCents);
  return { deny: true };
}

function tenantUsageAxes(s, tenantId, cfg, nowIso) {
  return {
    gateCents: gateUsageCents(s, tenantId, cfg, nowIso),
    lifetimeCents: usageFor(s, tenantId).costCents,
  };
}

function tenantSpendOrDeny(s, tenantId, cfg, nowIso) {
  return spendOrDeny({ label: `tenant:${tenantId}`, ...tenantUsageAxes(s, tenantId, cfg, nowIso) });
}

export function liveBudgetExceeded(s, tenantId, liveCents, cfg, nowIso) {
  const spend = tenantSpendOrDeny(s, tenantId, cfg, nowIso);
  if (spend.deny) return true;
  if (!isBookableCents(liveCents))
    return denyCorruptUsage(`tenant:${tenantId}`, "liveCents", liveCents);
  return spend.spent + liveCents >= effectiveCapCents(s, tenantId, cfg);
}

export function budgetExceeded(s, tenantId, cfg, nowIso) {
  return liveBudgetExceeded(s, tenantId, 0, cfg, nowIso);
}

export function reserveExceedsBudget(s, tenantId, reserveCents, cfg, nowIso) {
  const spend = tenantSpendOrDeny(s, tenantId, cfg, nowIso);
  if (spend.deny) return true;
  return spend.spent + reservationFor(s, tenantId) + reserveCents > effectiveCapCents(s, tenantId, cfg);
}

export function tenantBudgetSnapshot(s, tenantId, cfg, nowIso) {
  const capCents = effectiveCapCents(s, tenantId, cfg);
  const axes = tenantUsageAxes(s, tenantId, cfg, nowIso);
  if (!usageAxesBookable(axes)) return { capCents, spentCents: null, remainingCents: null };
  const spentCents = axes.gateCents;
  return { capCents, spentCents, remainingCents: capCents - spentCents - reservationFor(s, tenantId) };
}

export function setTenantBudget(state, tenantId, { budgetCents, hardCapCents }) {
  const existing = tenantBudgetRow(state, tenantId);
  if (existing) {
    existing.budgetCents = budgetCents;
    existing.hardCapCents = hardCapCents;
    return existing;
  }
  const row = { tenantId, budgetCents, hardCapCents };
  state.tenantBudgets.push(row);
  return row;
}

export function aiCostCents(tokens, cfg) {
  return Math.round(tokenCostUsd(tokens, cfg) * cfg.usdToEur * CENTS_PER_EUR);
}

export function numbersDueForMonthMeter(state, { nowIso, tenantId = null }) {
  const monthKey = spendMonthKeyOf(nowIso);
  if (!monthKey) return [];
  const gebucht = new Set();
  for (const usageEvent of state.usageEvents) {
    if (usageEvent.kind !== USAGE_EVENT_KIND.NUMBER_MONTH) continue;
    if (!usageEvent.numberId) continue;
    if (spendMonthKeyOf(usageEvent.occurredAt) !== monthKey) continue;
    gebucht.add(usageEvent.numberId);
  }
  return state.numbers.filter(
    (number) =>
      number.status === NUMBER_STATUS.ACTIVE &&
      (tenantId === null || number.tenantId === tenantId) &&
      !gebucht.has(number.id),
  );
}

export function flushableMeterEvents(state, { flushEpochIso } = {}) {
  const pending = pendingMeterEvents(state);
  const epoch = typeof flushEpochIso === "string" ? parseValidDate(flushEpochIso) : null;
  if (!epoch)
    return { events: [], skipped: pending.length, skipReason: METER_FLUSH_SKIP.NO_EPOCH };
  const epochIso = epoch.toISOString();
  const events = pending.filter((usageEvent) => usageEvent.occurredAt >= epochIso);
  return { events, skipped: pending.length - events.length, skipReason: null };
}

function findCostEvidence(state, callId, traeger) {
  return state.callCostEvidence.find((zeile) => zeile.callId === callId && zeile.traeger === traeger);
}

export function recordCallCostEvidence(state, eingabe) {
  const { callId, traeger, reife } = eingabe;
  const call = getCall(state, callId);
  if (!call) throw new Error(`recordCallCostEvidence: Anruf '${callId}' nicht gefunden`);
  assertCostEvidenceInput(eingabe);
  const vorhanden = findCostEvidence(state, callId, traeger);
  if (!vorhanden) {
    const zeile = buildCostEvidenceRow({
      id: newId("cce"), tenantId: call.tenantId, callId, eingabe,
    });
    state.callCostEvidence.push(zeile);
    return { evidence: zeile, changed: true };
  }
  if (!canSetEvidenceMaturity(vorhanden.reife, reife))
    throw new Error(
      `recordCallCostEvidence: Reife-Rueckschritt '${vorhanden.reife}' -> '${reife}' ` +
        `(call=${callId}, traeger=${traeger})`,
    );
  if (vorhanden.reife === reife && isTerminalMaturity(reife))
    return { evidence: vorhanden, changed: false };
  vorhanden.reife = reife;
  Object.assign(vorhanden, costEvidenceFortschreibung(vorhanden, eingabe));
  return { evidence: vorhanden, changed: true };
}

export function reservationFor(state, tenantId) {
  return state.reservations[tenantId] || 0;
}

export function reservationsTotal(state) {
  return Object.values(state.reservations).reduce((sum, cents) => sum + cents, 0);
}

export function tryReserveOutboundBudget(s, tenantId, reserveCents, cfg, nowIso) {
  if (!isBookableCents(reserveCents)) return false;
  if (reserveExceedsBudget(s, tenantId, reserveCents, cfg, nowIso)) return false;
  s.reservations[tenantId] = reservationFor(s, tenantId) + reserveCents;
  return true;
}

export function releaseOutboundReserve(s, call) {
  if (!call || !call.reserveCents || call.reserveReleased) return false;
  s.reservations[call.tenantId] = Math.max(0, reservationFor(s, call.tenantId) - call.reserveCents);
  call.reserveReleased = true;
  return true;
}

export function releaseOutboundReserveCents(s, tenantId, cents) {
  if (!isBookableCents(cents)) return false;
  s.reservations[tenantId] = Math.max(0, reservationFor(s, tenantId) - cents);
  return true;
}

const PERCENT_SCALE = 100;

function scaledThresholdCrossed(value, base, percent) {
  if (!(percent > 0)) return false;
  return value * PERCENT_SCALE >= base * percent;
}

function platformSpendObservedCents(state, cfg, nowIso) {
  const total = gatePlatformUsageCents(state, cfg, nowIso) + reservationsTotal(state);
  return isBookableCents(total) ? total : null;
}

export function claimPlatformSpendWarning(s, cfg, nowIso) {
  const totalCents = platformSpendObservedCents(s, cfg, nowIso);
  if (totalCents === null) return null;
  if (!scaledThresholdCrossed(totalCents, globalCapCents(cfg), cfg.platformSpendWarnPercent)) return null;
  const monthKey = spendMonthKeyOf(nowIso);
  if (monthKey === null) return { totalCents, monthKey };
  if (s.platformSpendWarnedMonth === monthKey) return null;
  s.platformSpendWarnedMonth = monthKey;
  return { totalCents, monthKey };
}

function ttsCycleKeyOf(nowIso, anchorDay) {
  const at = parseValidDate(nowIso);
  if (at === null) return null;
  const anchored = new Date(at.getTime());
  if (at.getUTCDate() < anchorDay) anchored.setUTCMonth(anchored.getUTCMonth() - 1);
  return yearMonthKey(anchored);
}

function ttsCycleWindowKey(row, cfg, nowIso) {
  return laterMonotonicKey(row.cycleKey, ttsCycleKeyOf(nowIso, cfg.ttsQuotaCycleAnchorDay));
}

function bumpPlatformTtsQuota(s, chars, cfg, nowIso) {
  const row = s.platformTtsUsage;
  const key = ttsCycleWindowKey(row, cfg, nowIso);
  if (key === null) return { changed: false, warning: null };
  const charactersBefore = key !== row.cycleKey ? 0 : row.characters;
  row.characters = charactersBefore + chars;
  row.cycleKey = key;
  const notice = { characters: row.characters, quota: cfg.ttsCharacterQuota, cycleKey: key };
  if (ttsQuotaExhausted({ characters: charactersBefore, quota: cfg.ttsCharacterQuota }))
    return { changed: true, warning: { ...notice, exhausted: true } };
  const crossed = scaledThresholdCrossed(row.characters, cfg.ttsCharacterQuota, cfg.ttsCharacterQuotaWarnPercent);
  if (crossed && row.warnedCycle !== key) {
    row.warnedCycle = key;
    return { changed: true, warning: notice };
  }
  return { changed: true, warning: null };
}

export function recordTtsCharacters(s, chars, cfg, nowIso) {
  const result = bumpPlatformTtsQuota(s, chars, cfg, nowIso);
  if (result.changed) recordTenantTtsCharacters(s, PLATFORM_TTS_COST_CENTER_ID, chars);
  return result;
}

export function recordRelayTtsCharacters(state, { tenantId, chars, cfg, nowIso }) {
  const tenant = recordTenantTtsCharacters(state, tenantId, chars);
  if (!tenant.changed) return { changed: false, warning: null };
  return { changed: true, warning: bumpPlatformTtsQuota(state, chars, cfg, nowIso).warning };
}

export function platformTtsUsageView(state, cfg, nowIso) {
  const row = state.platformTtsUsage;
  const key = ttsCycleWindowKey(row, cfg, nowIso);
  const characters = key === row.cycleKey ? row.characters : 0;
  return { characters, quota: cfg.ttsCharacterQuota, warnPercent: cfg.ttsCharacterQuotaWarnPercent, cycleKey: key };
}

export function crossCheckDueMonthKey(state, nowIso) {
  const dueMonthKey = previousMonthKeyOf(nowIso);
  if (dueMonthKey === null) return null;
  const checked = laterMonotonicKey(state.costCrossCheck.lastCheckedMonthKey, dueMonthKey);
  return checked === state.costCrossCheck.lastCheckedMonthKey && checked !== null ? null : dueMonthKey;
}

export function markCrossCheckAttempted(s, monthKey) {
  s.costCrossCheck.lastCheckedMonthKey = laterMonotonicKey(s.costCrossCheck.lastCheckedMonthKey, monthKey);
}

export function carrierGateCostCentsForMonth(state, monthKey) {
  return state.usageEvents
    .filter((usageEvent) => usageEvent.kind === USAGE_EVENT_KIND.VOICE_MINUTE && spendMonthKeyOf(usageEvent.occurredAt) === monthKey)
    .reduce((sum, usageEvent) => sum + usageEvent.costCents, 0);
}

export function addNotification(s, title, body, callId) {
  s.notifications.unshift({
    id: newId("nt"),
    title,
    body,
    callId: callId || null,
    at: new Date().toISOString(),
  });
  s.notifications = s.notifications.slice(0, MAX_NOTIFICATIONS);
}

function pruneExpiredRecords(s, days) {
  const removed = { calls: 0, notifications: 0, actionItems: 0 };
  if (!days || days <= 0) return removed;
  const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();

  const keepCall = (c) => c.status === "active" || !c.endedAt || c.endedAt >= cutoff;
  const keepNotification = (n) => n.at >= cutoff;
  const keepActionItem = (a) => !a.done || a.createdAt >= cutoff;

  const before = {
    calls: s.calls.length,
    notifications: s.notifications.length,
    actionItems: s.actionItems.length,
  };
  s.calls = s.calls.filter(keepCall);
  s.notifications = s.notifications.filter(keepNotification);
  s.actionItems = s.actionItems.filter(keepActionItem);
  removed.calls = before.calls - s.calls.length;
  removed.notifications = before.notifications - s.notifications.length;
  removed.actionItems = before.actionItems - s.actionItems.length;
  return removed;
}

export function purgeExpiredDiagnosticTranscripts(state, days) {
  const cutoff = new Date(Date.now() - Math.max(days, 0) * MS_PER_DAY).toISOString();
  let purged = 0;
  for (const call of state.calls) {
    if (call.diagnostic !== true || !call.endedAt || call.endedAt >= cutoff) continue;
    if (purgeTranscript(state, call.id)) purged++;
  }
  return purged;
}

export function purgeExpiredResultEvidence(state, days) {
  const cutoff = new Date(Date.now() - Math.max(days, 0) * MS_PER_DAY).toISOString();
  let purged = 0;
  for (const call of state.calls) {
    if (!call.endedAt || call.endedAt >= cutoff) continue;
    if (stripResultEvidence(call)) purged++;
  }
  return purged;
}

export function pruneOldData(state, { retentionDays, diagnosticRetentionDays, evidenceRetentionDays }) {
  const removed = pruneExpiredRecords(state, retentionDays);
  removed.diagnosticTranscripts = purgeExpiredDiagnosticTranscripts(state, diagnosticRetentionDays);
  removed.resultEvidence = purgeExpiredResultEvidence(state, evidenceRetentionDays);
  return removed;
}

export function hasPrunedSomething(removed) {
  return Object.values(removed).some((count) => count > 0);
}
