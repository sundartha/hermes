import { KOSTENPROFIL } from "../billing/kostenarten.ts";
import { keepsTranscriptForCustomer, keepsTranscriptForDiagnosis } from "../diagnostic-retention.ts";
import { localeFor } from "../i18n/locales.ts";
import { reportSystematicOutage } from "./outage-report.js";
import { AT_CAPACITY, FAILURE_REASON_BASE_TOKENS, RESULT_UNKNOWN, failureReasonBase } from "./failure-reason.ts";
import { BRIDGE_STATE, bridgeStateOf, istOutboundElProfil, uebergabeGescheitert } from "../elevenlabs/inbound-bridge-state.ts";
import { elevenlabsOutbound } from "../elevenlabs/registry.ts";
import { messeAnrufEnde } from "../utils/betriebsmessung.js";
import { MS_PER_SECOND } from "../utils/timer.ts";
import { anrufZustandVon } from "../begriffe/anruf-zustand.ts";

const finishedCalls = new WeakSet();

const ANBIETER_ENDE_GRUENDE = new Set(["failed", "busy", "no-answer"]);

const TELNYX_LEITUNG_PROFILE = new Set([
  KOSTENPROFIL.TELNYX_BUDGET,
  KOSTENPROFIL.TELNYX_INBOUND_BUDGET,
  KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
]);

const anbieterMeldetEnde = (call) =>
  TELNYX_LEITUNG_PROFILE.has(call.costProfile) &&
  (call.status === "completed" || ANBIETER_ENDE_GRUENDE.has(failureReasonBase(call.failureReason)));

const nieEineLeitung = (call) =>
  call.status !== "cancelled" &&
  !call.twilioSid &&
  !call.callControlId &&
  !call.elevenlabsConversationId &&
  failureReasonBase(call.failureReason) !== RESULT_UNKNOWN;

const endeSteht = (call) => anbieterMeldetEnde(call) || nieEineLeitung(call);

function capacityDetail(reason) {
  if (failureReasonBase(reason) !== AT_CAPACITY) return null;
  return String(reason).slice(AT_CAPACITY.length + 1);
}

function messgrund(call) {
  const basis = failureReasonBase(call.failureReason);
  if (call.status === "completed") {
    if (call.answeredUnclearReason === elevenlabsOutbound().ANSWERED_REASON_NOT_ANSWERED) return NO_ANSWER;
    return FAILURE_REASON_BASE_TOKENS.includes(basis) ? basis : GRUND_KEINER;
  }
  return FAILURE_REASON_BASE_TOKENS.includes(basis) ? basis : GRUND_SONSTIG;
}

function messeEnde(call) {
  const grund = messgrund(call);
  messeAnrufEnde({
    richtung: call.direction,
    ergebnis: grund === GRUND_KEINER ? "completed" : "failed",
    grund,
    dauerS: abstandS(call.answeredAt, call.endedAt),
    annahmeS: abstandS(call.startedAt, call.answeredAt),
  });
}

function lehneUnbekanntenZustandAb(call) {
  if (anrufZustandVon(call.status) !== null) return false;
  console.error(`[call-finish] Anruf ${call.id}: unbekannter Zustand, kein Ende gemeldet`);
  return true;
}

function abstandS(vonIso, bisIso) {
  const abstandMs = Date.parse(bisIso) - Date.parse(vonIso);
  return Number.isFinite(abstandMs) && abstandMs >= 0 ? abstandMs / MS_PER_SECOND : null;
}

const EL_UEBERGABE_LOG_PREFIX = "[el-uebergabe]";
const GRUND_KEINER = "keiner";
const NO_ANSWER = "no-answer";
const GRUND_SONSTIG = "sonstig";
const GESCHEITERT_ZUSTAND_FUER_LOG = Object.freeze({
  [BRIDGE_STATE.WARTET]: "wartet",
  [BRIDGE_STATE.RUECKFALL]: "rueckfall",
  [BRIDGE_STATE.KEIN_EL_INBOUND]: "abgewiesen",
});
function logGescheiterteUebergabe(call) {
  const zustand = GESCHEITERT_ZUSTAND_FUER_LOG[bridgeStateOf(call)];
  console.log(`${EL_UEBERGABE_LOG_PREFIX} gescheitert call=${call.id} grund=${call.failureReason || GRUND_KEINER} zustand=${zustand}`);
}

async function storedActionItemTexts(store, callId) {
  return (await store.callActionItems(callId)).map((item) => item.text);
}

