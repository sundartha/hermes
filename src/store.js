import { config } from "./config.js";
import * as jsonBackend from "./store/json.js";
import { anrufpauseSetzen as anrufpauseSetzenImJson } from "./store/state-ops.js";
import { macheSpeicherSperre } from "./store/sperre.js";
import { zustandsFunktionen } from "./store/zustand/anbindung.js";
import { sperreAusZustand } from "./store/mandant-sql.js";
import { leitungsplaetze as speicherLeitungsplaetze } from "./store/leitungsplaetze.js";
import { konsultPlaetze as speicherKonsultPlaetze } from "./utils/konsult-plaetze.js";
import { starteLauf } from "./store/kennzahlen.js";
import { EIGENE_KENNUNG, besitzLage as besitzLageVon, makeInstanzTakt } from "./store/instanz-besitz.js";
import { macheNachlaufAnspruch } from "./store/nachlauf-anspruch.js";

async function createPgBackend() {
  const { createPgPoolRunner } = await import("./store/pg-runner.js");
  const { makePgStore, einstellungenNachladenVon, anrufpauseGelesenVon, anrufpauseSetzen, mandantSperreGelesenVon } =
    await import("./store/pg.js");
  const { leiteSchluesselAb, makeWebhookZustellung, planeLoeschtakt } = await import(
    "./store/webhook-zustellung.js"
  );
  const startSperre = await import("./store/start-sperre.js");
  const { rolleVorhanden: rolleImKatalog } = await import("./db/migrate.js");
  const { makeStripeEreignisRegister } = await import("./store/stripe-ereignis-register.js");
  const { makePostgresLeitungsplaetze } = await import("./store/leitungsplaetze-pg.js");
  const { makePostgresTtsAblage } = await import("./store/tts-ablage.js");
  const { makePostgresKonsultPlaetze } = await import("./store/konsult-plaetze-pg.js");
  const { runner, poolZustand } = await createPgPoolRunner(config.store.databaseUrl);
  const store = makePgStore(runner);
  await store.init();
  const pruefeVerbindung = () => runner.withClient((client) => client.query("SELECT 1"));
  const zustellungsSchluessel = leiteSchluesselAb(config.auth.webhookZustellungSecret);
  const webhookZustellung = zustellungsSchluessel
    ? makeWebhookZustellung({ runner, schluessel: zustellungsSchluessel })
    : null;
  const starteZustellungsLoeschtakt = (zeitplan) =>
    planeLoeschtakt({
      zeitplan,
      runner,
      taktMs: config.store.webhookZustellungLoeschtaktMs,
      mitAblage: Boolean(webhookZustellung),
    });
  const mitStartSperre = (routine, arbeit) => startSperre.mitStartSperre(runner, routine, arbeit);
  const nummernVorhanden = () => startSperre.nummernVorhanden(runner);
  const besitzLage = () => besitzLageVon(runner);
  const starteInstanzTakt = async () => {
    const takt = makeInstanzTakt(runner);
    await takt.starten();
    return { stoppen: takt.stoppen, abmelden: takt.abmelden };
  };
  const rolleVorhanden = (rolle) => runner.withClient((client) => rolleImKatalog(client, rolle));
  const zustandNachladen = () => store.init();
  const einstellungenNachladen = (tenantId) => einstellungenNachladenVon(store.load(), tenantId);
  return {
    ...store,
    poolZustand,
    pruefeVerbindung,
    webhookZustellung,
    beanspruecheInboundElNachlauf: macheNachlaufAnspruch({ runner, store }),
    stripeEreignisRegister: makeStripeEreignisRegister(runner),
    leitungsplaetze: makePostgresLeitungsplaetze(runner),
    ttsAblage: makePostgresTtsAblage(runner, { ttlMs: config.voice.elevenLabsPlayTts.tokenTtlMs }),
    konsultPlaetze: makePostgresKonsultPlaetze(runner),
    starteZustellungsLoeschtakt,
    mitStartSperre,
    nummernVorhanden,
    besitzLage,
    starteInstanzTakt,
    rolleVorhanden,
    zustandNachladen,
    einstellungenNachladen,
    anrufpauseGelesen: () => anrufpauseGelesenVon(store.load()),
    mandantSperreGelesen: (tenantId) => mandantSperreGelesenVon(store.load(), tenantId),
    anrufpauseSetzen: (an) => anrufpauseSetzen(store, an),
  };
}

function mitZustandsFunktionen(speicher) {
  return { ...speicher, ...zustandsFunktionen(speicher) };
}

let offenesBackend = null;
let oeffnung = null;

const aktiveLeitungsplaetze = () => offenesBackend?.leitungsplaetze ?? speicherLeitungsplaetze;

export const leitungsplaetze = {
  pruefenAusgehend: (anfrage) => aktiveLeitungsplaetze().pruefenAusgehend(anfrage),
  belegenAusgehend: (anfrage) => aktiveLeitungsplaetze().belegenAusgehend(anfrage),
  belegenEingehend: (anfrage) => aktiveLeitungsplaetze().belegenEingehend(anfrage),
  freigeben: (callId) => aktiveLeitungsplaetze().freigeben(callId),
  belegung: () => aktiveLeitungsplaetze().belegung(),
};

