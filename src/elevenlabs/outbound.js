import { LOCALES, localeFor } from "../i18n/locales.js";
import { cappedEndedAtMs, carrierEndMsOf, classifyCallTime, FROM_SOURCE } from "../store/state-ops.js";
import { MAX_CALL_DURATION_CAP_S } from "../store/defaults.js";
import { BRIDGE_STATE, bridgeStateOf } from "./inbound-bridge-state.js";
import { BEENDE_VERSUCH, ENDE_ANKER, FRIST_ANKER, nachlaufPolitikFuer, pollDarfWirken } from "./nachlauf-politik.js";
import { findActiveNumber } from "../store/views.js";
import { POLL_TIMEOUT_REASON, pollProviderErrorReason, providerErrorReason } from "../telephony/failure-reason.js";
import { verifiedOpeningLine } from "./opening-line.js";
import { tenantToolToken } from "./tenant-tool-token.js";
import { MS_PER_SECOND, sleep } from "../utils/timer.js";
import { callLocaleFor, providerVoicemailMessage } from "./call-locale.js";
import { endConversation, fetchConversation, startOutboundCall, startResultOf } from "./convai.js";
import { AUDIO_TAG, findeB1Treffer } from "./b1-doppelankaendigung.js";
import { spokenTimezoneName } from "./nanp-area-codes.js";
import { callTimeContext } from "./time-context.js";
import { persistEndWithReason } from "../telephony/call-termination.js";
import { anrufFuehrtTelnyxSip, recordElevenLabsKostenBelege } from "./kosten-beleg.js";
import { waehleAbsenderRegistrierung, ABSENDER_QUELLE } from "../telephony/absender-registrierung.js";
import crypto from "node:crypto";

const PROVIDER_DONE = "done";
const PROVIDER_FAILED = "failed";
const FINISHED_PROVIDER_STATUS = Object.freeze([PROVIDER_DONE, PROVIDER_FAILED]);

function anbieterErgebnisFertig(conversation) {
  return Boolean(conversation) && FINISHED_PROVIDER_STATUS.includes(conversation.status);
}

const CALL_COMPLETED = "completed";
const CALL_FAILED = "failed";

const PROVIDER_IN_PROGRESS = "in-progress";

const ANSWERED_UNCLEAR_REASON = "call_duration_secs_unusable";

const ANSWERED_REASON_NOT_ANSWERED = "call_duration_secs_zero_not_answered";
const ANSWERED_REASON_CONVERSATION_RUNNING = "call_duration_secs_unknown_conversation_in_progress";

const ANSWERED_REASON_PROVIDER_REJECTED = "provider_rejected_before_answer";

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const PERMANENT_FETCH_STATUS = Object.freeze([HTTP_UNAUTHORIZED, HTTP_NOT_FOUND]);

export const PERMANENT_ERROR_STREAK_LIMIT = 3;

const ANSWERED_UNCLEAR_REASON_PERMANENT_ERROR = "poll_permanent_provider_error";

export const ELEVENLABS_PROVIDER_MAX_DURATION_S = 600;

export const INBOUND_NACHLAUF_FRIST_MS = ELEVENLABS_PROVIDER_MAX_DURATION_S * MS_PER_SECOND;

const FOLGETAKT_GEPLANT = Symbol("folgetakt-geplant");

function callUnderProviderCap(call) {
  const eigeneFrist = call.maxDurationS || ELEVENLABS_PROVIDER_MAX_DURATION_S;
  return { ...call, maxDurationS: Math.min(eigeneFrist, ELEVENLABS_PROVIDER_MAX_DURATION_S) };
}

export const EL_ABORT_PROVIDER_TIMEOUT_MS = 10000;

export const EL_TERMINATION_RESULT_ATTEMPTS = 3;

const AGENT_ROLE = "agent";
const CALLER_ROLE = "caller";

const OBJECTIVE_ACHIEVED_BY_PROVIDER = Object.freeze({ success: true, failure: false });
const OBJECTIVE_ACHIEVED_UNKNOWN = "unclear";

const DATA_COLLECTION_ID = Object.freeze({
  APPOINTMENT_DATE: "appointment_date",
  APPOINTMENT_TIME: "appointment_time",
  AMOUNT: "amount",
  CURRENCY: "currency",
  CONFIRMED_TIMEZONE: "confirmed_timezone",
  NEXT_STEPS: "next_steps",
});

