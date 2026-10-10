import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config.js";
import * as jsonBackend from "./store/json.js";
import { anrufpauseSetzen } from "./store/state-ops.js";
import { makeChainMutex } from "./chain-mutex.js";

async function createPgBackend() {
  const { createPgPoolRunner } = await import("./store/pg-runner.js");
  const { makePgStore } = await import("./store/pg.js");
  const { runner } = await createPgPoolRunner(config.store.databaseUrl);
  const store = makePgStore(runner);
  await store.init();
  return store;
}

let backend;
if (config.store.storeBackend === "pg") {
  try {
    backend = await createPgBackend();
  } catch (err) {
    console.error(
      "[store] FATAL: pg-Backend nicht initialisierbar (STORE_BACKEND=pg). " +
        "DB unerreichbar oder Init fehlgeschlagen. Ursache: " +
        (err && err.message ? err.message : String(err)),
    );
    process.exit(1);
  }
} else {
  backend = jsonBackend;
}

export const {
  load,
  save,
  drainFlushes,
  newId,
  createCall,
  getCall,
  attachActiveCall,
  addTranscript,
  purgeTranscript,
  markAnswered,
  trueUpAnsweredAt,
  recordAnsweredUnclearReason,
  endCallRecord,
  setCallEndedAt,
  markSummarySmsSent,
  markSummaryMailSent,
  markBilled,
  recordWebhookAnchors,
  markInboxEntry,
  takeInboxEntries,
  recordCallEstimatedCostCents,
  recordCallCostTruingResult,
  schliesseKostenAbgleich,
  oeffneKostenAbgleichErneut,
  recordFailureReason,
  recordElevenlabsConversationId,
  recordSipCallId,
  recordCostProfile,
  bindInboundElConversation,
  markInboundElFallback,
  markInboundElNachlaufStarted,
  markNumberElInboundTrunkBelegt,
  clearNumberElInboundTrunkBeleg,
  recordCallCostEvidence,
  callCostEvidence,
  recordActualSender,
  recordFromRegistrationSource,
  recordElDetectorCounts,
  recordProviderCallResult,
  recordProviderCollectedFields,
  recordCalleeConfirmedTimezone,
  countCallerTurn,
  emitConsult,
  answerConsult,
  markConsultAnswerDelivered,
  markConsultAskDelivered,
  ackConsult,
  timeOutStagedConsult,
  expireOpenConsults,
  pendingConsult,
  advanceInCallConsult,
  noteConsultPoll,
  addLookupFacts,
  countCallLookup,
  recordCallLookup,
  finishCallLookup,
  countNoSpeechTurn,
  clearNoSpeechStreak,
  countOutboundCallsSince,
  counterpartyMemory,
  findTenantByNumber,
  numberRecordByE164,
  resolveCallLanguage,
  tenantLanguage,
  addActionItem,
  callActionItems,
  toggleActionItem,
  getCalendar,
  addCalendarEvent,
  findConflict,
  trackUsage,
  budgetExceeded,
  reserveExceedsBudget,
  liveBudgetExceeded,
  activeCallsFor,
  tenantBudgetSnapshot,
  addVoiceUsageCostCents,
  addResearchFeeCostCents,
  applyCostCorrectionCents,
  tryReserveOutboundBudget,
  releaseOutboundReserve,
  releaseOutboundReserveCents,
  reservationOf,
  claimPlatformSpendWarning,
  recordTtsCharacters,
  platformTtsUsageView,
  recordTenantTtsCharacters,
  recordRelayTtsCharacters,
  markCostCrossCheckAttempted,
  usageOf,
  addNotification,
  pruneOldData,
  eraseTenantData,
  exportTenantData,
  updateSettings,
  resolveProfile,
  listProfiles,
  setProfile,
  deleteProfile,
  tenantContext,
  resolveTenant,
  bindSubToTenant,
  ensureTenant,
  setTenantBudget,
  recordUsageEvent,
  dailySmsCount,
  planMinutesExceeded,
  pendingMeterEvents,
  markMeterEventsSent,
  setKycLevel,
  kycReached,
  tenantActiveSubscriber,
  tenantInactive,
  setSuspendedAtIfAbsent,
  clearSuspendedAt,
  tenantSuspendedAt,
  stampBudgetPeriod,
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
  setContractEndCleanupPending,
  contractEndCleanupPending,
  tenantsPendingContractEndCleanup,
  tenantIdpSubject,
  setCancellationMailPending,
  cancellationMailPending,
  tenantsPendingCancellationMail,
  setPrivateNumber,
  tenantPrivateNumber,
  setTenantGeo,
  tenantGeo,
  tenantTimezone,
  seedBootstrapNumber,
  bootstrapTenant,
  setNewsletterConsent,
  tenantNewsletterConsent,
  tenantNewsletterRecipients,
  confirmedNewsletterRecipients,
  dailyNewsletterConfirmMailCount,
  addNewsletterRecipient,
  removeNewsletterRecipient,
  confirmNewsletterRecipientByToken,
  unsubscribeNewsletterRecipientByToken,
} = backend;

export function anrufpauseAktiv() {
  return load().anrufpause === true;
}

export function setzeAnrufpause(an) {
  return anrufpauseSetzen(backend, an);
}

export { classifyCallTime } from "./store/state-ops.js";
export { MAX_CALL_DURATION_CAP_S } from "./store/defaults.js";

const runStoreExclusive = makeChainMutex();
const storeLockContext = new AsyncLocalStorage();
const REENTRANCY_MARKER = Symbol("store-lock-active");
export function withStoreLock(fn) {
  if (storeLockContext.getStore()) {
    throw new Error(
      "withStoreLock reentrant: ein withStoreLock-Body darf NIE erneut withStoreLock aufrufen " +
        "(Deadlock-Schutz). Verschachtelten Store-Lock aufloesen; kritischen Abschnitt kurz halten.",
    );
  }
  return runStoreExclusive(() => storeLockContext.run(REENTRANCY_MARKER, fn));
}
