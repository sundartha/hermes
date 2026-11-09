import { config } from "./config.js";
import * as jsonBackend from "./store/json.js";
import { anrufpauseSetzen as anrufpauseSetzenImJson } from "./store/state-ops.js";
import { macheSpeicherSperre } from "./store/sperre.js";
import { zustandsFunktionen } from "./store/zustand/anbindung.js";
import { sperreAusZustand } from "./store/mandant-sql.js";

async function createPgBackend() {
  const { createPgPoolRunner } = await import("./store/pg-runner.js");
  const { makePgStore, einstellungenNachladenVon, anrufpauseGelesenVon, anrufpauseSetzen, mandantSperreGelesenVon } =
    await import("./store/pg.js");
  const { leiteSchluesselAb, makeWebhookZustellung, planeLoeschtakt } = await import(
    "./store/webhook-zustellung.js"
  );
  const startSperre = await import("./store/start-sperre.js");
  const { makeStripeEreignisRegister } = await import("./store/stripe-ereignis-register.js");
  const { runner, poolZustand } = await createPgPoolRunner(config.store.databaseUrl);
  const store = makePgStore(runner);
  await store.init();
  const pruefeVerbindung = () => runner.withClient((client) => client.query("SELECT 1"));
  const zustellungsSchluessel = leiteSchluesselAb(config.auth.webhookZustellungSecret);
  const webhookZustellung = zustellungsSchluessel
    ? makeWebhookZustellung({ runner, schluessel: zustellungsSchluessel })
    : null;
  const starteZustellungsLoeschtakt = () =>
    planeLoeschtakt({
      runner,
      taktMs: config.store.webhookZustellungLoeschtaktMs,
      mitAblage: Boolean(webhookZustellung),
    });
  const mitStartSperre = (routine, arbeit) => startSperre.mitStartSperre(runner, routine, arbeit);
  const nummernVorhanden = () => startSperre.nummernVorhanden(runner);
  const einstellungenNachladen = (tenantId) => einstellungenNachladenVon(store.load(), tenantId);
  return {
    ...store,
    poolZustand,
    pruefeVerbindung,
    webhookZustellung,
    stripeEreignisRegister: makeStripeEreignisRegister(runner),
    starteZustellungsLoeschtakt,
    mitStartSperre,
    nummernVorhanden,
    einstellungenNachladen,
    anrufpauseGelesen: () => anrufpauseGelesenVon(store.load()),
    mandantSperreGelesen: (tenantId) => mandantSperreGelesenVon(store.load(), tenantId),
    anrufpauseSetzen: (an) => anrufpauseSetzen(store, an),
  };
}

function mitZustandsFunktionen(speicher) {
  return { ...speicher, ...zustandsFunktionen(speicher) };
}

let backend;
if (config.store.storeBackend === "pg") {
  try {
    backend = mitZustandsFunktionen(await createPgBackend());
  } catch (err) {
    console.error(
      "[store] FATAL: pg-Backend nicht initialisierbar (STORE_BACKEND=pg). " +
        "DB unerreichbar oder Init fehlgeschlagen. Ursache: " +
        (err && err.message ? err.message : String(err)),
    );
    process.exit(1);
  }
} else {
  backend = mitZustandsFunktionen({
    ...jsonBackend,
    poolZustand: () => null,
    pruefeVerbindung: async () => {},
    webhookZustellung: null,
    stripeEreignisRegister: null,
    starteZustellungsLoeschtakt: () => {},
    mitStartSperre: async (_routine, arbeit) => ({ uebersprungen: false, ergebnis: await arbeit() }),
    nummernVorhanden: async () => jsonBackend.load().numbers.length > 0,
    einstellungenNachladen: async () => true,
    anrufpauseGelesen: async () => jsonBackend.load().anrufpause === true,
    mandantSperreGelesen: async (tenantId) => sperreAusZustand(jsonBackend.load(), tenantId),
    anrufpauseSetzen: (an) => anrufpauseSetzenImJson(jsonBackend, an),
  });
}

export const {
  poolZustand,
  pruefeVerbindung,
  webhookZustellung,
  stripeEreignisRegister,
  starteZustellungsLoeschtakt,
  mitStartSperre,
  nummernVorhanden,
  einstellungenNachladen,
  anrufpauseGelesen,
  mandantSperreGelesen,
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
  markNotPlacedMailSent,
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
  nummerntauschKandidaten,
  ersatzNummerAnfordern,
} = backend;

export async function letzterFlushGelungen() {
  try {
    await backend.drainFlushes();
    return true;
  } catch {
    return false;
  }
}

export function setzeAnrufpause(an) {
  return backend.anrufpauseSetzen(an);
}

export { classifyCallTime } from "./store/state-ops.js";
export { zustandsFunktionen };
export {
  MAX_CALL_DURATION_CAP_S,
  assertKaufbareRufnummer,
  assertKaufbaresLand,
  kauflandFuer,
  TAUSCH_ERGEBNIS,
  NUMBER_STATUS,
} from "./store/defaults.js";

export const withStoreLock = macheSpeicherSperre();
