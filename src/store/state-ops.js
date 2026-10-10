import crypto from "crypto";
import {
  defaultSettings,
  defaultSettingsMap,
  calendarMap,
  emptyUsage,
  emptyUsageMap,
  emptyPlatformTtsUsage,
  emptyCostCrossCheck,
  BOOTSTRAP_TENANT_ID,
  sanitizeProfile,
  resolveProfileFrom,
  MAX_NOTIFICATIONS,
  WEBHOOK_ANCHOR_HISTORY,
  DEFAULT_PROVIDER,
  PROVIDER,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
  normNum,
  E164,
  countryAllowed,
  allowedPrivateNumberCodes,
  NUMBER_STATUS,
  NUMBER_TRANSITIONS,
  KEY_FACTS_LIMITS,
  CONSULT_STATUS,
  CONSULT_ANSWER,
  CONSULT_WAIT,
  GLOBAL_CAP_REASON,
  NEEDS_MANUAL_RECONCILE_REASON,
  REQUEST_NUMBER_REASON,
  TENANT_STATUS,
  PROVISIONING_JOB_STATUS,
  PROVISION_NUMBER_JOB,
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
  KYC_LEVEL,
  KYC_ORDER,
  COST_TRUING_SOURCE,
  NUMBER_HOLD_REASON,
} from "./defaults.js";
import {
  assertCostEvidenceInput,
  buildCostEvidenceRow,
  canSetEvidenceMaturity,
  costEvidenceFortschreibung,
  isTerminalMaturity,
} from "./cost-evidence.js";
import { SUPPORTED_LANGUAGES, PERSONA_STYLE_IDS, languageForCountry } from "../i18n/locales.js";
import { planCapCents } from "../billing/plan-caps.js";
import { resolvePeriodStartIso } from "../billing/period.js";
import { istBekanntesKostenprofil } from "../billing/kostenarten.js";
import { BRIDGE_STATE, bridgeStateOf } from "../elevenlabs/inbound-bridge-state.js";
import { isKnownPlanSlug } from "../plans.js";
import { hasInboundNotice } from "../i18n/inbound-notice.js";
import { isDenied } from "../telephony/number-denylist.js";
import { isTelnyxSipCallId } from "../telephony/sip-call-id.js";
import { stripResultEvidence, resultCardView } from "../call-result.js";
import { safeEqual } from "../util.js";
import { MEMORY_MAX_CALLS } from "../call-memory.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
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

export function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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

export function getCall(s, id) {
  return s.calls.find((c) => c.id === id || c.twilioSid === id) || null;
}

export function addTranscript(s, callId, role, text) {
  const call = getCall(s, callId);
  if (!call) return false;
  call.transcript.push({ role, text, at: new Date().toISOString() });
  return true;
}

export function purgeTranscript(s, callId) {
  const call = getCall(s, callId);
  if (!call || call.transcript.length === 0) return false;
  call.transcript = [];
  return true;
}

