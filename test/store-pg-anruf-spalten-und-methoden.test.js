import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";

const ANRUF_FELDER_OHNE_SPALTE = ["transcript", "actionItemIds"];

const EINDEUTIGE_ANRUFWERTE = {
  tenantId: BOOTSTRAP_TENANT_ID, twilioSid: "sid-eindeutig-01", provider: "provider-eindeutig-02",
  direction: "inbound", from: "+4915100000003", to: "+4915100000004", goal: "ziel-eindeutig-05",
  openingLine: "eroeffnung-eindeutig-06", openingLineSha256: "sha-eindeutig-07",
  briefing: "briefing-eindeutig-08", constraints: "grenzen-eindeutig-09",
  context: { schluessel: "kontext-eindeutig-10" }, mandate: { schluessel: "mandat-eindeutig-11" },
  callerName: "anrufer-eindeutig-12", language: "fr", maxDurationS: 1301,
  requestedBy: "auftraggeber-eindeutig-14", status: "failed", startedAt: "2026-03-01T08:15:16.000Z",
  answeredAt: "2026-03-01T08:15:27.000Z", answeredUnclearReason: "unklar-eindeutig-17",
  appointmentDate: "2026-04-18", appointmentTime: "16:45", amount: "betrag-eindeutig-20",
  currency: "waehrung-eindeutig-21", calleeConfirmedTimezone: "Europe/Lisbon",
  calleeConfirmedTimezoneOrigin: "herkunft-eindeutig-23",
  calleeConfirmedTimezoneAt: "2026-03-01T08:15:38.000Z", endedAt: "2026-03-01T08:19:49.000Z",
  summary: "zusammenfassung-eindeutig-26", objectiveAchieved: "unclear",
  summarySmsSentAt: "2026-03-01T08:20:01.000Z", summaryMailSentAt: "2026-03-01T08:20:02.000Z",
  failureReason: "grund-eindeutig-30", billedAt: "2026-03-01T08:20:03.000Z",
  callControlId: "steuerung-eindeutig-32", assistantId: "assistent-eindeutig-33", diagnostic: true,
  calleeIsOwner: true, callerIsOwner: false, inboxEntryAt: "2026-03-01T08:20:04.000Z",
  inboxSeenAt: "2026-03-01T08:20:05.000Z", estimatedCostCents: 3701, estimatedCostSpendMonthKey: "2026-03",
  estimatedCostPeriodKey: "periode-eindeutig-40", actualCostMicroCents: 4102,
  costTruedAt: "2026-03-01T08:20:06.000Z", costTruedSource: "quelle-eindeutig-43", costTruingAttempts: 4403,
  telnyxConversationId: "telnyx-eindeutig-45", elevenlabsConversationId: "elevenlabs-eindeutig-46",
  sipCallId: "sip-eindeutig-47", costProfile: "profil-eindeutig-48", callerTurns: 4904,
  result: { schluessel: "ergebnis-eindeutig-50" }, consults: [{ schluessel: "rueckfrage-eindeutig-51" }],
  lookupLog: [{ schluessel: "recherche-eindeutig-52" }],
  webhookAnchors: [{ schluessel: "anker-eindeutig-53" }], fromActualE164: "+4915100000054",
  fromSource: "absender-quelle-eindeutig-55", fromRegistrationSource: "absender-anmeldung-eindeutig-56",
  elDetectorCounts: { schluessel: 57 }, elBoundAt: "2026-03-01T08:20:07.000Z",
  elFallbackAt: "2026-03-01T08:20:08.000Z", elNachlaufStartedAt: "2026-03-01T08:20:09.000Z",
  notPlacedMailSentAt: "2026-03-01T08:20:10.000Z", elCallControlId: "el-steuerung-eindeutig-58",
};

async function speichernUndNeuLaden() {
  const { store } = await makePgTestStore();
  const angelegt = store.createCall({ direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID });
  const imSpeicher = Object.assign(store.getCall(angelegt.id), EINDEUTIGE_ANRUFWERTE);
  await store.save();
  await store.drainFlushes();
  await store.init();
  const geladen = store.getCall(angelegt.id);
  assert.notEqual(geladen, imSpeicher, "init baut ein neues Objekt aus den Zeilen auf");
  return geladen;
}

test("Anruf-Spalten: jedes von callRowValues geschriebene Feld kommt nach Speichern und Neuladen mit genau seinem Wert zurueck", async () => {
  const geladen = await speichernUndNeuLaden();

  for (const [feld, erwartet] of Object.entries(EINDEUTIGE_ANRUFWERTE)) {
    assert.deepStrictEqual(geladen[feld], erwartet, `Feld ${feld}`);
  }
});

test("Anruf-Spalten: die Pruefwerte sind ausser den Wahrheitswerten paarweise verschieden", () => {
  const werte = Object.values(EINDEUTIGE_ANRUFWERTE)
    .filter((wert) => typeof wert !== "boolean")
    .map((wert) => JSON.stringify(wert));

  assert.equal(new Set(werte).size, werte.length);
});

