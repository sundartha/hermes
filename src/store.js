import { config } from "./config.ts";
import * as jsonBackend from "./store/json.js";
import { anrufpauseSetzen as anrufpauseSetzenImJson } from "./store/state-ops.js";
import { macheSpeicherSperre } from "./store/sperre.js";
import { zustandsFunktionen } from "./store/zustand/anbindung.js";
import { sperreAusZustand } from "./store/mandant-sql.js";
import { rueckfrageAusZustand } from "./store/rueckfrage-sql.js";
import { leitungsplaetze as speicherLeitungsplaetze } from "./store/leitungsplaetze.js";
import { konsultPlaetze as speicherKonsultPlaetze } from "./utils/konsult-plaetze.js";
import { KEINE_DB_RESERVIERUNG } from "./store/budget-reserve.js";
import { starteLauf } from "./store/kennzahlen.js";
import { EIGENE_KENNUNG, besitzLage as besitzLageVon, makeInstanzTakt, uebernimmAnruf as uebernimmAnrufVon } from "./store/instanz-besitz.js";
import {
  faelligeAusSpiegel,
  macheFristenSql,
  setzeGeldImSpiegel,
  setzeHoechstdauerImSpiegel,
  setzeAbfrageImSpiegel,
  setzeUebergabeImSpiegel,
  setzeReserveImSpiegel,
} from "./store/fristen-sql.js";
import { macheNachlaufAnspruch } from "./store/nachlauf-anspruch.js";
import { makeAnrufstartMarker, makePostgresAnrufstartMarker } from "./store/anrufstart-marker.js";
import { makePostgresLeitungsplaetze } from "./store/leitungsplaetze-pg.js";
import { makePostgresVorspannZustand, makeSpeicherVorspannZustand } from "./store/vorspann-zustand.js";