const ACTION_ITEM_TYPE = Object.freeze({ TODO: "todo", APPOINTMENT: "appointment" });

const CALLEE_TIMEZONE_ORIGIN_ELEVENLABS = "elevenlabs_data_collection";

function collectedValue(dataCollectionResults, id) {
  const value = dataCollectionResults?.[id]?.value;
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function collectedFieldsOf(conversation) {
  const results = conversation.analysis?.data_collection_results;
  return {
    appointmentDate: collectedValue(results, DATA_COLLECTION_ID.APPOINTMENT_DATE),
    appointmentTime: collectedValue(results, DATA_COLLECTION_ID.APPOINTMENT_TIME),
    amount: collectedValue(results, DATA_COLLECTION_ID.AMOUNT),
    currency: collectedValue(results, DATA_COLLECTION_ID.CURRENCY),
    confirmedTimezone: collectedValue(results, DATA_COLLECTION_ID.CONFIRMED_TIMEZONE),
  };
}

function persistCollectedFields({ store, callId, conversation, politik }) {
  const collected = collectedFieldsOf(conversation);
  store.recordProviderCollectedFields(callId, collected);
  if (collected.confirmedTimezone) {
    store.recordCalleeConfirmedTimezone(callId, {
      timezone: collected.confirmedTimezone,
      origin: CALLEE_TIMEZONE_ORIGIN_ELEVENLABS,
      confirmedAt: new Date().toISOString(),
    });
  }
  const nextStep = politik.naechsteSchritteAlsAufgabe ? nextStepActionItemOf(conversation, collected) : null;
  if (nextStep) store.addActionItem(callId, nextStep.text, nextStep.type);
}

function nextStepActionItemOf(conversation, collected) {
  const text = collectedValue(
    conversation.analysis?.data_collection_results,
    DATA_COLLECTION_ID.NEXT_STEPS,
  );
  if (!text) return null;
  const istTermin = Boolean(collected.appointmentDate || collected.appointmentTime);
  return { text, type: istTermin ? ACTION_ITEM_TYPE.APPOINTMENT : ACTION_ITEM_TYPE.TODO };
}

const EN_PROMPT = LOCALES.en.prompt;

const KEY_FACT_SEPARATOR = "; ";

const CONSTRAINTS_PRECEDENCE = EN_PROMPT.mandate.constraintsPrecedence.trim();

const BRIEFING_LABEL = `${EN_PROMPT.briefingLabel} `;

const LIST_DASH = /^-\s+/;

const alsText = (wert) => (typeof wert === "string" ? wert.trim() : "");

export function auftraggeberAusdruck(ownerName, locale) {
  return alsText(ownerName) || locale.disclosureOwnerFallback;
}

const roleOf = (role) => (role === AGENT_ROLE ? AGENT_ROLE : CALLER_ROLE);

const endStatusOf = (conversation) =>
  conversation.status === PROVIDER_DONE ? CALL_COMPLETED : CALL_FAILED;

const objectiveAchievedOf = (conversation) =>
  OBJECTIVE_ACHIEVED_BY_PROVIDER[conversation.analysis?.call_successful] ??
  OBJECTIVE_ACHIEVED_UNKNOWN;

const providerSummaryOf = (conversation, politik) =>
  politik.anbieterZusammenfassung ? conversation.analysis?.transcript_summary || null : null;

const anchorFromProviderDuration = (answeredAtIso) => ({
  answeredAtIso,
  unclearReason: null,
  keepExistingAnchor: false,
});
const clearAnchor = (unclearReason) => ({ answeredAtIso: null, unclearReason, keepExistingAnchor: false });
const keepAnchor = (unclearReason) => ({ answeredAtIso: null, unclearReason, keepExistingAnchor: true });

function usableProviderDuration(durationSecs, endedAtMs) {
  const durationUsable =
    typeof durationSecs === "number" && Number.isFinite(durationSecs) && durationSecs > 0;
  return durationUsable && Number.isFinite(endedAtMs);
}

export function answeredAnchorOutcome(endedAtIso, conversation) {
  const metadata = conversation?.metadata;
  const durationSecs = metadata?.call_duration_secs;
  const endedAtMs = Date.parse(endedAtIso);
  if (usableProviderDuration(durationSecs, endedAtMs))
    return anchorFromProviderDuration(new Date(endedAtMs - durationSecs * MS_PER_SECOND).toISOString());
  if (conversation?.status === PROVIDER_IN_PROGRESS) return keepAnchor(ANSWERED_REASON_CONVERSATION_RUNNING);
  if (metadata?.error) return clearAnchor(ANSWERED_REASON_PROVIDER_REJECTED);
  if (durationSecs === 0) return clearAnchor(ANSWERED_REASON_NOT_ANSWERED);
  return clearAnchor(ANSWERED_UNCLEAR_REASON);
}

const providerErrorReasonFor = (anchor, conversation) =>
  anchor.answeredAtIso || anchor.keepExistingAnchor ? null : providerErrorReason(conversation?.metadata?.error);

const spokenLines = (conversation) =>
  (conversation.transcript || []).filter((zeile) => zeile && zeile.message);

function reportAudioTags(callId, lines) {
  const marken = lines
    .filter((zeile) => roleOf(zeile.role) === AGENT_ROLE)
    .flatMap((zeile) => zeile.message.match(AUDIO_TAG) ?? []);
  if (marken.length === 0) return marken;
  console.error(
    `[el-tags] call=${callId} treffer=${marken.length} marken=${[...new Set(marken)].join(",")} - ` +
      "der Agent hat Klammerausdruecke GESPROCHEN. Quellen pruefen: tts.suggested_audio_tags " +
      "und turn.soft_timeout_config am Agenten.",
  );
  return marken;
}

function reportDoubleAnnouncements(callId, lines) {
  const treffer = findeB1Treffer(lines);
  if (treffer.length === 0) return treffer;
  const cues = treffer.map((einTreffer) => einTreffer.cues.join("+")).join(",");
  const zeilen = [...new Set(treffer.map((einTreffer) => einTreffer.zeile))].join(",");
  console.error(
    `[el-b1] call=${callId} treffer=${treffer.length} cues=${cues} zeilen=${zeilen} - ` +
      "der Agent hat denselben Inhalt doppelt angekuendigt (B1). Heuristik, NUR Diagnose.",
  );
  return treffer;
}

const bookingBoundary = (spielraumGegeben) =>
  (spielraumGegeben
    ? EN_PROMPT.boundaries.noBookingWithMandate
    : EN_PROMPT.boundaries.noBooking
  ).replace(LIST_DASH, "");

function mandateText(mandate) {
  const spielraum = alsText(mandate?.decide_freely);
  const rahmen = [spielraum, alsText(mandate?.fallback_order)].filter(Boolean).join(" ");
  const grenze = bookingBoundary(Boolean(spielraum));
  return rahmen ? `${rahmen}\n${grenze}` : grenze;
}

function constraintsText(constraints) {
  const verbote = alsText(constraints);
  if (!verbote) return "";
  return `\n${EN_PROMPT.constraintsLabel} ${verbote}\n${CONSTRAINTS_PRECEDENCE}`;
}

function backgroundText({ context, briefing }) {
  const label = EN_PROMPT.background;
  const lines = [
    contextLine(BRIEFING_LABEL, briefing),
    contextLine(label.summary, context?.summary),
    contextLine(label.relationship, context?.recipient_relationship),
    contextLine(label.outcome, context?.desired_outcome),
    contextLine(label.facts, keyFactsText(context?.key_facts)),
  ].filter(Boolean);
  if (!lines.length) return "";
  return `\n${label.heading}\n${lines.join("\n")}\n${label.guardrail}`;
}

export const PLACEHOLDER_OPENER = "{{";

function calleeRelationText({ call, owner, offenlegung }) {
  if (call.calleeIsOwner !== true) return "";
  const block = `\n${EN_PROMPT.calleeRelation({ owner, disclosure: offenlegung.disclosure(owner) })}`;
  return block.includes(PLACEHOLDER_OPENER) ? "" : block;
}

function voicemailText({ owner, offenlegung, openingLine }) {
  const text = providerVoicemailMessage({ locale: offenlegung, ownerName: owner, openingLine });
  return text.includes(PLACEHOLDER_OPENER) ? "" : text;
}

const calleeZoneFactSentence = (zone) =>
  `\nThe person you are calling is in the ${zone} time zone - convert every time you agree between those two zones and say which zone you mean.`;

const calleeZoneHypothesisSentence = (zone) =>
  `\nThe person you are calling is probably in the ${zone} time zone. That is an assumption derived from their area code, it is not confirmed, and it may be wrong. Before you name any specific time, confirm it in one short sentence, for example: "I have you down as ${spokenTimezoneName(zone)} - is that right?" Once they have confirmed it, convert every time you agree between those two zones and say which zone you mean.`;

const CALLEE_ZONE_UNKNOWN_SENTENCE = `\nYou do not know which time zone the person you are calling is in, and you must not guess one. Never name an absolute time while the zone is unknown - no specific time, no clock time. Stay vague instead ("tomorrow morning") and let them name the exact time; then repeat it back together with the time zone they used.`;

function calleeTimezoneText({ calleeZone, calleeZoneHypothesis }) {
  if (calleeZone) return calleeZoneFactSentence(calleeZone);
  if (calleeZoneHypothesis) return calleeZoneHypothesisSentence(calleeZoneHypothesis);
  return CALLEE_ZONE_UNKNOWN_SENTENCE;
}

function contextLine(label, wert) {
  const text = alsText(wert);
  return text ? `${label}${text}` : "";
}

function keyFactsText(keyFacts) {
  if (!Array.isArray(keyFacts)) return "";
  return keyFacts.map(alsText).filter(Boolean).join(KEY_FACT_SEPARATOR);
}

function assertConfigured(el) {
  const fehlend = [
    !el.apiKey && "ELEVENLABS_API_KEY",
    !el.agentId && "ELEVENLABS_AGENT_ID",
    !el.agentPhoneNumberId && "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
  ].filter(Boolean);
  if (fehlend.length)
    throw new Error(
      `ElevenLabs-Anrufstart ist eingeschaltet, aber unvollstaendig konfiguriert: ${fehlend.join(", ")}`,
    );
}

const FAKE_ID_BYTE_LENGTH = 8;
function fakeSipTrunkOutboundCallResponse() {
  const suffix = crypto.randomBytes(FAKE_ID_BYTE_LENGTH).toString("hex");
  return {
    success: true,
    message: "fake_originate: kein SIP-Anruf ausgeloest (Trockenlege-Naht)",
    conversation_id: `fake_el_${suffix}`,
    sip_call_id: `fake_sip_${suffix}`,
  };
}

const GATE_AVAILABLE = "available";
const GATE_UNAVAILABLE = "unavailable";

const ohneRueckfrageTor = () => false;
const ohneRechercheTor = () => false;

const ohneMetrikMeldung = Object.freeze({ logSenderFallback: () => {} });

export function dynamicVariables({
  call,
  owner,
  offenlegung,
  openingLine,
  time,
  consultAllowed,
  lookupAllowed,
  tenantToken,
}) {
  return {
    consult_available: consultAllowed === true ? GATE_AVAILABLE : GATE_UNAVAILABLE,
    lookup_available: lookupAllowed === true ? GATE_AVAILABLE : GATE_UNAVAILABLE,
    opening_line: openingLine,
    owner_name: owner,
    callee: alsText(call.to),
    objective: alsText(call.goal),
    constraints: constraintsText(call.constraints),
    background: backgroundText({ context: call.context, briefing: call.briefing }),
    mandate: mandateText(call.mandate),
    owner_timezone: alsText(time.ownerZone),
    callee_timezone: calleeTimezoneText(time),
    today: alsText(time.today),
    callee_relation: calleeRelationText({ call, owner, offenlegung }),
    voicemail_line: voicemailText({ owner, offenlegung, openingLine }),
    inbound_situation: "",
    tenant_token: tenantToken,
  };
}

export function callLocaleOf({ store, config, call, ownerName }) {
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    numberRecord: store.numberRecordByE164(call.from),
    ownerName,
    defaultVoiceId: config.telnyx.telnyxElevenLabs.voiceId,
    to: call.to,
    callLanguage: call.language,
  });
}

