import { config } from "./config.js";
import * as jsonBackend from "./store/json.js";
import { anrufpauseSetzen } from "./store/state-ops.js";
import { macheSpeicherSperre } from "./store/sperre.js";
import { zustandsFunktionen } from "./store/zustand/anbindung.js";

const VERBINDUNGS_PROBE_SQL = "SELECT 1";

const JSON_SPEICHER_OHNE_DATENBANK = Object.freeze({
  pruefeVerbindung: async () => {},
});

function mitZustandsFunktionen(speicher) {
  return { ...speicher, ...zustandsFunktionen(speicher) };
}

export async function pgBackendFuerRunner(runner) {
  const { makePgStore } = await import("./store/pg.js");
  const store = makePgStore(runner);
  await store.init();
  return mitZustandsFunktionen({
    ...store,
    pruefeVerbindung: () => runner.withClient((client) => client.query(VERBINDUNGS_PROBE_SQL)),
  });
}

async function createPgBackend() {
  const { createPgPoolRunner } = await import("./store/pg-runner.js");
  const { runner } = await createPgPoolRunner(config.store.databaseUrl);
  return pgBackendFuerRunner(runner);
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
  backend = mitZustandsFunktionen({ ...jsonBackend, ...JSON_SPEICHER_OHNE_DATENBANK });
}

export const {
  load,
  save,
  drainFlushes,
  pruefeVerbindung,
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
  anrufpauseAktiv,
  registrierungAnhaengen,
} = backend;

export function setzeAnrufpause(an) {
  return anrufpauseSetzen(backend, an);
}

export { classifyCallTime } from "./store/state-ops.js";
export { zustandsFunktionen };
export { MAX_CALL_DURATION_CAP_S } from "./store/defaults.js";

export const withStoreLock = macheSpeicherSperre();