async function createPgBackend() {
  const { createPgPoolRunner } = await import("./store/pg-runner.js");
  const {
    makePgStore,
    einstellungenNachladenVon,
    nutzungAuffrischenVon,
    anrufpauseGelesenVon,
    anrufpauseSetzen,
    mandantSperreGelesenVon,
    macheRueckfrageSql,
  } = await import("./store/pg.js");
  const { leiteSchluesselAb, makeWebhookZustellung, planeLoeschtakt } = await import(
    "./store/webhook-zustellung.js"
  );
  const startSperre = await import("./store/start-sperre.js");
  const anrufSperre = await import("./store/anruf-sperre-pg.js");
  const { rolleVorhanden: rolleImKatalog } = await import("./db/migrate.js");
  const { makeStripeEreignisRegister } = await import("./store/stripe-ereignis-register.js");
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
  const mitAnrufSperre = (tenantId, arbeit) => anrufSperre.mitAnrufSperre(runner, tenantId, arbeit);
  const nummernVorhanden = () => startSperre.nummernVorhanden(runner);
  const besitzLage = () => besitzLageVon(runner);
  const uebernimmAnruf = (anfrage) => uebernimmAnrufVon(runner, anfrage);
  const starteInstanzTakt = async (optionen) => {
    const takt = makeInstanzTakt(runner, optionen);
    await takt.starten();
    return { stoppen: takt.stoppen, abmelden: takt.abmelden };
  };
  const rolleVorhanden = (rolle) => runner.withClient((client) => rolleImKatalog(client, rolle));
  const zustandNachladen = () => store.init();
  const einstellungenNachladen = (tenantId) => einstellungenNachladenVon(store.load(), tenantId);
  const nutzungAuffrischen = (tenantId) => nutzungAuffrischenVon(store.load(), tenantId);
  return {
    ...store,
    poolZustand,
    pruefeVerbindung,
    webhookZustellung,
    beanspruecheInboundElNachlauf: macheNachlaufAnspruch({ runner, store }),
    stripeEreignisRegister: makeStripeEreignisRegister(runner),
    leitungsplaetze: makePostgresLeitungsplaetze(runner),
    anrufstartMarker: makePostgresAnrufstartMarker(runner),
    ttsAblage: makePostgresTtsAblage(runner, { ttlMs: config.voice.elevenLabsPlayTts.tokenTtlMs }),
    konsultPlaetze: makePostgresKonsultPlaetze(runner),
    vorspannZustand: makePostgresVorspannZustand(runner),
    faelligeFristen: makePostgresFristen(runner).faellige,
    setzeHoechstdauerFrist: async (anfrage) => {
      await store.drainFlushes();
      return makePostgresFristen(runner).setzeHoechstdauer(anfrage);
    },
    setzeGeldFrist: async (anfrage) => {
      await store.drainFlushes();
      return makePostgresFristen(runner).setzeGeld(anfrage);
    },
    setzeReserveFrist: async (anfrage) => {
      await store.drainFlushes();
      return makePostgresFristen(runner).setzeReserve(anfrage);
    },
    setzeAbfrageFrist: async (anfrage) => {
      await store.drainFlushes();
      return makePostgresFristen(runner).setzeAbfrage(anfrage);
    },
    setzeUebergabeFrist: async (anfrage) => {
      await store.drainFlushes();
      return makePostgresFristen(runner).setzeUebergabe(anfrage);
    },
    budgetReservierung: await makePostgresBudgetReserve(runner),
    starteZustellungsLoeschtakt,
    mitStartSperre,
    mitAnrufSperre,
    nummernVorhanden,
    besitzLage,
    uebernimmAnruf,
    starteInstanzTakt,
    rolleVorhanden,
    zustandNachladen,
    einstellungenNachladen,
    nutzungAuffrischen,
    anrufpauseGelesen: () => anrufpauseGelesenVon(store.load()),
    mandantSperreGelesen: (tenantId) => mandantSperreGelesenVon(store.load(), tenantId),
    rueckfrageGelesen: macheRueckfrageSql({ runner }).lesen,
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
  belegenWartend: (anfrage) => aktiveLeitungsplaetze().belegenWartend(anfrage),
  belegenEingehend: (anfrage) => aktiveLeitungsplaetze().belegenEingehend(anfrage),
  freigeben: (callId) => aktiveLeitungsplaetze().freigeben(callId),
  belegung: () => aktiveLeitungsplaetze().belegung(),
  belegteAnrufe: (callIds) => aktiveLeitungsplaetze().belegteAnrufe(callIds),
};

const speicherAnrufstartMarker = makeAnrufstartMarker();

const aktiverAnrufstartMarker = () => offenesBackend?.anrufstartMarker ?? speicherAnrufstartMarker;

export const anrufstartMarker = {
  setze: (anfrage) => aktiverAnrufstartMarker().setze(anfrage),
  lies: (callId) => aktiverAnrufstartMarker().lies(callId),
};

export { makeAnrufstartMarker, makePostgresAnrufstartMarker, makePostgresLeitungsplaetze };

export const ttsAblage = {
  ablegen: (token, audio, optionen) => offenesBackend.ttsAblage.ablegen(token, audio, optionen),
  holen: (token) => offenesBackend.ttsAblage.holen(token),
  lesen: (token) => offenesBackend.ttsAblage.lesen(token),
  freigeben: (token) => offenesBackend.ttsAblage.freigeben(token),
};

const speicherVorspannZustand = makeSpeicherVorspannZustand();

const aktiverVorspannZustand = () => offenesBackend?.vorspannZustand ?? speicherVorspannZustand;

export const vorspannZustand = {
  anlegen: (anfrage) => aktiverVorspannZustand().anlegen(anfrage),
  leseText: (anfrage) => aktiverVorspannZustand().leseText(anfrage),
  loesche: (anfrage) => aktiverVorspannZustand().loesche(anfrage),
  lade: (anfrage) => aktiverVorspannZustand().lade(anfrage),
  setzeCallee: (anfrage) => aktiverVorspannZustand().setzeCallee(anfrage),
  beanspruecheAbgehoben: (anfrage) => aktiverVorspannZustand().beanspruecheAbgehoben(anfrage),
  beanspruecheMarke: (anfrage) => aktiverVorspannZustand().beanspruecheMarke(anfrage),
  entnimm: (anfrage) => aktiverVorspannZustand().entnimm(anfrage),
  speichere: (anfrage) => aktiverVorspannZustand().speichere(anfrage),
};

const aktiveKonsultPlaetze = () => offenesBackend?.konsultPlaetze ?? speicherKonsultPlaetze;

export const konsultPlaetze = {
  belegen: (anfrage) => aktiveKonsultPlaetze().belegen(anfrage),
  freigeben: (platzId) => aktiveKonsultPlaetze().freigeben(platzId),
  offenJeAnruf: (callId) => aktiveKonsultPlaetze().offenJeAnruf(callId),
};

export async function makePostgresBudgetReserve(runner) {
  const { makePostgresBudgetReserve: bauen } = await import("./store/budget-reserve-pg.js");
  return bauen(runner);
}

const aktiveBudgetReservierung = () => offenesBackend?.budgetReservierung ?? KEINE_DB_RESERVIERUNG;

export const budgetReservierung = {
  reservieren: (anfrage) => aktiveBudgetReservierung().reservieren(anfrage),
  freigeben: (anfrage) => aktiveBudgetReservierung().freigeben(anfrage),
};

export const makePostgresFristen = (runner) => macheFristenSql({ runner, einreihen: (arbeit) => runner.withClient(arbeit), besitzLage: () => besitzLageVon(runner) });

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
    faelligeFristen: async (anfrage) => faelligeAusSpiegel(jsonBackend.load(), { jetztMs: Date.now(), ...anfrage }),
    setzeHoechstdauerFrist: async (anfrage) => {
      setzeHoechstdauerImSpiegel(jsonBackend.load(), anfrage);
      jsonBackend.save();
    },
    setzeGeldFrist: async (anfrage) => {
      setzeGeldImSpiegel(jsonBackend.load(), anfrage);
      jsonBackend.save();
    },
    setzeReserveFrist: async (anfrage) => {
      setzeReserveImSpiegel(jsonBackend.load(), anfrage);
      jsonBackend.save();
    },
    setzeAbfrageFrist: async (anfrage) => {
      setzeAbfrageImSpiegel(jsonBackend.load(), anfrage);
      jsonBackend.save();
    },
    setzeUebergabeFrist: async (anfrage) => {
      setzeUebergabeImSpiegel(jsonBackend.load(), anfrage);
      jsonBackend.save();
    },
    starteZustellungsLoeschtakt: async () => {},
    mitStartSperre: async (_routine, arbeit) => ({ uebersprungen: false, ergebnis: await arbeit() }),
    mitAnrufSperre: (_tenantId, arbeit) => arbeit(),
    nummernVorhanden: async () => jsonBackend.load().numbers.length > 0,
    besitzLage: async () => ({ eigene: EIGENE_KENNUNG, lebende: [EIGENE_KENNUNG] }),
    uebernimmAnruf: async ({ callId, alt }) => {
      const call = jsonBackend.getCall(callId);
      if (call?.status !== "active" || (call.instanz ?? null) !== (alt ?? null)) return false;
      call.instanz = EIGENE_KENNUNG;
      jsonBackend.save();
      return true;
    },
    starteInstanzTakt: async () => ({ stoppen: async () => {}, abmelden: async () => {} }),
    rolleVorhanden: async () => false,
    zustandNachladen: async () => {},
    einstellungenNachladen: async () => true,
    nutzungAuffrischen: async () => true,
    anrufpauseGelesen: async () => jsonBackend.load().anrufpause === true,
    mandantSperreGelesen: async (tenantId) => sperreAusZustand(jsonBackend.load(), tenantId),
    rueckfrageGelesen: async (callId, _tenantId, afterEventId) =>
      rueckfrageAusZustand(jsonBackend.load(), callId, afterEventId),
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
  faelligeFristen,
  setzeHoechstdauerFrist,
  setzeGeldFrist,
  setzeReserveFrist,
  setzeAbfrageFrist,
  setzeUebergabeFrist,
  mitStartSperre,
  mitAnrufSperre,
  nummernVorhanden,
  besitzLage,
  uebernimmAnruf,
  starteInstanzTakt,
  rolleVorhanden,
  zustandNachladen,
  einstellungenNachladen,
  nutzungAuffrischen,
  anrufpauseGelesen,
  mandantSperreGelesen,
  stammdatenSchreiben,
  rueckfrageGelesen,
  ausfallSql,
  nummernSql,
  nummerNachladen,
  load,
  save,
  drainFlushes,
  newId,
  createCall,
  persistCall,
  getCall,
  anrufHierBewacht,
  leseCall,
  leseCallUngebunden,
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
  recordElDetectorCounts,
  recordBridgedAt,
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
  counterpartyMemoryGelesen,
  findTenantByNumber,
  numberRecordByE164,
  resolveCallLanguage,
  tenantLanguage,
  addActionItem,
  callActionItems,
  callActionItemsGespiegelt,
  toggleActionItem,
  getCalendar,
  addCalendarEvent,
  findConflict,
  trackUsage,
  budgetExceeded,
  reserveExceedsBudget,
  liveBudgetExceeded,
  activeCallsFor,
  activeCallsForSql,
  aktiveAnrufeAlle,
  anderesAnrufMitKonversation,
  anrufeDesMandanten,
  numberHasActiveCall,
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
  exportTenantDataGelesen,
  zaehleAnrufeSeit,
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
  tenantPrivateNumberLesen,
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

export { classifyCallTime, SUBSCRIPTION_PATCH_FIELDS } from "./store/state-ops.js";
export { KEINE_DB_RESERVIERUNG, RESERVIERUNG_GRUND } from "./store/budget-reserve.js";
export { ANBIETER, AUSGEHEND_JE_KUNDE, LEITUNGSPLATZ_ENTSCHEIDUNG, WARTENDE_GESAMT, WARTENDE_JE_KUNDE, makeLeitungsplaetze } from "./store/leitungsplaetze.js";
export { makeKonsultPlaetze } from "./utils/konsult-plaetze.js";
export { arbeitGehoertLebenderFremder } from "./store/zustand/besitz.js";
export { zustandsFunktionen };
export { ersatzNummerEintragen, ersatzSpurEntfernen } from "./store/ersatz-spur.js";
export { speicherBereiche } from "./store/bereiche.js";
export { MAX_CALL_DURATION_CAP_S } from "./begriffe/anrufe.js";
export { assertKaufbareRufnummer, assertKaufbaresLand, kauflandFuer } from "./begriffe/rufnummern.js";
export { TAUSCH_ERGEBNIS } from "./begriffe/nummern-vergabe.js";
export { NUMBER_STATUS } from "./begriffe/nummern.js";
export { DEFAULT_GREETING, calendarMap, defaultSettings, defaultSettingsMap, demoCalendar, emptyPlatformTtsUsage, emptyUsage, emptyUsageMap } from "./store/leerzustaende.js";

export const withStoreLock = macheSpeicherSperre();