function absenderFuerAnruf({ store, call, el, metrics }) {
  const absender = waehleAbsenderRegistrierung({
    numberRecord: findActiveNumber(store.load(), call.tenantId),
    fromE164: call.from,
    rueckfallId: el.agentPhoneNumberId,
  });
  if (absender.quelle === ABSENDER_QUELLE.RUECKFALL_GLOBAL) {
    console.warn(`[el-outbound] Absender-Rueckfall (call=${call.id}): grund=${absender.grund}`);
    metrics.logSenderFallback({ grund: absender.grund });
  }
  store.recordFromRegistrationSource(call.id, absender.quelle);
  return absender;
}

function recordAbsenderMessung(store, callId, conversation) {
  store.recordActualSender(callId, {
    e164: conversation.metadata?.phone_call?.agent_number,
    source: FROM_SOURCE.PROVIDER_MEASURED,
  });
}

function persistProviderResult({ store, callId, conversation, belegNachreifbar, politik }) {
  const zeilen = spokenLines(conversation);
  const audioTagMarken = reportAudioTags(callId, zeilen);
  const b1Treffer = reportDoubleAnnouncements(callId, zeilen);
  store.recordElDetectorCounts(callId, { elTags: audioTagMarken.length, elB1: b1Treffer.length });
  for (const zeile of zeilen) store.addTranscript(callId, roleOf(zeile.role), zeile.message);
  store.recordProviderCallResult(callId, {
    summary: providerSummaryOf(conversation, politik),
    objectiveAchieved: objectiveAchievedOf(conversation),
  });
  persistCollectedFields({ store, callId, conversation, politik });
  const fuehrtTelnyxSip = anrufFuehrtTelnyxSip(store.getCall(callId));
  if (fuehrtTelnyxSip) store.recordSipCallId(callId, conversation.metadata?.phone_call?.call_id);
  recordAbsenderMessung(store, callId, conversation);
  recordElevenLabsKostenBelege({ store, callId, conversation, belegNachreifbar, erwarteTelnyxSip: fuehrtTelnyxSip });
}