async function reportFailedCall({ store, config, call, mailer, audit, messaging, metrics }) {
  const detail = capacityDetail(call.failureReason);
  if (detail) metrics.logCallCapacity({ detail });
  await reportSystematicOutage({ store, config, call, audit, messaging, mailer });
}

function keepsForCustomer({ store, config, call, summaryCreated }) {
  return keepsTranscriptForCustomer({
    call,
    settings: store.tenantContext(call.tenantId).settings,
    privacy: config.privacy,
    summaryCreated,
  });
}

async function summaryOf({ store, config, summarizeCall, call }) {
  try {
    return call.summary
      ? { summary: call.summary, actionItems: await storedActionItemTexts(store, call.id) }
      : await summarizeCall(call);
  } catch (err) {
    if (!keepsTranscriptForDiagnosis(call, config.privacy)) {
      await store.purgeTranscript(call.id);
    }
    throw err;
  }
}

async function notifySafely(store, eintrag) {
  try {
    await store.addNotification(eintrag.title, eintrag.body, eintrag.callId);
  } catch (err) {
    console.error("[notification]", err.message);
  }
}

async function reportUnfinishedCall({ store, config, call, mailer, audit, messaging, texts, metrics }) {
  if (call.transcript.length && !keepsTranscriptForDiagnosis(call, config.privacy)) {
    await store.purgeTranscript(call.id);
  }
  const target = call.direction === "outbound" ? call.to : call.from;
  await notifySafely(store, {
    title: call.status === "cancelled" ? texts.cancelledTitle : texts.failedTitle,
    body: texts.statusBody(target, call.status, call.failureReason),
    callId: call.id,
  });
  await reportFailedCall({ store, config, call, mailer, audit, messaging, metrics });
}

export function makeCallFinish({
  store,
  config,
  metering,
  messaging,
  summarizeCall,
  audit,
  mailer = null,
  qualifiesAsInboxEntry = () => false,
  metrics,
  leitungsplaetze,
  budgetReservierung,
}) {
  function releaseReserve(call, { wirfBeiFehler = false } = {}) {
    const freigabe = store
      .withStoreLock(() => store.releaseOutboundReserve(call))
      .then(() => budgetReservierung?.freigeben({ callId: call.id, tenantId: call.tenantId }));
    if (wirfBeiFehler) return freigabe;
    return freigabe.catch((e) => console.error("[reserve] release:", e.message));
  }

  async function settleBilling(call) {
    if (call.billedAt) return;
    if (config.billing.paymentEnabled) metering.recordVoiceMinuteMeter(call);
    await metering.reconcileVoiceBudget(call);
    await store.markBilled(call.id);
  }

  async function deliverSummary(call, texts) {
    const result = await summaryOf({ store, config, summarizeCall, call });
    const kept =
      keepsTranscriptForDiagnosis(call, config.privacy) || keepsForCustomer({ store, config, call, summaryCreated: Boolean(result) });
    if (!kept) await store.purgeTranscript(call.id);
    if (!result) return;
    const who = call.direction === "outbound" ? texts.subjectOutbound(call.to) : texts.subjectInbound(call.from);
    await notifySafely(store, { title: texts.summaryTitle, body: `${who}: ${result.summary}`, callId: call.id });
  }

  async function finishCompletedCall(call, texts) {
    const inboxWorthy = qualifiesAsInboxEntry(call, store.tenantContext(call.tenantId).settings);
    try {
      await deliverSummary(call, texts);
    } catch (err) {
      console.error("[summary]", err.message);
    } finally {
      await store.markInboxEntry(call.id, inboxWorthy);
    }
  }

  async function finishCall(call) {
    if (!call || finishedCalls.has(call)) return;
    finishedCalls.add(call);
    if (lehneUnbekanntenZustandAb(call)) return;
    messeEnde(call);
    if (endeSteht(call)) leitungsplaetze?.freigeben(call.id);
    const texts = localeFor(call.language).postCall;
    await settleBilling(call).catch((err) => console.error("[billing] settle:", err.message));
    await store.save();
    await releaseReserve(call);
    store.save();

    if (uebergabeGescheitert(call)) {
      logGescheiterteUebergabe(call);
      if (!istOutboundElProfil(call)) {
        await reportSystematicOutage({ store, config, call, audit, messaging, mailer });
        return;
      }
    }

    if (call.status !== "completed" || !call.transcript.length) {
      await reportUnfinishedCall({ store, config, call, mailer, audit, messaging, texts, metrics });
      return;
    }

    await finishCompletedCall(call, texts);
  }

  return { finishCall, releaseReserve };
}