test("Anruf-Spalten: nach dem Neuladen gibt es keine Felder ausser den geprueften und denen, die bewusst aus eigenen Tabellen kommen", async () => {
  const geladen = await speichernUndNeuLaden();

  assert.deepStrictEqual(
    Object.keys(geladen).sort(),
    [...Object.keys(EINDEUTIGE_ANRUFWERTE), "id", "streamToken", ...ANRUF_FELDER_OHNE_SPALTE].sort(),
  );
});

const ERWARTETE_SPEICHER_METHODEN = [
  "ackConsult", "activeCallsFor", "addActionItem", "addCalendarEvent", "addLookupFacts",
  "addNewsletterRecipient", "addNotification", "addResearchFeeCostCents", "addTranscript",
  "addVoiceUsageCostCents", "advanceInCallConsult", "anrufpauseAktiv", "answerConsult",
  "applyCostCorrectionCents", "attachActiveCall", "billingHoldActive", "bindInboundElConversation",
  "bindSubToTenant", "bootstrapTenant", "budgetExceeded", "callActionItems", "callCostEvidence",
  "cancellationMailPending", "claimPlatformSpendWarning", "clearBillingHold", "clearNoSpeechStreak",
  "clearNumberElInboundTrunkBeleg", "clearSuspendedAt", "confirmNewsletterRecipientByToken",
  "confirmedNewsletterRecipients", "contractEndCleanupPending", "countCallLookup", "countCallerTurn",
  "countNoSpeechTurn", "countOutboundCallsSince", "counterpartyMemory", "createCall",
  "dailyNewsletterConfirmMailCount", "dailySmsCount", "deleteProfile", "drainFlushes", "emitConsult",
  "endCallRecord", "ensureTenant", "eraseTenantData", "ersatzNummerAnfordern", "expireOpenConsults", "exportTenantData", "findConflict",
  "findTenantByCustomer", "findTenantByNumber", "findTenantBySubscription", "finishCallLookup", "getCalendar",
  "getCall", "init", "kycReached", "listProfiles", "liveBudgetExceeded", "load", "markAnswered", "markBilled",
  "markConsultAnswerDelivered", "markConsultAskDelivered", "markCostCrossCheckAttempted",
  "markInboundElFallback", "markInboundElNachlaufStarted", "markInboxEntry", "markMeterEventsSent",
  "markNotPlacedMailSent",
  "markNumberElInboundTrunkBelegt", "markSummaryMailSent", "markSummarySmsSent", "newId", "noteConsultPoll",
  "numberRecordByE164", "nummerntauschKandidaten", "oeffneKostenAbgleichErneut", "pendingConsult", "pendingMeterEvents",
  "planMinutesExceeded", "platformTtsUsageView", "pruneOldData", "purgeTranscript", "recordActualSender",
  "recordAnsweredUnclearReason", "recordCallCostEvidence", "recordCallCostTruingResult",
  "recordCallEstimatedCostCents", "recordCallLookup", "recordCalleeConfirmedTimezone", "recordCostProfile",
  "recordElDetectorCounts", "recordElevenlabsConversationId", "recordFailureReason",
  "recordFromRegistrationSource", "recordProviderCallResult", "recordProviderCollectedFields",
  "recordRelayTtsCharacters", "recordSipCallId", "recordTenantTtsCharacters", "recordTtsCharacters",
  "recordUsageEvent", "recordWebhookAnchors", "registrierungAnhaengen", "releaseOutboundReserve",
  "releaseOutboundReserveCents", "removeNewsletterRecipient", "reservationOf", "reserveExceedsBudget",
  "resolveCallLanguage", "resolveProfile", "resolveTenant", "save", "schliesseKostenAbgleich",
  "seedBootstrapNumber", "setBillingHold", "setCallEndedAt", "setCancellationMailPending",
  "setContractEndCleanupPending", "setKycLevel", "setNewsletterConsent", "setPrivateNumber", "setProfile",
  "setSuspendedAtIfAbsent", "setTenantBudget", "setTenantGeo", "setTenantStripe", "setTenantSubscription",
  "setzeAnrufpause", "stampBudgetPeriod", "takeInboxEntries", "tenantActiveSubscriber", "tenantBudgetSnapshot",
  "tenantContext", "tenantExists", "tenantGeo", "tenantIdpSubject", "tenantInactive", "tenantLanguage",
  "tenantNewsletterConsent", "tenantNewsletterRecipients", "tenantPrivateNumber", "tenantStripe",
  "tenantSubscription", "tenantSuspendedAt", "tenantTimezone", "tenantsPendingCancellationMail",
  "tenantsPendingContractEndCleanup", "timeOutStagedConsult", "toggleActionItem", "trackUsage",
  "trueUpAnsweredAt", "tryReserveOutboundBudget", "unsubscribeNewsletterRecipientByToken", "updateSettings",
  "usageOf", "withStoreLock",
];

test("Speicher-Methodenliste: der Teststore liefert genau diese Schluessel, keinen doppelt", async () => {
  const { store } = await makePgTestStore();

  assert.deepStrictEqual(Object.keys(store).sort(), ERWARTETE_SPEICHER_METHODEN);
  assert.equal(new Set(ERWARTETE_SPEICHER_METHODEN).size, ERWARTETE_SPEICHER_METHODEN.length);
});