function ownerFirstMessage({ call, offenlegung, firstName, openingLine }) {
  if (call.calleeIsOwner !== true) return "";
  const vorname = alsText(firstName);
  if (!vorname) return "";
  return sichereEroeffnung([offenlegung.ownerOpening(vorname), openingLine]);
}

function sichereEroeffnung(teile) {
  const text = teile.filter(Boolean).join(" ").trim();
  return !text || text.includes(PLACEHOLDER_OPENER) ? "" : text;
}

function perCallFirstMessage({ call, locale, offenlegung, firstName, owner, openingLine }) {
  const ownerEroeffnung = ownerFirstMessage({ call, offenlegung, firstName, openingLine });
  if (ownerEroeffnung) return ownerEroeffnung;
  if (locale.language === locale.disclosureLanguage) return "";
  return sichereEroeffnung([offenlegung.disclosure(owner), openingLine]);
}

function conversationConfigOverride({ call, locale, offenlegung, firstName, owner, openingLine }) {
  const eroeffnung = perCallFirstMessage({ call, locale, offenlegung, firstName, owner, openingLine });
  return {
    agent: {
      language: locale.language,
      ...(eroeffnung ? { first_message: eroeffnung } : {}),
    },
    ...(locale.voiceId ? { tts: { voice_id: locale.voiceId } } : {}),
  };
}

