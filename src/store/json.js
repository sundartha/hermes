import fs from "fs";
import path from "path";
import { config } from "../config.js";
import {
  defaultSettings,
  demoCalendar,
  calendarMap,
  emptyUsage,
  emptyPlatformTtsUsage,
  emptyCostCrossCheck,
  sanitizeProfile,
  BOOTSTRAP_TENANT_ID,
  normNum,
  E164,
  resolveSeedProvider,
  CENTS_PER_EUR,
} from "./defaults.js";
import { findActiveNumber, tenantLanguage as tenantLanguageOf } from "./views.js";
import * as ops from "./state-ops.js";
import { backfillGreetingNotices } from "./greeting-notice-migration.js";

const FILE = path.join(config.server.dataDir, "store.json");

const TMP_SUFFIX_RADIX = 36;
const TMP_SUFFIX_START = 2;
const JSON_INDENT = 2;

let state = null;

export function load() {
  if (state) return state;
  let raw;
  try {
    raw = fs.readFileSync(FILE, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      state = ops.makeDefaultState();
      save();
      return finishLoad();
    }
    throw err;
  }
  try {
    state = JSON.parse(raw);
    migrateLoadedState();
  } catch {
    recoverFromCorruptFile();
  }
  return finishLoad();
}

function recoverFromCorruptFile() {
  const corruptPath = `${FILE}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let backedUp = false;
  try {
    fs.renameSync(FILE, corruptPath);
    backedUp = true;
  } catch (re) {
    console.error(
      `[store] KORRUPTES store.json erkannt - Sicherung FEHLGESCHLAGEN (${re.message}). ` +
        `Original bleibt unveraendert unter ${FILE}. Fail-closed: kein Start mit Defaults.`,
    );
  }
  if (!backedUp) {
    throw new Error("store.json korrupt und forensische Sicherung fehlgeschlagen - fail-closed");
  }
  console.error(
    `[store] KORRUPTES store.json erkannt - umbenannt nach ${corruptPath}. ` +
      "Store startet mit Defaults. DATENVERLUST moeglich, File pruefen.",
  );
  state = ops.makeDefaultState();
  save();
}

const STATE_FIELD_DEFAULTS = Object.freeze({
  notifications: () => [],
  profiles: () => ({}),
  numbers: () => [],
  provisioningJobs: () => [],
  tenantBudgets: () => [],
  usageEvents: () => [],
  callCostEvidence: () => [],
  reservations: () => ({}),
  subIndex: () => ({}),
  platformTtsUsage: emptyPlatformTtsUsage,
  costCrossCheck: emptyCostCrossCheck,
  anrufpause: () => false,
  platformNumberUse: () => [],
  outageAlerts: () => [],
});

function migrateLoadedState() {
  state.settings = migrateSettingsToMap(state.settings);
  state.calendar = migrateCalendarToMap(state.calendar);
  state.usage = migrateUsageToMap(state.usage);
  for (const [field, makeDefault] of Object.entries(STATE_FIELD_DEFAULTS)) {
    state[field] ||= makeDefault();
  }
  state.calls = migrateCallFields(state.calls || []);
}

function finishLoad() {
  seedProfilesFromEnv();
  seedOwnerNumberFromEnv();
  seedOwnerIdpSubjectFromEnv();
  seedOwnerKyc();
  if (backfillGreetingNotices(state).length) save();
  return state;
}

function bucketToCents(bucket) {
  const merged = { ...emptyUsage(), ...bucket };
  if (typeof bucket.costEur === "number") merged.costCents = Math.round(bucket.costEur * CENTS_PER_EUR);
  delete merged.costEur;
  return merged;
}

function migrateFlatToMap(value, { isFlat, mapBucket, defaultBucket }) {
  const source = value && typeof value === "object" ? value : {};
  if (isFlat(source)) return { [BOOTSTRAP_TENANT_ID]: mapBucket(source) };
  const map = {};
  for (const [tenantId, bucket] of Object.entries(source)) map[tenantId] = mapBucket(bucket);
  map[BOOTSTRAP_TENANT_ID] ||= defaultBucket();
  return map;
}

function migrateUsageToMap(usage) {
  return migrateFlatToMap(usage, {
    isFlat: (bucket) => typeof bucket.costEur === "number",
    mapBucket: bucketToCents,
    defaultBucket: emptyUsage,
  });
}

function migrateSettingsToMap(settings) {
  return migrateFlatToMap(settings, {
    isFlat: (bucket) => typeof bucket.agentName === "string",
    mapBucket: (bucket) => ({ ...defaultSettings(), ...bucket }),
    defaultBucket: defaultSettings,
  });
}

function migrateCalendarToMap(calendar) {
  if (Array.isArray(calendar)) return { [BOOTSTRAP_TENANT_ID]: calendar };
  if (!calendar || typeof calendar !== "object") return calendarMap();
  const map = {};
  for (const [tenantId, events] of Object.entries(calendar)) {
    map[tenantId] = events;
  }
  map[BOOTSTRAP_TENANT_ID] ||= demoCalendar();
  return map;
}

const CALL_FIELD_DEFAULTS = Object.freeze({
  estimatedCostCents: null,
  estimatedCostSpendMonthKey: null,
  estimatedCostPeriodKey: null,
  actualCostMicroCents: null,
  costTruedAt: null,
  costTruedSource: null,
  costTruingAttempts: 0,
  telnyxConversationId: null,
  elevenlabsConversationId: null,
  sipCallId: null,
  costProfile: null,
  elBoundAt: null,
  elFallbackAt: null,
  elNachlaufStartedAt: null,
  callerTurns: 0,
  result: null,
  consults: null,
  calleeIsOwner: false,
  callerIsOwner: false,
  inboxEntryAt: null,
  inboxSeenAt: null,
  webhookAnchors: [],
});

function migrateCallFields(calls) {
  for (const call of calls) {
    for (const [field, fallback] of Object.entries(CALL_FIELD_DEFAULTS))
      call[field] ??= Array.isArray(fallback) ? [...fallback] : fallback;
  }
  return calls;
}

function seedProfilesFromEnv() {
  if (!config.tenancy.profilesSeed) return;
  let parsed;
  try {
    parsed = JSON.parse(config.tenancy.profilesSeed);
  } catch {
    console.error("[profiles] PROFILES_JSON ist kein gueltiges JSON - ignoriert");
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("[profiles] PROFILES_JSON muss ein Objekt {tenantId: {...}} sein - ignoriert");
    return;
  }
  const seeded = {};
  for (const [key, value] of Object.entries(parsed)) seeded[key] = sanitizeProfile(value);
  state.profiles = { ...seeded, ...state.profiles };
}

function seedOwnerNumberFromEnv() {
  const raw = config.provisioning.ownerNumberSeed;
  if (!raw) return;
  if (findActiveNumber(state, BOOTSTRAP_TENANT_ID)) return;
  const norm = normNum(raw);
  if (!E164.test(norm)) {
    console.error("[owner-number] OWNER_NUMBER_SEED hat kein gueltiges E.164-Format - ignoriert");
    return;
  }
  const provider = resolveSeedProvider(config.provisioning.ownerNumberProvider);
  if (provider === null) {
    console.error(
      "[owner-number] OWNER_NUMBER_PROVIDER ungueltig (erwartet telnyx) - ignoriert",
    );
    return;
  }
  ops.seedBootstrapNumberFromConfig(state, norm, BOOTSTRAP_TENANT_ID, provider);
}

function seedOwnerIdpSubjectFromEnv() {
  ops.seedBootstrapIdpSubject(state, config.auth.ownerIdpSubject, BOOTSTRAP_TENANT_ID);
}

function seedOwnerKyc() {
  ops.seedBootstrapKyc(state, BOOTSTRAP_TENANT_ID);
}

export function save() {
  fs.mkdirSync(config.server.dataDir, { recursive: true });
  const suffix = Math.random().toString(TMP_SUFFIX_RADIX).slice(TMP_SUFFIX_START);
  const tmp = `${FILE}.tmp-${process.pid}-${suffix}`;
  const fd = fs.openSync(tmp, "w");
  try {
    const { reservations, subIndex, platformSpendWarnedMonth, ...persisted } = state;
    const stripEphemeral = (key, value) =>
      key === "_finished" || key === "costMicroCentsRem" ? undefined : value;
    fs.writeFileSync(fd, JSON.stringify(persisted, stripEphemeral, JSON_INDENT));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, FILE);
}

export async function drainFlushes() {}

export const newId = ops.newId;

export function createCall(input) {
  const call = ops.createCall(load(), input);
  save();
  return call;
}

export function getCall(id) {
  return ops.getCall(load(), id);
}

export const attachActiveCall = getCall;

export function addTranscript(callId, role, text) {
  if (ops.addTranscript(load(), callId, role, text)) save();
}

export function purgeTranscript(callId) {
  if (ops.purgeTranscript(load(), callId)) save();
}

export function eraseTenantData(tenantId) {
  const removed = ops.eraseTenantData(load(), tenantId);
  if (removed.calls || removed.actionItems || removed.notifications || removed.privateNumber)
    save();
  return removed;
}

export function exportTenantData(tenantId) {
  return ops.exportTenantData(load(), tenantId);
}

export function markAnswered(callId) {
  const { call, changed } = ops.markAnswered(load(), callId);
  if (changed) save();
  return call;
}

export function trueUpAnsweredAt(callId, answeredAtIso) {
  const { call, changed } = ops.trueUpAnsweredAt(load(), callId, answeredAtIso);
  if (changed) save();
  return call;
}

export function recordAnsweredUnclearReason(callId, reason) {
  const { call, changed } = ops.recordAnsweredUnclearReason(load(), callId, reason);
  if (changed) save();
  return call;
}

export function recordElDetectorCounts(callId, zaehlung) {
  const { call, changed } = ops.recordElDetectorCounts(load(), callId, zaehlung);
  if (changed) save();
  return call;
}

export function endCallRecord(callId, status = "completed") {
  const { call, changed } = ops.endCallRecord(load(), callId, status);
  if (changed) save();
  return call;
}

export function setCallEndedAt(callId, status, endedAtIso) {
  const { call, changed } = ops.setCallEndedAt(load(), callId, status, endedAtIso);
  if (changed) save();
  return call;
}

export function markSummarySmsSent(callId) {
  const { call, changed } = ops.markSummarySmsSent(load(), callId);
  if (changed) save();
  return call;
}

export function markSummaryMailSent(callId) {
  const { call, changed } = ops.markSummaryMailSent(load(), callId);
  if (changed) save();
  return call;
}

export function markBilled(callId) {
  const { call, changed } = ops.markBilled(load(), callId);
  if (changed) save();
  return call;
}

export function recordWebhookAnchors(callId, anchors) {
  const { call, changed } = ops.recordWebhookAnchors(load(), callId, anchors);
  if (changed) save();
  return call;
}

export function markInboxEntry(callId, qualifies) {
  const { call, changed } = ops.markInboxEntry(load(), callId, qualifies);
  if (changed) save();
  return call;
}

export function takeInboxEntries(tenantId, options) {
  const result = ops.takeInboxEntries(load(), tenantId, options);
  if (result.marked) save();
  return result;
}

export function recordCallEstimatedCostCents(callId, input) {
  const { call, changed } = ops.recordCallEstimatedCostCents(load(), callId, input);
  if (changed) save();
  return call;
}

export function recordCallCostTruingResult(callId, outcome) {
  const { call, changed } = ops.recordCallCostTruingResult(load(), callId, outcome);
  if (changed) save();
  return call;
}

export function schliesseKostenAbgleich(callId, eingabe) {
  const { call, changed } = ops.schliesseKostenAbgleich(load(), callId, eingabe);
  if (changed) save();
  return call;
}

export function oeffneKostenAbgleichErneut(callId) {
  const { call, changed } = ops.oeffneKostenAbgleichErneut(load(), callId);
  if (changed) save();
  return call;
}

export function recordFailureReason(callId, reason) {
  const { call, changed } = ops.recordFailureReason(load(), callId, reason);
  if (changed) save();
  return call;
}

export function recordElevenlabsConversationId(callId, conversationId) {
  const { call, changed } = ops.recordElevenlabsConversationId(load(), callId, conversationId);
  if (changed) save();
  return call;
}

export function recordSipCallId(callId, sipCallId) {
  const { call, changed } = ops.recordSipCallId(load(), callId, sipCallId);
  if (changed) save();
  return call;
}

export function recordCostProfile(callId, profil) {
  const { call, changed } = ops.recordCostProfile(load(), callId, profil);
  if (changed) save();
  return call;
}

function speichereBeiAenderung(ergebnis) {
  if (ergebnis.changed) save();
  return ergebnis;
}
export function bindInboundElConversation(callId, bindung) {
  return speichereBeiAenderung(ops.bindInboundElConversation(load(), callId, bindung));
}
export function markInboundElFallback(callId, nowIso) {
  return speichereBeiAenderung(ops.markInboundElFallback(load(), callId, nowIso));
}
export function markInboundElNachlaufStarted(callId, nowIso) {
  return speichereBeiAenderung(ops.markInboundElNachlaufStarted(load(), callId, nowIso));
}
export function markNumberElInboundTrunkBelegt(numberId, beleg) {
  return speichereBeiAenderung(ops.markNumberElInboundTrunkBelegt(load(), numberId, beleg));
}
export function clearNumberElInboundTrunkBeleg(numberId) {
  return speichereBeiAenderung(ops.clearNumberElInboundTrunkBeleg(load(), numberId));
}

export function recordFromRegistrationSource(callId, quelle) {
  const { call, changed } = ops.recordFromRegistrationSource(load(), callId, quelle);
  if (changed) save();
  return call;
}
export function recordActualSender(callId, herkunft) {
  const { call, changed } = ops.recordActualSender(load(), callId, herkunft);
  if (changed) save();
  return call;
}

export function recordProviderCallResult(callId, result) {
  const { call, changed } = ops.recordProviderCallResult(load(), callId, result);
  if (changed) save();
  return call;
}

export function recordProviderCollectedFields(callId, fields) {
  const { call, changed } = ops.recordProviderCollectedFields(load(), callId, fields);
  if (changed) save();
  return call;
}

export function recordCalleeConfirmedTimezone(callId, confirmed) {
  const { call, changed } = ops.recordCalleeConfirmedTimezone(load(), callId, confirmed);
  if (changed) save();
  return call;
}

export function countCallerTurn(callId) {
  const { call, changed } = ops.countCallerTurn(load(), callId);
  if (changed) save();
  return call ? call.callerTurns : 0;
}

export function emitConsult(callId, questions) {
  const { call, changed } = ops.emitConsult(load(), callId, questions);
  if (changed) save();
  return call;
}

export function answerConsult(callId, input) {
  const result = ops.answerConsult(load(), callId, input);
  if (result.changed) save();
  return result;
}

export function markConsultAnswerDelivered(callId) {
  const result = ops.markConsultAnswerDelivered(load(), callId);
  if (result.changed) save();
  return result;
}

export function markConsultAskDelivered(callId, eventId) {
  const result = ops.markConsultAskDelivered(load(), callId, eventId);
  if (result.changed) save();
  return result;
}

export function ackConsult(callId, input) {
  const result = ops.ackConsult(load(), callId, input);
  if (result.changed) save();
  return result;
}

export function timeOutStagedConsult(callId, input) {
  const result = ops.timeOutStagedConsult(load(), callId, input);
  if (result.changed) save();
  return result;
}

export function expireOpenConsults(callId) {
  const { call, changed } = ops.expireOpenConsults(load(), callId);
  if (changed) save();
  return call;
}

export function pendingConsult(callId, afterEventId) {
  return ops.pendingConsult(load(), callId, afterEventId);
}

export function advanceInCallConsult(callId, input) {
  const { changed, wait } = ops.advanceInCallConsult(load(), callId, input);
  if (changed) save();
  return wait;
}

export function noteConsultPoll(callId) {
  ops.noteConsultPoll(load(), callId);
}

export function addLookupFacts(callId, facts) {
  const { changed, added } = ops.addLookupFacts(load(), callId, facts);
  if (changed) save();
  return added;
}

export function countCallLookup(callId) {
  return ops.countCallLookup(load(), callId);
}

export function recordCallLookup(callId, query) {
  const { changed, seq } = ops.recordCallLookup(load(), callId, query);
  if (changed) save();
  return seq;
}

export function finishCallLookup(callId, seq, outcome) {
  const { changed } = ops.finishCallLookup(load(), callId, { seq, ...outcome });
  if (changed) save();
  return changed;
}

export function countNoSpeechTurn(callId) {
  return ops.countNoSpeechTurn(load(), callId);
}

export function clearNoSpeechStreak(callId) {
  ops.clearNoSpeechStreak(load(), callId);
}

export function countOutboundCallsSince(sinceIso, filters = {}) {
  return ops.countOutboundCallsSince(load(), sinceIso, filters);
}

export function counterpartyMemory(tenantId, e164) {
  return ops.counterpartyMemory(load(), tenantId, e164);
}

export function findTenantByNumber(e164) {
  return ops.findTenantByNumber(load(), e164);
}

export function numberRecordByE164(e164) {
  return ops.numberRecordByE164(load(), e164);
}

export function resolveCallLanguage(args) {
  return ops.resolveCallLanguage(load(), args);
}

export function tenantLanguage(tenantId) {
  return tenantLanguageOf(load(), tenantId);
}

export function addActionItem(callId, text, type = "todo") {
  const result = ops.addActionItem(load(), callId, text, type);
  if (!result.duplicate) save();
  return result;
}

export function callActionItems(callId) {
  return ops.callActionItems(load(), callId);
}

export function toggleActionItem(id) {
  const item = ops.toggleActionItem(load(), id);
  if (item) save();
  return item;
}

export function getCalendar(tenantId) {
  return ops.getCalendar(load(), tenantId);
}

export function addCalendarEvent(event) {
  const ev = ops.addCalendarEvent(load(), event);
  save();
  return ev;
}

export function findConflict(tenantId, startIso, endIso) {
  return ops.findConflict(load(), tenantId, startIso, endIso);
}

export function tenantContext(tenantId) {
  return ops.tenantContext(load(), "", tenantId);
}

export function trackUsage(tenantId, tokens, cfg) {
  const usage = ops.trackUsage(load(), tenantId, tokens, cfg, new Date().toISOString());
  save();
  return usage;
}

export function usageOf(tenantId) {
  return ops.usageOf(load(), tenantId);
}

export function budgetExceeded(tenantId, cfg) {
  return ops.budgetExceeded(load(), tenantId, cfg, new Date().toISOString());
}

export function liveBudgetExceeded(tenantId, liveCents, cfg) {
  return ops.liveBudgetExceeded(load(), tenantId, liveCents, cfg, new Date().toISOString());
}

export function activeCallsFor(tenantId) {
  return ops.activeCallsFor(load(), tenantId);
}

export function reserveExceedsBudget(tenantId, reserveCents, cfg) {
  return ops.reserveExceedsBudget(load(), tenantId, reserveCents, cfg, new Date().toISOString());
}

export function tenantBudgetSnapshot(tenantId, cfg) {
  return ops.tenantBudgetSnapshot(load(), tenantId, cfg, new Date().toISOString());
}

export function addVoiceUsageCostCents(tenantId, costCents) {
  const usage = ops.addVoiceUsageCostCents(load(), tenantId, costCents, new Date().toISOString());
  save();
  return usage;
}

export function addResearchFeeCostCents(tenantId, costCents) {
  const usage = ops.addResearchFeeCostCents(load(), tenantId, costCents, new Date().toISOString());
  save();
  return usage;
}

export function applyCostCorrectionCents(tenantId, input) {
  const result = ops.applyCostCorrectionCents(load(), tenantId, input, new Date().toISOString());
  if (result.booked) save();
  return result;
}

export function tryReserveOutboundBudget(tenantId, reserveCents, cfg) {
  return ops.tryReserveOutboundBudget(load(), tenantId, reserveCents, cfg, new Date().toISOString());
}

export function releaseOutboundReserve(call) {
  return ops.releaseOutboundReserve(load(), call);
}

export function releaseOutboundReserveCents(tenantId, cents) {
  return ops.releaseOutboundReserveCents(load(), tenantId, cents);
}

export function reservationOf(tenantId) {
  return ops.reservationFor(load(), tenantId);
}

export function claimPlatformSpendWarning(cfg, nowIso) {
  return ops.claimPlatformSpendWarning(load(), cfg, nowIso);
}

export function recordTtsCharacters(chars, nowIso) {
  const result = ops.recordTtsCharacters(load(), chars, config.billing, nowIso);
  if (result.changed) save();
  return result.warning;
}

export function platformTtsUsageView(nowIso) {
  return ops.platformTtsUsageView(load(), config.billing, nowIso);
}

export function recordTenantTtsCharacters(tenantId, chars) {
  const result = ops.recordTenantTtsCharacters(load(), tenantId, chars);
  if (result.changed) save();
  return result;
}

export function recordRelayTtsCharacters(tenantId, chars, nowIso) {
  const result = ops.recordRelayTtsCharacters(load(), {
    tenantId,
    chars,
    cfg: config.billing,
    nowIso,
  });
  if (result.changed) save();
  return result.warning;
}

export function markCostCrossCheckAttempted(monthKey) {
  const loaded = load();
  const before = loaded.costCrossCheck.lastCheckedMonthKey;
  ops.markCrossCheckAttempted(loaded, monthKey);
  if (loaded.costCrossCheck.lastCheckedMonthKey !== before) save();
}

export function setTenantBudget(tenantId, amounts) {
  const row = ops.setTenantBudget(load(), tenantId, amounts);
  save();
  return row;
}

export function recordUsageEvent(input) {
  const event = ops.recordUsageEvent(load(), input);
  save();
  return event;
}

export function recordCallCostEvidence(eingabe) {
  const { evidence, changed } = ops.recordCallCostEvidence(load(), eingabe);
  if (changed) save();
  return evidence;
}

export function callCostEvidence(callId) {
  return ops.callCostEvidence(load(), callId);
}

export function dailySmsCount(tenantId, sinceIso) {
  return ops.dailySmsCount(load(), tenantId, sinceIso);
}

export function planMinutesExceeded(tenantId, opts) {
  return ops.planMinutesExceeded(load(), tenantId, opts);
}

export function pendingMeterEvents() {
  return ops.pendingMeterEvents(load());
}

export function markMeterEventsSent(eventIds) {
  const sentCount = ops.markMeterEventsSent(load(), eventIds);
  if (sentCount) save();
  return sentCount;
}

export function setKycLevel(tenantId, level) {
  const tenant = ops.setKycLevel(load(), tenantId, level);
  save();
  return tenant;
}

export function kycReached(tenantId, minLevel) {
  return ops.kycReached(load(), tenantId, minLevel);
}

export function tenantActiveSubscriber(tenantId, minLevel) {
  return ops.tenantActiveSubscriber(load(), tenantId, minLevel);
}

export function tenantInactive(tenantId) {
  return ops.tenantInactive(load(), tenantId);
}

export function setSuspendedAtIfAbsent(tenantId) {
  const { changed } = ops.setSuspendedAtIfAbsent(load(), tenantId, new Date().toISOString());
  if (changed) save();
}

export function clearSuspendedAt(tenantId) {
  const { changed } = ops.clearSuspendedAt(load(), tenantId);
  if (changed) save();
}

export function stampBudgetPeriod(tenantId, periodStartIso) {
  const { changed } = ops.stampBudgetPeriod(load(), tenantId, periodStartIso);
  if (changed) save();
  return changed;
}

export function tenantSuspendedAt(tenantId) {
  return ops.tenantSuspendedAt(load(), tenantId);
}

export function setTenantStripe(tenantId, patch) {
  const tenant = ops.setTenantStripe(load(), tenantId, patch);
  save();
  return tenant;
}

export function tenantStripe(tenantId) {
  return ops.tenantStripe(load(), tenantId);
}

export function setTenantSubscription(tenantId, patch) {
  const tenant = ops.setTenantSubscription(load(), tenantId, patch);
  ops.deriveTenantBudgetFromPlan(load(), tenantId, config.billing);
  save();
  return tenant;
}

export function tenantSubscription(tenantId) {
  return ops.tenantSubscription(load(), tenantId);
}

export function findTenantBySubscription(subscriptionId) {
  return ops.findTenantBySubscription(load(), subscriptionId);
}

export function findTenantByCustomer(customerId) {
  return ops.findTenantByCustomer(load(), customerId);
}

export function tenantExists(tenantId) {
  return ops.tenantExists(load(), tenantId);
}

export function setBillingHold(tenantId, patch) {
  ops.setBillingHold(load(), tenantId, patch);
  save();
}

export function clearBillingHold(tenantId) {
  ops.clearBillingHold(load(), tenantId);
  save();
}

export function billingHoldActive(tenantId) {
  return ops.billingHoldActive(load(), tenantId, new Date().toISOString());
}

export function setContractEndCleanupPending(tenantId, patch) {
  const tenant = ops.setContractEndCleanupPending(load(), tenantId, patch);
  save();
  return tenant;
}

export function contractEndCleanupPending(tenantId) {
  return ops.contractEndCleanupPending(load(), tenantId);
}

export function tenantsPendingContractEndCleanup() {
  return ops.tenantsPendingContractEndCleanup(load());
}

export function setCancellationMailPending(tenantId, patch) {
  const tenant = ops.setCancellationMailPending(load(), tenantId, patch);
  save();
  return tenant;
}

export function cancellationMailPending(tenantId) {
  return ops.cancellationMailPending(load(), tenantId);
}

export function tenantsPendingCancellationMail() {
  return ops.tenantsPendingCancellationMail(load());
}

export function tenantIdpSubject(tenantId) {
  return ops.tenantIdpSubject(load(), tenantId);
}

export function setPrivateNumber(tenantId, raw) {
  const tenant = ops.setPrivateNumber(load(), tenantId, raw);
  save();
  return tenant;
}

export function tenantPrivateNumber(tenantId) {
  return ops.tenantPrivateNumber(load(), tenantId);
}

export function setTenantGeo(tenantId, patch) {
  const tenant = ops.setTenantGeo(load(), tenantId, patch);
  save();
  return tenant;
}

export function tenantGeo(tenantId) {
  return ops.tenantGeo(load(), tenantId);
}

export function setNewsletterConsent(tenantId, consent) {
  const tenant = ops.setNewsletterConsent(load(), tenantId, consent);
  save();
  return tenant;
}

export function tenantNewsletterConsent(tenantId) {
  return ops.tenantNewsletterConsent(load(), tenantId);
}

export function tenantNewsletterRecipients(tenantId) {
  return ops.tenantNewsletterRecipients(load(), tenantId);
}

export function confirmedNewsletterRecipients(tenantId) {
  return ops.confirmedNewsletterRecipients(load(), tenantId);
}

export function dailyNewsletterConfirmMailCount(tenantId, sinceIso) {
  return ops.dailyNewsletterConfirmMailCount(load(), tenantId, sinceIso);
}

export function addNewsletterRecipient(tenantId, recipientInput) {
  const recipient = ops.addNewsletterRecipient(load(), tenantId, recipientInput);
  save();
  return recipient;
}

export function removeNewsletterRecipient(tenantId, email) {
  const changed = ops.removeNewsletterRecipient(load(), tenantId, email);
  if (changed) save();
  return changed;
}

export function confirmNewsletterRecipientByToken(tokenHash, nowIso) {
  const result = ops.confirmNewsletterRecipientByToken(load(), tokenHash, nowIso);
  if (result) save();
  return result;
}

export function unsubscribeNewsletterRecipientByToken(token) {
  const result = ops.unsubscribeNewsletterRecipientByToken(load(), token);
  if (result) save();
  return result;
}

export function tenantTimezone(tenantId) {
  return ops.tenantTimezone(load(), tenantId);
}

export function addNotification(title, body, callId) {
  ops.addNotification(load(), title, body, callId);
  save();
}

export function seedBootstrapNumber(e164, tenantId, provider) {
  ops.seedBootstrapNumber(load(), e164, tenantId, provider);
  save();
}

export function bootstrapTenant(e164, tenantId, provider) {
  ops.bootstrapTenant(load(), e164, tenantId, provider);
  save();
}

export function pruneOldData(
  days = config.privacy.retentionDays,
  diagnosticDays = config.privacy.diagnosticRetentionDays,
  evidenceDays = config.privacy.evidenceRetentionDays,
) {
  const removed = ops.pruneOldData(load(), {
    retentionDays: days,
    diagnosticRetentionDays: diagnosticDays,
    evidenceRetentionDays: evidenceDays,
  });
  if (ops.hasPrunedSomething(removed)) save();
  return removed;
}

export function updateSettings(tenantId, patch) {
  const result = ops.updateSettings(load(), tenantId, patch);
  save();
  return result;
}

export function resolveProfile(tenantId) {
  return ops.resolveProfile(load(), tenantId);
}

export function resolveTenant(idpSubject) {
  return ops.resolveTenant(load(), idpSubject);
}

export function bindSubToTenant(sub, tenantId) {
  ops.bindSubToTenant(load(), sub, tenantId);
}

export async function ensureTenant() {
  return false;
}

export function listProfiles() {
  return ops.listProfiles(load());
}

export function setProfile(tenantId, patch) {
  const result = ops.setProfile(load(), tenantId, patch);
  save();
  return result;
}

export function deleteProfile(tenantId) {
  const ok = ops.deleteProfile(load(), tenantId);
  if (ok) save();
  return ok;
}