export const ttsAblage = {
  ablegen: (token, audio) => offenesBackend.ttsAblage.ablegen(token, audio),
  holen: (token) => offenesBackend.ttsAblage.holen(token),
};

const aktiveKonsultPlaetze = () => offenesBackend?.konsultPlaetze ?? speicherKonsultPlaetze;

export const konsultPlaetze = {
  belegen: (anfrage) => aktiveKonsultPlaetze().belegen(anfrage),
  freigeben: (platzId) => aktiveKonsultPlaetze().freigeben(platzId),
  offenJeAnruf: (callId) => aktiveKonsultPlaetze().offenJeAnruf(callId),
};

function setzeBackend(neu) {
  offenesBackend = neu;
  webhookZustellung = neu.webhookZustellung;
  stripeEreignisRegister = neu.stripeEreignisRegister;
}

function jsonBackendAufbauen() {
  return mitZustandsFunktionen({
    ...jsonBackend,
    poolZustand: () => null,
    pruefeVerbindung: async () => {},
    webhookZustellung: null,
    beanspruecheInboundElNachlauf: async (callId, nowIso) => jsonBackend.markInboundElNachlaufStarted(callId, nowIso),
    stripeEreignisRegister: null,
    ttsAblage: null,
    starteZustellungsLoeschtakt: async () => {},
    mitStartSperre: async (_routine, arbeit) => ({ uebersprungen: false, ergebnis: await arbeit() }),
    nummernVorhanden: async () => jsonBackend.load().numbers.length > 0,
    besitzLage: async () => ({ eigene: EIGENE_KENNUNG, lebende: [EIGENE_KENNUNG] }),
    starteInstanzTakt: async () => ({ stoppen: async () => {}, abmelden: async () => {} }),
    rolleVorhanden: async () => false,
    zustandNachladen: async () => {},
    einstellungenNachladen: async () => true,
    anrufpauseGelesen: async () => jsonBackend.load().anrufpause === true,
    mandantSperreGelesen: async (tenantId) => sperreAusZustand(jsonBackend.load(), tenantId),
    anrufpauseSetzen: (an) => anrufpauseSetzenImJson(jsonBackend, an),
  });
}

async function pgOeffnen() {
  let ursache = null;
  try {
    setzeBackend(mitZustandsFunktionen(await createPgBackend()));
  } catch (err) {
    ursache = err && err.message ? err.message : String(err);
  }
  if (ursache !== null) {
    console.error(
      "[store] FATAL: pg-Backend nicht initialisierbar (STORE_BACKEND=pg). " +
        "DB unerreichbar oder Init fehlgeschlagen. Ursache: " +
        ursache,
    );
    process.exit(1);
  }
}

export function oeffneSpeicher() {
  if (!oeffnung) {
    oeffnung = config.store.storeBackend === "pg" ? pgOeffnen() : Promise.resolve(setzeBackend(jsonBackendAufbauen()));
  }
  return oeffnung;
}

function geoeffnetesBackend() {
  if (offenesBackend) return offenesBackend;
  if (config.store.storeBackend === "pg") {
    throw new Error("[store] Speicher nicht geoeffnet: oeffneSpeicher() muss vor dem ersten Zugriff laufen (STORE_BACKEND=pg).");
  }
  oeffneSpeicher();
  return offenesBackend;
}

const backend = new Proxy(
  {},
  { get: (_ziel, name) => (...argumente) => geoeffnetesBackend()[name](...argumente) },
);

export let webhookZustellung = null;
export let stripeEreignisRegister = null;

export const {
  poolZustand,
  pruefeVerbindung,
  starteZustellungsLoeschtakt,
  beanspruecheInboundElNachlauf,
  mitStartSperre,
  nummernVorhanden,
  besitzLage,
  starteInstanzTakt,
  rolleVorhanden,
  zustandNachladen,
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

export function starteKennzahlenLauf() {
  return starteLauf(rolleVorhanden);
}

export { kennzahlenTakt, kennzahlenMomentaufnahme } from "./store/kennzahlen.js";

export function setzeAnrufpause(an) {
  return backend.anrufpauseSetzen(an);
}

export { classifyCallTime } from "./store/state-ops.js";
export { ANBIETER, AUSGEHEND_JE_KUNDE, LEITUNGSPLATZ_ENTSCHEIDUNG, makeLeitungsplaetze } from "./store/leitungsplaetze.js";
export { makeKonsultPlaetze } from "./utils/konsult-plaetze.js";
export { arbeitGehoertLebenderFremder } from "./store/zustand/besitz.js";
export { zustandsFunktionen };
export { speicherBereiche } from "./store/bereiche.js";
export { MAX_CALL_DURATION_CAP_S } from "./begriffe/anrufe.js";
export { assertKaufbareRufnummer, assertKaufbaresLand, kauflandFuer } from "./begriffe/rufnummern.js";
export { TAUSCH_ERGEBNIS } from "./begriffe/nummern-vergabe.js";
export { NUMBER_STATUS } from "./begriffe/nummern.js";
export { DEFAULT_GREETING, calendarMap, defaultSettings, defaultSettingsMap, demoCalendar, emptyPlatformTtsUsage, emptyUsage, emptyUsageMap } from "./store/leerzustaende.js";

export const withStoreLock = macheSpeicherSperre();