function startCallBody({
  el,
  call,
  ownerName,
  firstName,
  time,
  locale,
  consultAllowed,
  lookupAllowed,
  agentPhoneNumberId,
  tenantToken,
}) {
  const bundle = localeFor(locale.language);
  const offenlegung = localeFor(locale.disclosureLanguage);
  const openingLine = verifiedOpeningLine({ call, locale: bundle });
  const owner = auftraggeberAusdruck(ownerName, offenlegung);
  return {
    agent_id: el.agentId,
    agent_phone_number_id: agentPhoneNumberId,
    to_number: call.to,
    conversation_initiation_client_data: {
      dynamic_variables: dynamicVariables({
        call,
        owner,
        offenlegung,
        openingLine,
        time,
        consultAllowed,
        lookupAllowed,
        tenantToken,
      }),
      conversation_config_override: conversationConfigOverride({
        call,
        locale,
        offenlegung,
        firstName,
        owner,
        openingLine,
      }),
      ...(el.environment === "production" ? {} : { environment: el.environment }),
    },
  };
}

function startCallRequest(anfrage) {
  return {
    fetchImpl: fetch,
    account: anfrage.el,
    body: startCallBody(anfrage),
    callId: anfrage.call.id,
    calleeIsOwner: anfrage.call.calleeIsOwner === true,
    disclosureLanguage: anfrage.locale.disclosureLanguage,
  };
}