export function tenantCallScope(s, tenantId) {
  const calls = s.calls.filter((c) => c.tenantId === tenantId);
  return { calls, callIds: new Set(calls.map((c) => c.id)) };
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

export function exportTenantData(s, tenantId) {
  const { calls, callIds } = tenantCallScope(s, tenantId);
  return {
    tenantId,
    exportedAt: new Date().toISOString(),
    privateNumber: findTenant(s, tenantId)?.privateNumber ?? null,
    calls,
    actionItems: s.actionItems.filter((a) => callIds.has(a.callId)),
    notifications: s.notifications.filter((n) => callIds.has(n.callId)),
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

export function markAnswered(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "answeredAt");
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

export function endCallRecord(s, callId, status = "completed") {
  return setCallEndedAt(s, callId, status, new Date().toISOString());
}

export function markSummarySmsSent(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "summarySmsSentAt");
}

export function markSummaryMailSent(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "summaryMailSentAt");
}

export function markBilled(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "billedAt");
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

export function recordCallEstimatedCostCents(s, callId, { costCents, chargeAnchors }) {
  const call = getCall(s, callId);
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

export function recordCallCostTruingResult(s, callId, { source, actualCostMicroCents, closedAt }) {
  const call = getCall(s, callId);
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

export function recordFailureReason(s, callId, reason) {
  const call = getCall(s, callId);
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

export function countCallerTurn(s, callId) {
  const call = getCall(s, callId);
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
  return Array.isArray(questions) ? questions.filter((q) => typeof q === "string" && q) : [];
}

export function emitConsult(s, callId, questions) {
  const call = getCall(s, callId);
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

export function pendingConsult(s, callId, afterEventId) {
  const call = getCall(s, callId);
  if (!call || !Array.isArray(call.consults)) return null;
  const afterSeq = consultSeqOf(afterEventId);
  return (
    call.consults.find(
      (c) => c.status === CONSULT_STATUS.OPEN && (afterSeq === null || c.seq > afterSeq),
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

function openConsultFor(s, callId, eventId) {
  const call = getCall(s, callId);
  if (!call || call.status !== "active")
    return { call: call || null, consult: null, outcome: CONSULT_ANSWER.CALL_ENDED };
  const consult = Array.isArray(call.consults)
    ? call.consults.find((c) => c.id === eventId)
    : null;
  if (!consult) return { call, consult: null, outcome: CONSULT_ANSWER.UNKNOWN_EVENT };
  if (consult.status !== CONSULT_STATUS.OPEN)
    return { call, consult, outcome: CONSULT_ANSWER.ALREADY_ANSWERED };
  return { call, consult, outcome: null };
}

export function answerConsult(s, callId, { eventId, facts, nowMs, openMs }) {
  const { call, consult, outcome } = openConsultFor(s, callId, eventId);
  const reject = (o) => ({ call: call || null, changed: false, outcome: o, mergedFacts: 0 });
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

export function addLookupFacts(s, callId, facts) {
  const call = getCall(s, callId);
  if (!call) return { call: null, changed: false, added: 0 };
  const added = mergeContextFacts(call, facts);
  return { call, changed: added > 0, added };
}

export function countCallLookup(s, callId) {
  const call = getCall(s, callId);
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

export function expireOpenConsults(s, callId) {
  const call = getCall(s, callId);
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

export function markConsultAnswerDelivered(s, callId) {
  const call = getCall(s, callId);
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

export function markConsultAskDelivered(s, callId, eventId) {
  const call = getCall(s, callId);
  const consult = Array.isArray(call?.consults)
    ? call.consults.find((c) => c.id === eventId)
    : null;
  if (!consult || consult.status !== CONSULT_STATUS.OPEN || consult.askDeliveredAt)
    return { call: call || null, changed: false };
  consult.askDeliveredAt = new Date().toISOString();
  return { call, changed: true };
}

export function ackConsult(s, callId, { eventId }) {
  const { call, consult, outcome } = openConsultFor(s, callId, eventId);
  if (outcome) return { call: call || null, changed: false, outcome };
  if (consult.ackedAt) return { call, changed: false, outcome: CONSULT_ANSWER.ACCEPTED };
  consult.ackedAt = new Date().toISOString();
  return { call, changed: true, outcome: CONSULT_ANSWER.ACCEPTED };
}

export function timeOutStagedConsult(s, callId, { consultId, reason, nowMs, stageMs }) {
  const call = getCall(s, callId);
  const consult = call?.consults?.find((c) => c.id === consultId) ?? null;
  const idle = { call: call || null, changed: false, wait: CONSULT_WAIT.NONE };
  if (!consult || consult.status !== CONSULT_STATUS.OPEN) return idle;
  if (consultAlive(consultAgeMs(consult, nowMs), stageMs)) return idle;
  consult.status = CONSULT_STATUS.TIMED_OUT;
  consult.timeoutReason = reason;
  return { call, changed: true, wait: CONSULT_WAIT.TIMED_OUT };
}

export function noteConsultPoll(s, callId, nowMs = Date.now()) {
  const call = getCall(s, callId);
  if (call) call.consultPolledAtMs = nowMs;
}

export function advanceInCallConsult(s, callId, { nowMs, waitMs, openMs }) {
  const call = getCall(s, callId);
  const idle = { call: call || null, changed: false, wait: CONSULT_WAIT.NONE };
  if (!call) return idle;
  if (consultAnswerAwaitingDelivery(call))
    return { call, changed: false, wait: CONSULT_WAIT.ANSWERED };
  const consult = inCallConsults(call).find((c) => c.status === CONSULT_STATUS.OPEN);
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

export function countNoSpeechTurn(s, callId) {
  const call = getCall(s, callId);
  if (!call) return 0;
  call.noSpeechStreak = (call.noSpeechStreak || 0) + 1;
  return call.noSpeechStreak;
}

export function clearNoSpeechStreak(s, callId) {
  const call = getCall(s, callId);
  if (call) call.noSpeechStreak = 0;
}

export function countOutboundCallsSince(
  s,
  sinceIso,
  { requestedBy = null, tenantId = null, to = null } = {},
) {
  return s.calls.filter(
    (c) =>
      c.direction === "outbound" &&
      c.startedAt >= sinceIso &&
      (requestedBy == null || c.requestedBy === requestedBy) &&
      (tenantId == null || c.tenantId === tenantId) &&
      (to == null || c.to === to),
  ).length;
}

export function activeCallsFor(s, tenantId) {
  return s.calls.filter((c) => c.tenantId === tenantId && c.status === "active");
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

function existingActionItem(s, callId, key) {
  return s.actionItems.find((a) => a.callId === callId && actionItemKey(a.text) === key) || null;
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

export function callActionItems(s, callId) {
  return s.actionItems.filter((item) => item.callId === callId).reverse();
}

export function toggleActionItem(s, id) {
  const item = s.actionItems.find((a) => a.id === id);
  if (item) item.done = !item.done;
  return item;
}

export function calendarFor(s, tenantId) {
  return (s.calendar[tenantId] ||= []);
}

export function getCalendar(s, tenantId) {
  return calendarFor(s, tenantId).sort((a, b) => a.start.localeCompare(b.start));
}

export function addCalendarEvent(s, { tenantId, title, startIso, endIso }) {
  const ev = { id: newId("ev"), title, start: startIso, end: endIso };
  calendarFor(s, tenantId).push(ev);
  return ev;
}

export function findConflict(s, tenantId, startIso, endIso) {
  return getCalendar(s, tenantId).find((ev) => ev.start < endIso && startIso < ev.end) || null;
}

export function numberRecordByE164(s, e164) {
  if (!e164) return null;
  return s.numbers.find((n) => n.e164 === e164 && n.status === NUMBER_STATUS.ACTIVE) || null;
}

export function findTenantByNumber(s, e164) {
  return numberRecordByE164(s, e164)?.tenantId ?? null;
}

export function resolveCallLanguage(s, { tenantId, numberRecord }) {
  const settingsLang = settingsFor(s, tenantId).language;
  const tenant = findTenant(s, tenantId);
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

export function seedBootstrapIdpSubject(s, rawSub, tenantId) {
  const owner = findTenant(s, tenantId);
  if (!owner || owner.idpSubject) return false;
  const sub = typeof rawSub === "string" ? rawSub.trim() : "";
  if (!sub) return false;
  owner.idpSubject = sub;
  return true;
}

export function canTransitionNumber(from, to) {
  return (NUMBER_TRANSITIONS[from] || []).includes(to);
}

export function findNumber(s, id) {
  return s.numbers.find((n) => n.id === id) || null;
}

export const tenantsOf = (s) => s.tenants || [];

export function findTenant(s, id) {
  return tenantsOf(s).find((t) => t.id === id) || null;
}

export function tenantContext(s, ownerName, tenantId) {
  const tenant = findTenant(s, tenantId);
  const effectiveOwner = (tenant && tenant.ownerName) || ownerName;
  return {
    tenantId,
    ownerName: effectiveOwner,
    firstName: (tenant && tenant.firstName) || firstNameOf(effectiveOwner),
    settings: settingsFor(s, tenantId),
    calendar: calendarFor(s, tenantId),
  };
}

function firstNameOf(fullName) {
  return typeof fullName === "string" ? fullName.trim().split(/\s+/)[0] || "" : "";
}

export function applyOwnerIdentity(tenant, firstName, lastName) {
  const fn = typeof firstName === "string" ? firstName.trim() : "";
  const ln = typeof lastName === "string" ? lastName.trim() : "";
  const full = [fn, ln].filter(Boolean).join(" ");
  if (fn) tenant.firstName = fn;
  if (full) tenant.ownerName = full;
}

export function setTenantIdentityIfAbsent(s, tenantId, { firstName, lastName } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.ownerName) return false;
  applyOwnerIdentity(tenant, firstName, lastName);
  return Boolean(tenant.ownerName);
}

function tenantBudgetRow(s, tenantId) {
  return s.tenantBudgets.find((b) => b.tenantId === tenantId) || null;
}

function seedTenantDefaultBudget(s, tenantId, defaultBudgetCents) {
  if (!defaultBudgetCents) return;
  if (tenantBudgetRow(s, tenantId)) return;
  setTenantBudget(s, tenantId, { budgetCents: defaultBudgetCents, hardCapCents: defaultBudgetCents });
}

export function registerTenant(
  s,
  id,
  { firstName, lastName, privateNumber, idpSubject, defaultBudgetCents, country } = {},
) {
  const e164 = normalizePrivateNumber(privateNumber, country);
  const existing = findTenant(s, id);
  if (existing) {
    if (idpSubject && !existing.idpSubject) existing.idpSubject = idpSubject;
    if (!existing.ownerName) applyOwnerIdentity(existing, firstName, lastName);
    if (e164 && !existing.privateNumber) existing.privateNumber = e164;
    seedTenantDefaultBudget(s, id, defaultBudgetCents);
    return existing;
  }
  const tenant = { id, status: TENANT_STATUS.ACTIVE };
  applyOwnerIdentity(tenant, firstName, lastName);
  if (idpSubject) tenant.idpSubject = idpSubject;
  if (e164) tenant.privateNumber = e164;
  s.tenants.push(tenant);
  seedTenantDefaultBudget(s, id, defaultBudgetCents);
  return tenant;
}

export function setKycLevel(s, tenantId, level) {
  if (!KYC_ORDER.includes(level)) throw new Error(`setKycLevel: unbekannte KYC-Stufe ${level}`);
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setKycLevel: Tenant ${tenantId} nicht gefunden`);
  tenant.kycLevel = level;
  return tenant;
}

export function seedBootstrapKyc(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.kycLevel != null) return false;
  setKycLevel(s, tenantId, KYC_LEVEL.ID_VERIFIED);
  return true;
}

export function kycReached(s, tenantId, minLevel) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.kycLevel == null) return false;
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

export function tenantActiveSubscriber(s, tenantId, minLevel) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.status !== TENANT_STATUS.ACTIVE) return false;
  if (tenant.kycLevel == null) return false;
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

export function tenantInactive(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return !!tenant && tenant.status !== TENANT_STATUS.ACTIVE;
}

export function setSuspendedAtIfAbsent(s, tenantId, nowIso) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.suspendedAt) return { tenant, changed: false };
  tenant.suspendedAt = nowIso;
  return { tenant, changed: true };
}

export function clearSuspendedAt(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || !tenant.suspendedAt) return { tenant, changed: false };
  tenant.suspendedAt = null;
  return { tenant, changed: true };
}

export function tenantSuspendedAt(s, tenantId) {
  return findTenant(s, tenantId)?.suspendedAt ?? null;
}

export function setTenantStripe(
  s,
  tenantId,
  { customerId, paymentMethodId, paymentMethodType } = {},
) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setTenantStripe: Tenant ${tenantId} nicht gefunden`);
  if (customerId !== undefined) tenant.stripeCustomerId = customerId;
  if (paymentMethodId !== undefined) tenant.stripePaymentMethodId = paymentMethodId;
  if (paymentMethodType !== undefined) tenant.stripePaymentMethodType = paymentMethodType;
  return tenant;
}

export function tenantStripe(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    customerId: tenant?.stripeCustomerId ?? null,
    paymentMethodId: tenant?.stripePaymentMethodId ?? null,
    paymentMethodType: tenant?.stripePaymentMethodType ?? null,
  };
}

export function setTenantSubscription(
  s,
  tenantId,
  {
    subscriptionId,
    planSlug,
    currentPeriodEnd,
    currentPeriodStart,
    numberSetupFeeExempt,
    activationPending,
    periodCreditRevoked,
    cancelAtPeriodEnd,
  } = {},
) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setTenantSubscription: Tenant ${tenantId} nicht gefunden`);
  if (planSlug != null && planSlug !== "" && !isKnownPlanSlug(planSlug)) {
    throw new Error(`setTenantSubscription: unbekannter Plan-Slug '${planSlug}' (kein Katalog-Eintrag)`);
  }
  if (subscriptionId !== undefined) tenant.stripeSubscriptionId = subscriptionId;
  if (planSlug !== undefined) tenant.stripePlanSlug = planSlug;
  if (currentPeriodEnd !== undefined) tenant.stripeCurrentPeriodEnd = currentPeriodEnd;
  if (currentPeriodStart !== undefined) tenant.stripeCurrentPeriodStart = currentPeriodStart;
  if (numberSetupFeeExempt !== undefined) tenant.stripeNumberSetupFeeExempt = numberSetupFeeExempt;
  if (activationPending !== undefined) tenant.stripeActivationPending = activationPending;
  if (periodCreditRevoked !== undefined) tenant.stripePeriodCreditRevoked = periodCreditRevoked;
  if (cancelAtPeriodEnd !== undefined) tenant.stripeCancelAtPeriodEnd = cancelAtPeriodEnd;
  return tenant;
}

export function deriveTenantBudgetFromPlan(s, tenantId, cfg) {
  const tenant = findTenant(s, tenantId);
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
  setTenantBudget(s, tenantId, { budgetCents: capCents, hardCapCents: capCents });
}

export function tenantSubscription(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    subscriptionId: tenant?.stripeSubscriptionId ?? null,
    planSlug: tenant?.stripePlanSlug ?? null,
    currentPeriodEnd: tenant?.stripeCurrentPeriodEnd ?? null,
    currentPeriodStart: tenant?.stripeCurrentPeriodStart ?? null,
    numberSetupFeeExempt: tenant?.stripeNumberSetupFeeExempt ?? false,
    activationPending: tenant?.stripeActivationPending ?? false,
    periodCreditRevoked: tenant?.stripePeriodCreditRevoked ?? false,
    cancelAtPeriodEnd: tenant?.stripeCancelAtPeriodEnd ?? false,
  };
}

export function findTenantBySubscription(s, subscriptionId) {
  if (!subscriptionId) return null;
  return s.tenants.find((t) => t.stripeSubscriptionId === subscriptionId) ?? null;
}

export function findTenantByCustomer(s, customerId) {
  if (!customerId) return null;
  return s.tenants.find((t) => t.stripeCustomerId === customerId) ?? null;
}

export function tenantExists(state, tenantId) {
  return findTenant(state, tenantId) !== null;
}

export function setBillingHold(s, tenantId, { reason, dueAtIso = null } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return;
  tenant.billingHold = reason;
  tenant.billingHoldDueAt = dueAtIso;
}

export function clearBillingHold(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return;
  tenant.billingHold = null;
  tenant.billingHoldDueAt = null;
}

export function billingHoldActive(s, tenantId, nowIso) {
  const tenant = findTenant(s, tenantId);
  const reason = tenant?.billingHold ?? null;
  if (!reason) return null;
  const dueAtIso = tenant.billingHoldDueAt;
  if (!dueAtIso) return reason;
  return nowIso >= dueAtIso ? reason : null;
}

export function normalizePrivateNumber(raw, tenantCountryIso) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const e164 = normNum(raw);
  if (!E164.test(e164)) throw new Error("private number: ungueltiges E.164-Format");
  if (isDenied(e164)) throw new Error("private number: gesperrter Nummernbereich");
  if (!countryAllowed(e164, allowedPrivateNumberCodes(tenantCountryIso)))
    throw new Error("private number: Laendercode nicht erlaubt");
  return e164;
}

export function setPrivateNumber(s, tenantId, raw) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setPrivateNumber: Tenant ${tenantId} nicht gefunden`);
  const e164 = normalizePrivateNumber(raw, tenant.country);
  if (e164 === null) delete tenant.privateNumber;
  else tenant.privateNumber = e164;
  return tenant;
}

export function tenantPrivateNumber(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return tenant?.privateNumber ?? null;
}

export function setTenantGeo(s, tenantId, { country, defaultLanguage, timezone } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setTenantGeo: Tenant ${tenantId} nicht gefunden`);
  if (country !== undefined) tenant.country = country;
  if (defaultLanguage !== undefined) tenant.defaultLanguage = defaultLanguage;
  if (timezone !== undefined) tenant.timezone = timezone;
  return tenant;
}

export function tenantGeo(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return { country: tenant?.country ?? null, defaultLanguage: tenant?.defaultLanguage ?? null };
}

export function tenantTimezone(s, tenantId) {
  return findTenant(s, tenantId)?.timezone ?? null;
}

function occupiesCapacity(number) {
  return number.status !== NUMBER_STATUS.RELEASED && number.status !== NUMBER_STATUS.FAILED;
}

function liveNumbers(s, tenantId = null) {
  return s.numbers.filter((n) => occupiesCapacity(n) && (tenantId == null || n.tenantId === tenantId));
}

export function tenantHasLiveNumber(s, tenantId) {
  return liveNumbers(s, tenantId).length > 0;
}

function markNumberProvisionSkipped(tenant, reason) {
  tenant.numberProvisionSkipReason = reason;
  tenant.numberProvisionSkipAt = new Date().toISOString();
}

function clearNumberProvisionSkip(tenant) {
  tenant.numberProvisionSkipReason = null;
  tenant.numberProvisionSkipAt = null;
}

export function failedNumberCount(state, tenantId) {
  return state.numbers.filter(
    (number) => number.tenantId === tenantId && number.status === NUMBER_STATUS.FAILED,
  ).length;
}

export function markTenantNeedsManualReconcile(state, tenantId) {
  const tenant = findTenant(state, tenantId);
  if (!tenant || tenant.numberProvisionSkipReason === NEEDS_MANUAL_RECONCILE_REASON)
    return { tenant: tenant ?? null, changed: false };
  markNumberProvisionSkipped(tenant, NEEDS_MANUAL_RECONCILE_REASON);
  return { tenant, changed: true };
}

export function tenantMayRequestNumber(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return false;
  if (tenant.status === TENANT_STATUS.ACTIVE) return true;
  if (tenant.status === TENANT_STATUS.CLOSED) return false;
  if (tenant.suspendedAt) return false;
  return tenant.stripeActivationPending === true;
}

export function requestNumber(
  s,
  {
    tenantId,
    provider = DEFAULT_PROVIDER,
    country = DEFAULT_COUNTRY,
    language = languageForCountry(country),
    maxNumbers,
    maxNumbersPerTenant,
  },
) {
  const tenant = findTenant(s, tenantId);
  if (!tenantMayRequestNumber(s, tenantId))
    return { ok: false, reason: REQUEST_NUMBER_REASON.TENANT_INACTIVE };
  if (liveNumbers(s).length >= maxNumbers) {
    markNumberProvisionSkipped(tenant, GLOBAL_CAP_REASON);
    return { ok: false, reason: GLOBAL_CAP_REASON };
  }
  if (liveNumbers(s, tenantId).length >= maxNumbersPerTenant)
    return { ok: false, reason: REQUEST_NUMBER_REASON.TENANT_CAP };
  const number = {
    id: newId("num"),
    e164: null,
    tenantId,
    provider,
    country,
    language,
    status: NUMBER_STATUS.REQUESTED,
    providerNumberId: null,
    paymentIntentId: null,
  };
  s.numbers.push(number);
  clearNumberProvisionSkip(tenant);
  return { ok: true, number };
}

const CALL_STATUS_ACTIVE = "active";

function isOpenBinding(binding) {
  return binding.releasedAt === null;
}

function findOpenBinding(state, e164, purpose) {
  return state.platformNumberUse.find(
    (binding) => binding.e164 === e164 && binding.purpose === purpose && isOpenBinding(binding),
  );
}

function closingTimestamp() {
  return new Date().toISOString();
}

export function platformNumberBindings(state, e164) {
  if (!e164) return [];
  return state.platformNumberUse.filter((binding) => binding.e164 === e164 && isOpenBinding(binding));
}

export function openPlatformBindingByPurpose(state, purpose) {
  return state.platformNumberUse.find((binding) => binding.purpose === purpose && isOpenBinding(binding));
}

function bindingBelongsTo(binding, tenantId) {
  return binding.tenantId === tenantId;
}

export function numberBusyReason(state, number, { forTenantId = null } = {}) {
  const bindings = platformNumberBindings(state, number.e164);
  const blockedByForeignBinding = bindings.some(
    (binding) => forTenantId === null || !bindingBelongsTo(binding, forTenantId),
  );
  if (blockedByForeignBinding) return NUMBER_HOLD_REASON.PLATFORM_IN_USE;
  if (
    number.e164 &&
    state.calls.some(
      (call) => call.status === CALL_STATUS_ACTIVE && (call.from === number.e164 || call.to === number.e164),
    )
  )
    return NUMBER_HOLD_REASON.ACTIVE_CALL;
  return null;
}

export function bindPlatformNumber(state, { e164, purpose, provider, tenantId = null, providerNumberId = null, note = null }) {
  const open = findOpenBinding(state, e164, purpose);
  if (open) return open;
  const binding = {
    id: newId("pnu"), e164, purpose, provider, tenantId, providerNumberId,
    boundAt: new Date().toISOString(), releasedAt: null, note,
  };
  state.platformNumberUse.push(binding);
  return binding;
}

export function unbindPlatformNumber(state, { e164, purpose }) {
  const open = findOpenBinding(state, e164, purpose);
  if (!open) return null;
  open.releasedAt = closingTimestamp();
  return open;
}

export function unbindOwnPlatformBindings(state, number) {
  if (!number.e164) return [];
  const closed = [];
  for (const binding of platformNumberBindings(state, number.e164)) {
    if (!bindingBelongsTo(binding, number.tenantId)) continue;
    binding.releasedAt = closingTimestamp();
    closed.push(binding);
  }
  return closed;
}

export function syncPlatformBindings(state, desired) {
  for (const { purpose, e164, provider, tenantId = null, note = null } of desired) {
    for (const binding of state.platformNumberUse)
      if (binding.purpose === purpose && isOpenBinding(binding) && binding.e164 !== e164)
        binding.releasedAt = closingTimestamp();
    if (e164) bindPlatformNumber(state, { e164, purpose, provider, tenantId, note });
  }
  return state.platformNumberUse.filter(isOpenBinding);
}

export function openOutageAlert(state, code) {
  return state.outageAlerts.find((alert) => alert.code === code && alert.closedAt === null);
}

export function claimOutageAlert(state, { code, nowMs, sent = false, channels = [] }) {
  const nowIso = new Date(nowMs).toISOString();
  let marker = openOutageAlert(state, code);
  if (marker) {
    marker.lastSeenAt = nowIso;
  } else {
    marker = {
      id: newId("otg"),
      code,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastAttemptAt: null,
      reportedAt: null,
      deliveredChannels: null,
      closedAt: null,
    };
    state.outageAlerts.push(marker);
  }
  if (sent) {
    marker.lastAttemptAt = nowIso;
    if (channels.length > 0) {
      marker.reportedAt = nowIso;
      marker.deliveredChannels = channels.join(",");
    }
  }
  return marker;
}

export function closeOutageAlert(state, { code, nowMs }) {
  const marker = openOutageAlert(state, code);
  if (!marker) return null;
  marker.closedAt = new Date(nowMs).toISOString();
  return marker;
}

const NUMBER_OUT_OF_SERVICE = new Set([NUMBER_STATUS.RELEASED, NUMBER_STATUS.SUSPENDED]);

export function transitionNumber(s, numberId, toStatus) {
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`transitionNumber: Nummer ${numberId} nicht gefunden`);
  if (!canTransitionNumber(number.status, toStatus))
    throw new Error(`transitionNumber: illegaler Uebergang ${number.status} -> ${toStatus}`);
  if (NUMBER_OUT_OF_SERVICE.has(toStatus)) {
    const busy = numberBusyReason(s, number);
    if (busy)
      throw new Error(
        `transitionNumber: Nummer ${numberId} ist gesperrt (${busy}) - Uebergang nach ${toStatus} abgelehnt`,
      );
  }
  number.status = toStatus;
  return number;
}

export function beginProvisioning(s, numberId) {
  return transitionNumber(s, numberId, NUMBER_STATUS.PROVISIONING);
}

export function attachNumberPaymentIntent(s, numberId, paymentIntentId) {
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`attachNumberPaymentIntent: Nummer ${numberId} nicht gefunden`);
  number.paymentIntentId = paymentIntentId;
  return number;
}

export function attachNumberRegistration(state, numberId, providerAgentPhoneNumberId) {
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`attachNumberRegistration: Nummer ${numberId} nicht gefunden`);
  if (number.providerAgentPhoneNumberId) return number;
  number.providerAgentPhoneNumberId = providerAgentPhoneNumberId;
  return number;
}

const INBOUND_TRUNK_BELEG_FELDER = Object.freeze(["elInboundTrunkBelegtAt", "elInboundTrunkZugangFp"]);

function hatInboundTrunkBeleg(number) {
  return INBOUND_TRUNK_BELEG_FELDER.some((feld) => number[feld] !== undefined && number[feld] !== null);
}

export function markNumberElInboundTrunkBelegt(state, numberId, { nowIso, zugangFp }) {
  if (!nowIso || !zugangFp) throw new Error("markNumberElInboundTrunkBelegt: nowIso und zugangFp sind Pflicht");
  const number = findNumber(state, numberId);
  if (number?.status !== NUMBER_STATUS.ACTIVE) return { number, changed: false };
  if (number.elInboundTrunkZugangFp === zugangFp && number.elInboundTrunkBelegtAt) return { number, changed: false };
  number.elInboundTrunkBelegtAt = nowIso;
  number.elInboundTrunkZugangFp = zugangFp;
  return { number, changed: true };
}

export function clearNumberElInboundTrunkBeleg(state, numberId) {
  const number = findNumber(state, numberId);
  if (!number || !hatInboundTrunkBeleg(number)) return { number, changed: false };
  for (const feld of INBOUND_TRUNK_BELEG_FELDER) delete number[feld];
  return { number, changed: true };
}

export function beginCapturing(s, numberId) {
  return transitionNumber(s, numberId, NUMBER_STATUS.CAPTURING);
}

export function activateNumber(s, numberId, { e164, providerNumberId, monthlyCostCents = null }) {
  const number = transitionNumber(s, numberId, NUMBER_STATUS.ACTIVE);
  number.e164 = e164;
  number.providerNumberId = providerNumberId ?? null;
  if (monthlyCostCents !== null) number.monthlyCostCents = monthlyCostCents;
  s.numberAssignments.push({
    id: newId("asg"),
    numberId: number.id,
    tenantId: number.tenantId,
    assignedAt: new Date().toISOString(),
    releasedAt: null,
  });
  return number;
}

export function failNumber(s, numberId) {
  return transitionNumber(s, numberId, NUMBER_STATUS.FAILED);
}

export function releaseNumber(s, numberId) {
  const number = transitionNumber(s, numberId, NUMBER_STATUS.RELEASED);
  number.e164 = null;
  number.providerAgentPhoneNumberId = null;
  for (const feld of INBOUND_TRUNK_BELEG_FELDER) delete number[feld];
  const asg = s.numberAssignments.find((a) => a.numberId === numberId && !a.releasedAt);
  if (asg) asg.releasedAt = new Date().toISOString();
  return number;
}

export function recordProvisioningJob(s, { numberId, tenantId, idempotencyKey }) {
  const existing = s.provisioningJobs.find((j) => j.idempotencyKey === idempotencyKey);
  if (existing) return existing;
  const job = {
    id: newId("job"),
    numberId,
    tenantId,
    kind: PROVISION_NUMBER_JOB,
    status: PROVISIONING_JOB_STATUS.QUEUED,
    idempotencyKey,
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  s.provisioningJobs.push(job);
  return job;
}

export function markProvisioningJob(s, jobId, status, lastError = null) {
  const job = s.provisioningJobs.find((j) => j.id === jobId);
  if (!job) return null;
  job.status = status;
  job.attempts += 1;
  if (lastError) job.lastError = lastError;
  return job;
}

const PROVISION_CLOSE_NUMBER_STATUS = new Set([
  NUMBER_STATUS.ACTIVE,
  NUMBER_STATUS.FAILED,
  NUMBER_STATUS.RELEASED,
  NUMBER_STATUS.SUSPENDED,
]);

export function redriveAgeHoldReason(job, nowMs, maxAgeMs) {
  const createdMs = Date.parse(job.createdAt ?? "");
  if (!job.createdAt || Number.isNaN(createdMs)) return "unknown_age";
  if (nowMs - createdMs > maxAgeMs) return "too_old";
  return null;
}

export function classifyQueuedProvisioningJobs(s, { nowMs, maxAgeMs, kycMinLevel }) {
  const buckets = { close: [], hold: [], redrive: [] };
  for (const job of s.provisioningJobs) {
    if (job.status !== PROVISIONING_JOB_STATUS.QUEUED) continue;
    const number = findNumber(s, job.numberId);
    if (!number || PROVISION_CLOSE_NUMBER_STATUS.has(number.status)) {
      buckets.close.push(job);
      continue;
    }
    if (number.status !== NUMBER_STATUS.REQUESTED) {
      buckets.hold.push({ job, reason: `mid_flight_${number.status}` });
      continue;
    }
    if (!tenantActiveSubscriber(s, job.tenantId, kycMinLevel)) {
      buckets.hold.push({ job, reason: "no_active_subscriber" });
      continue;
    }
    const ageHoldReason = redriveAgeHoldReason(job, nowMs, maxAgeMs);
    if (ageHoldReason) {
      buckets.hold.push({ job, reason: ageHoldReason });
      continue;
    }
    buckets.redrive.push(job);
  }
  return buckets;
}

export const RELEASE_VERDICT = Object.freeze({ RELEASE: "release", HOLD: "hold", SKIP: "skip" });

export function numberReleaseVerdict(s, number, { nowMs, graceMs }) {
  if (number.status !== NUMBER_STATUS.ACTIVE)
    return { action: RELEASE_VERDICT.SKIP, reason: `not_active_${number.status}` };
  const suspendedAt = tenantSuspendedAt(s, number.tenantId);
  if (!suspendedAt) return { action: RELEASE_VERDICT.SKIP, reason: "tenant_not_suspended" };
  const suspendedMs = Date.parse(suspendedAt);
  if (Number.isNaN(suspendedMs))
    return { action: RELEASE_VERDICT.SKIP, reason: "suspended_at_unparsebar" };
  if (nowMs - suspendedMs <= graceMs)
    return { action: RELEASE_VERDICT.SKIP, reason: "grace_not_reached" };
  const busy = numberBusyReason(s, number, { forTenantId: number.tenantId });
  if (busy) return { action: RELEASE_VERDICT.HOLD, reason: busy };
  if (number.provider !== PROVIDER.TELNYX)
    return { action: RELEASE_VERDICT.HOLD, reason: NUMBER_HOLD_REASON.NON_TELNYX };
  return { action: RELEASE_VERDICT.RELEASE, reason: null };
}

export function classifyNumbersForRelease(s, { nowMs, graceMs }) {
  const buckets = { release: [], hold: [], skip: [] };
  for (const number of s.numbers) {
    const { action, reason } = numberReleaseVerdict(s, number, { nowMs, graceMs });
    if (action === RELEASE_VERDICT.RELEASE) buckets.release.push(number);
    else if (action === RELEASE_VERDICT.HOLD) buckets.hold.push({ number, reason });
    else buckets.skip.push({ number, reason });
  }
  return buckets;
}

export function tenantNumbersForErase(s, tenantId) {
  const buckets = { release: [], hold: [] };
  for (const n of s.numbers) {
    if (n.tenantId !== tenantId) continue;
    if (n.status !== NUMBER_STATUS.ACTIVE) continue;
    if (n.provider !== PROVIDER.TELNYX) continue;
    const busy = numberBusyReason(s, n, { forTenantId: tenantId });
    if (busy) buckets.hold.push({ number: n, reason: busy });
    else buckets.release.push(n);
  }
  return buckets;
}

export function setContractEndCleanupPending(
  s,
  tenantId,
  { numberReleasePending, workosDeletePending } = {},
) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return null;
  if (numberReleasePending !== undefined) tenant.numberReleasePending = numberReleasePending;
  if (workosDeletePending !== undefined) tenant.workosDeletePending = workosDeletePending;
  return tenant;
}

export function contractEndCleanupPending(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    numberReleasePending: tenant?.numberReleasePending ?? false,
    workosDeletePending: tenant?.workosDeletePending ?? false,
  };
}

export function tenantsPendingContractEndCleanup(s) {
  return tenantsOf(s).filter((t) => t.numberReleasePending || t.workosDeletePending);
}

export function platformHoldEscalationCandidates(state, { nowMs, maxAgeMs }) {
  const candidates = [];
  for (const tenant of tenantsPendingContractEndCleanup(state)) {
    if (!tenant.numberReleasePending) continue;
    const suspendedMs = Date.parse(tenant.suspendedAt ?? "");
    if (Number.isNaN(suspendedMs)) continue;
    if (nowMs - suspendedMs <= maxAgeMs) continue;
    const { hold } = tenantNumbersForErase(state, tenant.id);
    for (const { number, reason } of hold)
      if (reason === NUMBER_HOLD_REASON.PLATFORM_IN_USE) candidates.push(number);
  }
  return candidates;
}

export function paidWithoutNumberCandidates(state, { nowMs, graceMs, kycMinLevel }) {
  const candidates = [];
  for (const tenant of state.tenants) {
    if (!tenantActiveSubscriber(state, tenant.id, kycMinLevel)) continue;
    if (tenantHasLiveNumber(state, tenant.id)) continue;
    const paidSinceIso = resolvePeriodStartIso(tenantSubscription(state, tenant.id));
    if (!paidSinceIso) continue;
    const paidSinceMs = Date.parse(paidSinceIso);
    if (Number.isNaN(paidSinceMs)) continue;
    if (nowMs - paidSinceMs <= graceMs) continue;
    candidates.push({ tenantId: tenant.id, paidSinceIso });
  }
  return candidates;
}

export function allTenantIds(state) {
  return tenantsOf(state).map((tenant) => tenant.id);
}

export function tenantIdpSubject(s, tenantId) {
  return findTenant(s, tenantId)?.idpSubject ?? null;
}

export function setCancellationMailPending(s, tenantId, { pending, receivedAt } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return null;
  if (pending !== undefined) tenant.cancellationMailPending = pending;
  if (receivedAt !== undefined) tenant.cancellationMailReceivedAt = receivedAt;
  return tenant;
}

export function cancellationMailPending(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    pending: tenant?.cancellationMailPending ?? false,
    receivedAt: tenant?.cancellationMailReceivedAt ?? null,
  };
}

export function tenantsPendingCancellationMail(s) {
  return tenantsOf(s).filter((t) => t.cancellationMailPending);
}

export function tenantsForStripeReconcile(s) {
  return tenantsOf(s).filter((t) => t.stripeSubscriptionId && !t.suspendedAt);
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

export function setNewsletterConsent(s, tenantId, consent) {
  if (typeof consent !== "boolean")
    throw new Error("setNewsletterConsent: consent muss boolean sein");
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setNewsletterConsent: Tenant ${tenantId} nicht gefunden`);
  tenant.newsletterConsent = consent;
  tenant.newsletterConsentAt = new Date().toISOString();
  return tenant;
}

export function tenantNewsletterConsent(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    consent: tenant?.newsletterConsent === true,
    consentAt: tenant?.newsletterConsentAt ?? null,
  };
}

export function tenantNewsletterRecipients(s, tenantId) {
  return findTenant(s, tenantId)?.newsletterRecipients ?? [];
}

export function confirmedNewsletterRecipients(s, tenantId) {
  return tenantNewsletterRecipients(s, tenantId).filter((r) => r.status === "confirmed");
}

export function dailyNewsletterConfirmMailCount(s, tenantId, sinceIso) {
  const tenant = findTenant(s, tenantId);
  return (tenant?.newsletterConfirmMailLog ?? []).filter((t) => t >= sinceIso).length;
}

export function addNewsletterRecipient(s, tenantId, { email, tokenHash, tokenExpiresAt, unsubToken, now }) {
  const tenant = findTenant(s, tenantId);
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
    .filter((t) => t >= cutoff)
    .concat(nowIso);
  return tenant.newsletterRecipients[tenant.newsletterRecipients.length - 1];
}

export function removeNewsletterRecipient(s, tenantId, email) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`removeNewsletterRecipient: Tenant ${tenantId} nicht gefunden`);
  const before = (tenant.newsletterRecipients ?? []).length;
  tenant.newsletterRecipients = (tenant.newsletterRecipients ?? []).filter((r) => r.email !== email);
  return tenant.newsletterRecipients.length !== before;
}

export function confirmNewsletterRecipientByToken(s, tokenHash, nowIso) {
  for (const tenant of tenantsOf(s)) {
    const match = (tenant.newsletterRecipients ?? []).find(
      (r) =>
        r.status === "pending" &&
        r.tokenHash &&
        safeEqual(r.tokenHash, tokenHash) &&
        r.tokenExpiresAt > nowIso,
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

export function unsubscribeNewsletterRecipientByToken(s, token) {
  for (const tenant of tenantsOf(s)) {
    const recipients = tenant.newsletterRecipients ?? [];
    const idx = recipients.findIndex((r) => r.unsubToken && safeEqual(r.unsubToken, token));
    if (idx !== -1) {
      const [removed] = recipients.splice(idx, 1);
      return { tenantId: tenant.id, email: removed.email };
    }
  }
  return null;
}

export function usageFor(s, tenantId) {
  return (s.usage[tenantId] ||= emptyUsage());
}

export function usageOf(s, tenantId) {
  return usageFor(s, tenantId);
}

export function globalUsageTotals(s) {
  let inputTokens = 0,
    outputTokens = 0,
    calls = 0,
    microTotal = 0;
  for (const bucket of Object.values(s.usage)) {
    inputTokens += bucket.inputTokens;
    outputTokens += bucket.outputTokens;
    calls += bucket.calls;
    microTotal += bucket.costCents * MICRO_CENTS_PER_CENT + (bucket.costMicroCentsRem || 0);
  }
  return {
    inputTokens,
    outputTokens,
    calls,
    costCents: Math.floor(microTotal / MICRO_CENTS_PER_CENT),
    costMicroCentsRem: microTotal % MICRO_CENTS_PER_CENT,
  };
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

export function inputTokensOf(tokens) {
  return tokens.inputUncachedTokens + tokens.inputCacheWriteTokens + tokens.inputCacheReadTokens;
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
  const previous = new Date(at.getTime());
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return yearMonthKey(previous);
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

function addUsageCostCents(s, { tenantId, costCents, nowIso, quelle }) {
  const usage = usageFor(s, tenantId);
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

export function bookCostCorrectionCents(s, { tenantId, deltaCents, chargeAnchors, nowIso }) {
  const usage = usageFor(s, tenantId);
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

function effectiveCapCents(s, tenantId, cfg) {
  const budget = tenantBudgetRow(s, tenantId);
  if (budget) return budget.hardCapCents;
  const tenantDefaultCents = cfg.defaultTenantBudgetCents;
  return tenantDefaultCents > 0 ? tenantDefaultCents : globalCapCents(cfg);
}

function budgetPeriodUsageCents(bucket) {
  if (!bucket.budgetPeriodKey) return bucket.costCents;
  return Math.max(0, bucket.costCents - bucket.budgetPeriodBaselineCents);
}

export function stampBudgetPeriod(s, tenantId, periodStartIso) {
  if (!periodStartIso) return { changed: false };
  const bucket = usageFor(s, tenantId);
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

function platformSpendMonthCents(s, nowIso) {
  return Object.values(s.usage).reduce((sum, bucket) => sum + spendMonthUsageCents(bucket, nowIso), 0);
}

export function gatePlatformUsageCents(s, cfg, nowIso) {
  return cfg.budgetMonthEnabled ? platformSpendMonthCents(s, nowIso) : globalUsageTotals(s).costCents;
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

export function setTenantBudget(s, tenantId, { budgetCents, hardCapCents }) {
  const existing = tenantBudgetRow(s, tenantId);
  if (existing) {
    existing.budgetCents = budgetCents;
    existing.hardCapCents = hardCapCents;
    return existing;
  }
  const row = { tenantId, budgetCents, hardCapCents };
  s.tenantBudgets.push(row);
  return row;
}

export function aiCostCents(tokens, cfg) {
  return Math.round(tokenCostUsd(tokens, cfg) * cfg.usdToEur * CENTS_PER_EUR);
}

export function recordUsageEvent(
  s,
  {
    tenantId,
    callId = null,
    numberId = null,
    kind,
    quantity,
    costCents,
    costMicroCents = null,
    occurredAt = new Date().toISOString(),
  },
) {
  if (!Object.values(USAGE_EVENT_KIND).includes(kind))
    throw new Error(`recordUsageEvent: unbekanntes kind '${kind}'`);
  const event = {
    id: newId("ue"),
    tenantId,
    callId,
    numberId,
    kind,
    quantity,
    costCents,
    costMicroCents,
    occurredAt,
    stripeMeterSent: false,
  };
  s.usageEvents.push(event);
  return event;
}

export function dailySmsCount(s, tenantId, sinceIso) {
  return s.usageEvents.filter(
    (e) => e.kind === USAGE_EVENT_KIND.SMS && e.tenantId === tenantId && e.occurredAt >= sinceIso,
  ).length;
}

export function voiceMinutesUsedSince(s, tenantId, sinceIso) {
  return s.usageEvents
    .filter(
      (e) =>
        e.kind === USAGE_EVENT_KIND.VOICE_MINUTE &&
        e.tenantId === tenantId &&
        e.occurredAt >= sinceIso,
    )
    .reduce((sum, e) => sum + e.quantity, 0);
}

export function numbersDueForMonthMeter(s, { nowIso, tenantId = null }) {
  const monthKey = spendMonthKeyOf(nowIso);
  if (!monthKey) return [];
  const gebucht = new Set();
  for (const e of s.usageEvents) {
    if (e.kind !== USAGE_EVENT_KIND.NUMBER_MONTH) continue;
    if (!e.numberId) continue;
    if (spendMonthKeyOf(e.occurredAt) !== monthKey) continue;
    gebucht.add(e.numberId);
  }
  return s.numbers.filter(
    (n) =>
      n.status === NUMBER_STATUS.ACTIVE &&
      (tenantId === null || n.tenantId === tenantId) &&
      !gebucht.has(n.id),
  );
}

export function planMinutesExceeded(s, tenantId, { includedMinutes, periodStartIso } = {}) {
  if (!periodStartIso || !Number.isFinite(includedMinutes)) return true;
  return voiceMinutesUsedSince(s, tenantId, periodStartIso) >= includedMinutes;
}

export function pendingMeterEvents(s) {
  return s.usageEvents.filter((e) => !e.stripeMeterSent);
}

export const METER_FLUSH_SKIP = Object.freeze({ NO_EPOCH: "no_flush_epoch" });

export function flushableMeterEvents(s, { flushEpochIso } = {}) {
  const pending = pendingMeterEvents(s);
  const epoch = typeof flushEpochIso === "string" ? parseValidDate(flushEpochIso) : null;
  if (!epoch)
    return { events: [], skipped: pending.length, skipReason: METER_FLUSH_SKIP.NO_EPOCH };
  const epochIso = epoch.toISOString();
  const events = pending.filter((e) => e.occurredAt >= epochIso);
  return { events, skipped: pending.length - events.length, skipReason: null };
}

export function markMeterEventsSent(s, eventIds) {
  const ids = new Set(eventIds);
  let n = 0;
  for (const e of s.usageEvents) {
    if (ids.has(e.id) && !e.stripeMeterSent) {
      e.stripeMeterSent = true;
      n++;
    }
  }
  return n;
}

function findCostEvidence(s, callId, traeger) {
  return s.callCostEvidence.find((zeile) => zeile.callId === callId && zeile.traeger === traeger);
}

export function recordCallCostEvidence(s, eingabe) {
  const { callId, traeger, reife } = eingabe;
  const call = getCall(s, callId);
  if (!call) throw new Error(`recordCallCostEvidence: Anruf '${callId}' nicht gefunden`);
  assertCostEvidenceInput(eingabe);
  const vorhanden = findCostEvidence(s, callId, traeger);
  if (!vorhanden) {
    const zeile = buildCostEvidenceRow({
      id: newId("cce"), tenantId: call.tenantId, callId, eingabe,
    });
    s.callCostEvidence.push(zeile);
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

export function callCostEvidence(s, callId) {
  return s.callCostEvidence
    .filter((zeile) => zeile.callId === callId)
    .sort((links, rechts) => links.traeger.localeCompare(rechts.traeger));
}

export function reservationFor(s, tenantId) {
  return s.reservations[tenantId] || 0;
}

export function reservationsTotal(s) {
  return Object.values(s.reservations).reduce((sum, cents) => sum + cents, 0);
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

function platformSpendObservedCents(s, cfg, nowIso) {
  const total = gatePlatformUsageCents(s, cfg, nowIso) + reservationsTotal(s);
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

export const PLATFORM_TTS_COST_CENTER_ID = "platform:play-tts";

export function ttsQuotaExhausted({ characters, quota }) {
  return quota > 0 && characters >= quota;
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

export function recordRelayTtsCharacters(s, { tenantId, chars, cfg, nowIso }) {
  const tenant = recordTenantTtsCharacters(s, tenantId, chars);
  if (!tenant.changed) return { changed: false, warning: null };
  return { changed: true, warning: bumpPlatformTtsQuota(s, chars, cfg, nowIso).warning };
}

export function platformTtsUsageView(s, cfg, nowIso) {
  const row = s.platformTtsUsage;
  const key = ttsCycleWindowKey(row, cfg, nowIso);
  const characters = key === row.cycleKey ? row.characters : 0;
  return { characters, quota: cfg.ttsCharacterQuota, warnPercent: cfg.ttsCharacterQuotaWarnPercent, cycleKey: key };
}

export function crossCheckDueMonthKey(s, nowIso) {
  const dueMonthKey = previousMonthKeyOf(nowIso);
  if (dueMonthKey === null) return null;
  const checked = laterMonotonicKey(s.costCrossCheck.lastCheckedMonthKey, dueMonthKey);
  return checked === s.costCrossCheck.lastCheckedMonthKey && checked !== null ? null : dueMonthKey;
}

export function markCrossCheckAttempted(s, monthKey) {
  s.costCrossCheck.lastCheckedMonthKey = laterMonotonicKey(s.costCrossCheck.lastCheckedMonthKey, monthKey);
}

export function actualCostMicroCentsForMonth(s, monthKey) {
  return s.calls
    .filter(
      (c) =>
        c.provider === PROVIDER.TELNYX &&
        c.costTruedAt !== null &&
        Number.isSafeInteger(c.actualCostMicroCents) &&
        c.actualCostMicroCents >= 0 &&
        c.estimatedCostSpendMonthKey === monthKey,
    )
    .reduce((sum, c) => sum + c.actualCostMicroCents, 0);
}

export function carrierGateCostCentsForMonth(s, monthKey) {
  return s.usageEvents
    .filter((e) => e.kind === USAGE_EVENT_KIND.VOICE_MINUTE && spendMonthKeyOf(e.occurredAt) === monthKey)
    .reduce((sum, e) => sum + e.costCents, 0);
}

export function recordTenantTtsCharacters(s, tenantId, chars) {
  if (!Number.isSafeInteger(chars) || chars <= 0) return { changed: false };
  usageFor(s, tenantId).ttsCharacters += chars;
  return { changed: true };
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

export function purgeExpiredDiagnosticTranscripts(s, days) {
  const cutoff = new Date(Date.now() - Math.max(days, 0) * MS_PER_DAY).toISOString();
  let purged = 0;
  for (const call of s.calls) {
    if (call.diagnostic !== true || !call.endedAt || call.endedAt >= cutoff) continue;
    if (purgeTranscript(s, call.id)) purged++;
  }
  return purged;
}

export function purgeExpiredResultEvidence(s, days) {
  const cutoff = new Date(Date.now() - Math.max(days, 0) * MS_PER_DAY).toISOString();
  let purged = 0;
  for (const call of s.calls) {
    if (!call.endedAt || call.endedAt >= cutoff) continue;
    if (stripResultEvidence(call)) purged++;
  }
  return purged;
}

export function pruneOldData(s, { retentionDays, diagnosticRetentionDays, evidenceRetentionDays }) {
  const removed = pruneExpiredRecords(s, retentionDays);
  removed.diagnosticTranscripts = purgeExpiredDiagnosticTranscripts(s, diagnosticRetentionDays);
  removed.resultEvidence = purgeExpiredResultEvidence(s, evidenceRetentionDays);
  return removed;
}

export function hasPrunedSomething(removed) {
  return Object.values(removed).some((n) => n > 0);
}

export function settingsFor(s, tenantId) {
  return (s.settings[tenantId] ||= defaultSettings());
}

function resolveOptionalEnumOverride(value, allowedValues) {
  if (value === null || value === "") return { accepted: true, value: null };
  if (typeof value !== "string") return { accepted: false, value: null };
  const canonical = allowedValues.find((allowed) => allowed.toLowerCase() === value.toLowerCase());
  return canonical === undefined ? { accepted: false, value: null } : { accepted: true, value: canonical };
}

const OPTIONAL_ENUM_FIELDS = Object.freeze({
  language: SUPPORTED_LANGUAGES,
  agentStyle: PERSONA_STYLE_IDS,
});

const FIELD_GUARDS = Object.freeze({ greeting: hasInboundNotice });

export function updateSettings(s, tenantId, patch) {
  const allowed = defaultSettings();
  const changed = [];
  const target = settingsFor(s, tenantId);
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in allowed)) continue;
    const enumValues = OPTIONAL_ENUM_FIELDS[key];
    if (enumValues) {
      const override = resolveOptionalEnumOverride(value, enumValues);
      if (!override.accepted) continue;
      target[key] = override.value;
      changed.push(key);
    } else if (typeof value === typeof allowed[key]) {
      const guard = FIELD_GUARDS[key];
      if (guard && !guard(value)) continue;
      target[key] = value;
      changed.push(key);
    }
  }
  return { settings: target, changed };
}

export function resolveProfile(s, tenantId) {
  return resolveProfileFrom(tenantId, tenantId ? s.profiles[tenantId] : undefined);
}

const subIndexOf = (s) => s.subIndex || {};

export function bindSubToTenant(s, sub, tenantId) {
  if (!sub || !tenantId) return;
  (s.subIndex ||= {})[sub] = tenantId;
}

export function resolveTenant(s, idpSubject) {
  if (!idpSubject) return null;
  const merged = subIndexOf(s)[idpSubject];
  if (merged) return merged;
  const tenant = tenantsOf(s).find((t) => t.idpSubject === idpSubject);
  return tenant ? tenant.id : null;
}

export function listProfiles(s) {
  return s.profiles;
}

export function setProfile(s, tenantId, patch) {
  const clean = sanitizeProfile(patch);
  s.profiles[tenantId] = { ...(s.profiles[tenantId] || {}), ...clean };
  return { profile: s.profiles[tenantId], changed: Object.keys(clean) };
}

export function deleteProfile(s, tenantId) {
  if (!(tenantId in s.profiles)) return false;
  delete s.profiles[tenantId];
  return true;
}