function carrierEndeIso(call, nowMs) {
  return new Date(cappedEndedAtMs(call, carrierEndMsOf(call, nowMs), MAX_CALL_DURATION_CAP_S)).toISOString();
}

const TRAEGER_ANKER_BLEIBT = keepAnchor(null);
const ankerFuerPolitik = (politik, anbieterAnker) => (politik.ankerNachziehen ? anbieterAnker : TRAEGER_ANKER_BLEIBT);

function pollFristAbgelaufen(call, nowMs, politik) {
  if (politik.fristAnker === FRIST_ANKER.NACHLAUF_START) return nachlaufFristAbgelaufen(call, nowMs);
  return classifyCallTime(callUnderProviderCap(call), nowMs, ELEVENLABS_PROVIDER_MAX_DURATION_S).expired;
}

function nachlaufFristAbgelaufen(call, nowMs) {
  if (!call.elNachlaufStartedAt) return false;
  return nowMs - Date.parse(call.elNachlaufStartedAt) >= INBOUND_NACHLAUF_FRIST_MS;
}

export function endeSchreiberFuer({ store, callId, status, politik, nowMs }) {
  if (politik.endeAnker === ENDE_ANKER.CARRIER_ENDE)
    return () => store.setCallEndedAt(callId, status, carrierEndeIso(store.getCall(callId), nowMs));
  return () => store.endCallRecord(callId, status);
}

function endeOhneErgebnisIso({ call, nowMs, politik }) {
  if (politik.endeAnker === ENDE_ANKER.CARRIER_ENDE) return carrierEndeIso(call, nowMs);
  return new Date(cappedEndedAtMs(callUnderProviderCap(call), nowMs, ELEVENLABS_PROVIDER_MAX_DURATION_S)).toISOString();
}

async function finishWithoutProviderResult({
  store,
  terminateAndBillCall,
  billThunk,
  finishCall,
  endActiveCall,
  endCarrierCall,
  callId,
  nowMs,
  failureReason,
}) {
  const call = store.getCall(callId);
  if (!call) return;
  const politik = nachlaufPolitikFuer(call);
  const endedAtIso = endeOhneErgebnisIso({ call, nowMs, politik });
  const beenden = politik.beendeVersuch === BEENDE_VERSUCH.TRAEGER ? endCarrierCall : endActiveCall;
  await terminateAndBillCall({
    persistEnd: persistEndWithReason({
      store,
      callId,
      reason: failureReason,
      endCall: () => store.setCallEndedAt(callId, CALL_FAILED, endedAtIso),
    }),
    hangUp: () => beenden(callId),
    bill: billThunk(finishCall, store, callId),
    callId,
  });
}

async function finishExpiredPoll(deps) {
  await finishWithoutProviderResult({ ...deps, failureReason: POLL_TIMEOUT_REASON });
}

async function finishOnPermanentError(deps) {
  const politik = nachlaufPolitikFuer(deps.store.getCall(deps.callId));
  applyAnsweredAnchor(deps.store, deps.callId, ankerFuerPolitik(politik, clearAnchor(ANSWERED_UNCLEAR_REASON_PERMANENT_ERROR)));
  await finishWithoutProviderResult({ ...deps, failureReason: pollProviderErrorReason(deps.providerStatus) });
}

async function finishFromConversation({ store, terminateAndBillCall, billThunk, finishCall, callId, nowMs, conversation }) {
  const politik = nachlaufPolitikFuer(store.getCall(callId));
  persistProviderResult({ store, callId, conversation, belegNachreifbar: true, politik });
  const endCall = endeSchreiberFuer({ store, callId, status: endStatusOf(conversation), politik, nowMs });
  const ended = endCall();
  const anchor = ankerFuerPolitik(politik, answeredAnchorOutcome(ended?.endedAt, conversation));
  applyAnsweredAnchor(store, callId, anchor);
  await terminateAndBillCall({
    persistEnd: persistEndWithReason({ store, callId, reason: providerErrorReasonFor(anchor, conversation), endCall }),
    hangUp: null,
    bill: billThunk(finishCall, store, callId),
    callId,
  });
}

function startInboundNachlauf({ store, laufendeInboundPolls, pollConversationResult, callId }) {
  const { call, changed } = store.markInboundElNachlaufStarted(callId, new Date().toISOString());
  if (!changed) return;
  console.log(`[el-inbound] nachlauf gestartet (call=${callId})`);
  if (laufendeInboundPolls.has(callId)) return;
  laufendeInboundPolls.add(callId);
  void pollConversationResult(callId, call.elevenlabsConversationId);
}

async function awaitAndPersistInboundElResult({ store, fetchConversationSoft, pollMs, callId }) {
  const conversationId = store.getCall(callId)?.elevenlabsConversationId;
  if (!conversationId) return;
  for (let versuch = 1; versuch <= EL_TERMINATION_RESULT_ATTEMPTS; versuch += 1) {
    const { conversation } = await fetchConversationSoft(conversationId, callId, EL_ABORT_PROVIDER_TIMEOUT_MS);
    if (anbieterErgebnisFertig(conversation)) {
      const politik = nachlaufPolitikFuer(store.getCall(callId));
      persistProviderResult({ store, callId, conversation, belegNachreifbar: true, politik });
      return;
    }
    if (versuch < EL_TERMINATION_RESULT_ATTEMPTS) await sleep(pollMs);
  }
  console.warn(`[el-inbound] Ergebnis beim Beenden nicht abrufbar (call=${callId})`);
}

function applyAnsweredAnchor(store, callId, anchor) {
  if (!anchor.keepExistingAnchor) store.trueUpAnsweredAt(callId, anchor.answeredAtIso);
  if (!anchor.unclearReason) return;
  store.recordAnsweredUnclearReason(callId, anchor.unclearReason);
  console.error(`[el-outbound] Buchungsanker ohne Anbieter-Dauer (call=${callId}): ${anchor.unclearReason}`);
}

async function fetchConversationOutcome({ account, conversationId, callId, timeoutMs }) {
  try {
    const conversation = await fetchConversation({ fetchImpl: fetch, account, conversationId, timeoutMs });
    return { conversation, permanent: false, providerStatus: null };
  } catch (err) {
    console.error(`[el-outbound] Ergebnisabruf fehlgeschlagen (call=${callId}):`, err?.message);
    return {
      conversation: null,
      permanent: PERMANENT_FETCH_STATUS.includes(err?.providerStatus),
      providerStatus: err?.providerStatus ?? null,
    };
  }
}

function permanentErrorStreakExceeded(permanentErrorStreaks, callId, permanent) {
  if (!permanent) {
    permanentErrorStreaks.delete(callId);
    return false;
  }
  const streak = (permanentErrorStreaks.get(callId) || 0) + 1;
  if (streak < PERMANENT_ERROR_STREAK_LIMIT) {
    permanentErrorStreaks.set(callId, streak);
    return false;
  }
  permanentErrorStreaks.delete(callId);
  return true;
}

function rearmActiveConversationPolls({ store, pollConversationResult, laufendeInboundPolls }) {
  const activeElCalls = store
    .load()
    .calls.filter((call) => call.elevenlabsConversationId && pollDarfWirken(call));
  for (const call of activeElCalls) {
    if (bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN) laufendeInboundPolls.add(call.id);
    void pollConversationResult(call.id, call.elevenlabsConversationId);
  }
  if (activeElCalls.length)
    console.log(`[el-outbound] Poll-Schleife re-armiert: ${activeElCalls.length} Anrufe`);
}

export function makeElevenLabsOutbound({
  store,
  config,
  terminateAndBillCall,
  billThunk,
  finishCall,
  consultAllowedForCall = ohneRueckfrageTor,
  lookupAvailableFor = ohneRechercheTor,
  metrics = ohneMetrikMeldung,
  endCarrierCall,
}) {
  const settings = () => config.voice.elevenLabsOutbound;

  function scheduleResultPoll(callId, conversationId) {
    setTimeout(() => void pollConversationResult(callId, conversationId), settings().resultPollMs);
  }

  function fetchConversationSoft(conversationId, callId, timeoutMs) {
    return fetchConversationOutcome({ account: settings(), conversationId, callId, timeoutMs });
  }

  const permanentErrorStreaks = new Map();
  const laufendeInboundPolls = new Set();

  async function pollConversationResult(callId, conversationId) {
    let ausgang;
    try {
      ausgang = await pollTakt(callId, conversationId);
    } finally {
      if (ausgang !== FOLGETAKT_GEPLANT) laufendeInboundPolls.delete(callId);
    }
  }

  async function pollTakt(callId, conversationId) {
    const call = store.getCall(callId);
    if (!pollDarfWirken(call)) return;
    const politik = nachlaufPolitikFuer(call);
    const nowMs = Date.now();
    const finishDeps = { store, terminateAndBillCall, billThunk, finishCall, endActiveCall, endCarrierCall, callId, nowMs };
    if (pollFristAbgelaufen(call, nowMs, politik)) return finishExpiredPoll(finishDeps);
    const { conversation, permanent, providerStatus } = await fetchConversationSoft(conversationId, callId);
    if (politik.frischPruefenNachAbruf && !pollDarfWirken(store.getCall(callId))) return;
    if (permanentErrorStreakExceeded(permanentErrorStreaks, callId, permanent))
      return finishOnPermanentError({ ...finishDeps, providerStatus });
    if (!anbieterErgebnisFertig(conversation)) {
      scheduleResultPoll(callId, conversationId);
      return FOLGETAKT_GEPLANT;
    }
    await finishFromConversation({ ...finishDeps, conversation });
  }

  async function endActiveCall(callId) {
    const call = store.getCall(callId);
    const conversationId = call?.elevenlabsConversationId;
    if (!conversationId) return;
    const { conversation } = await fetchConversationSoft(conversationId, callId, EL_ABORT_PROVIDER_TIMEOUT_MS);
    if (conversation) {
      const politik = nachlaufPolitikFuer(call);
      persistProviderResult({ store, callId, conversation, belegNachreifbar: false, politik });
      applyAnsweredAnchor(store, callId, ankerFuerPolitik(politik, answeredAnchorOutcome(call.endedAt, conversation)));
    }
    await endConversation({
      fetchImpl: fetch,
      account: settings(),
      conversationId,
      timeoutMs: EL_ABORT_PROVIDER_TIMEOUT_MS,
    });
  }

  async function originateCall(call) {
    const el = settings();
    assertConfigured(el);
    const { ownerName, firstName } = store.tenantContext(call.tenantId);
    const time = callTimeContext({
      tenantTimezone: store.tenantTimezone(call.tenantId),
      callee: call.to,
    });
    const locale = callLocaleOf({ store, config, call, ownerName });
    const consultAllowed = consultAllowedForCall(call, store.resolveProfile(call.tenantId));
    const lookupAllowed = lookupAvailableFor(call, store.resolveProfile);
    const agentPhoneNumberId = absenderFuerAnruf({ store, call, el, metrics }).agentPhoneNumberId;
    const tenantToken = tenantToolToken({
      secret: config.voice.elevenLabsToolToken,
      tenantId: call.tenantId,
    });
    const anfrage = { el, call, ownerName, firstName, time, locale, consultAllowed, lookupAllowed, agentPhoneNumberId, tenantToken };
    const { conversationId } = config.safety.fakeOriginateElevenlabs
      ? startResultOf(fakeSipTrunkOutboundCallResponse())
      : await startOutboundCall(startCallRequest(anfrage));
    if (!conversationId) throw new Error("ElevenLabs-Anrufstart lieferte keine conversation_id");
    store.recordElevenlabsConversationId(call.id, conversationId);
    store.markAnswered(call.id);
    scheduleResultPoll(call.id, conversationId);
  }

  return {
    originateCall,
    endActiveCall,
    rearmActiveConversationPolls: () => rearmActiveConversationPolls({ store, pollConversationResult, laufendeInboundPolls }),
    startInboundNachlauf: (callId) => startInboundNachlauf({ store, laufendeInboundPolls, pollConversationResult, callId }),
    awaitAndPersistInboundElResult: (callId) =>
      awaitAndPersistInboundElResult({ store, fetchConversationSoft, pollMs: settings().resultPollMs, callId }),
  };
}
