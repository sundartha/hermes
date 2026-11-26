import { HTTP_NOT_FOUND, HTTP_UNAUTHORIZED } from "../utils/http.ts";
import { anrufStart, eroeffnungsVariablen, offenlegungssatz, providerVoicemailMessage } from "../anrufe/start/anrufstart.ts";
import { callLocaleOf } from "./call-locale.ts";
import { PLACEHOLDER_OPENER, drittEroeffnung as drittEroeffnungText } from "../i18n/eroeffnung.ts";
import { LOCALES, afterGreeting, localeFor } from "../i18n/locales.ts";
import { cappedEndedAtMs, carrierEndMsOf, classifyCallTime, FROM_SOURCE } from "../store/state-ops.js";
import { MAX_CALL_DURATION_CAP_S } from "../begriffe/anrufe.ts";
import { BRIDGE_STATE, bridgeStateOf, istOutboundElProfil } from "./inbound-bridge-state.ts";
import { BEENDE_VERSUCH, ENDE_ANKER, FRIST_ANKER, nachlaufPolitikFuer, pollDarfWirken } from "./nachlauf-politik.ts";
import { BUSY_INVITE_REASON, POLL_TIMEOUT_REASON, START_UNKLAR_REASON, pollProviderErrorReason, providerErrorReason, reasonWithoutCarrier } from "../telephony/failure-reason.ts";
import { composedOpeningLine, ownerOpeningLine, verifiedOpeningLine } from "./opening-line.ts";
import { besitzerAnlassEroeffnung } from "./besitzer-anlass.ts";
import { anschlussSatz } from "./vorspann-anschluss.ts";
import { tenantToolToken } from "./tenant-tool-token.ts";
import { MS_PER_SECOND } from "../utils/timer.ts";
import { sleep } from "../utils/uhr-warten.ts";
import { anfrage as anfrageNachAussen } from "../utils/anfrage.js";
import { REQUEST_TIMEOUT_MS, assertEroeffnungGeprueft, endConversation, fetchConversation, listConversations } from "./convai.ts";
import { makeAnrufstartAuftrag } from "./anrufstart-auftrag.ts";
import { AUDIO_TAG, findeB1Treffer } from "./b1-doppelankaendigung.ts";
import { medienwegZeilen } from "./medienweg.ts";
import { spokenTimezoneName } from "./nanp-area-codes.ts";
import { callTimeContext } from "./time-context.ts";
import { persistEndWithReason } from "../telephony/call-termination.ts";
import { entferneKlammern } from "../i18n/audio-tags.ts";
import { permanentErrorStreakExceeded } from "./fehlerserie.ts";
import { anrufFuehrtTelnyxSip, recordElevenLabsKostenBelege } from "./kosten-beleg.ts";
import { NICHT_ANGENOMMEN_GRUND, nichtErreichtNachFrist } from "./nicht-erreicht-frist.ts";
import { meldeAgentErsteRede } from "./anrufstart-messung.ts";
import { meldeVorspannEroeffnung } from "./vorspann-erzeugen.js";
import { ermittleStimmenAnzahl } from "./wirksame-stimme.ts";

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

export const ANSWERED_REASON_NOT_ANSWERED = "call_duration_secs_zero_not_answered";
const ANSWERED_REASON_CONVERSATION_RUNNING = "call_duration_secs_unknown_conversation_in_progress";

const ANSWERED_REASON_PROVIDER_REJECTED = "provider_rejected_before_answer";

const PERMANENT_FETCH_STATUS = Object.freeze([HTTP_UNAUTHORIZED, HTTP_NOT_FOUND]);

export { PERMANENT_ERROR_STREAK_LIMIT } from "./fehlerserie.ts";

const ANSWERED_UNCLEAR_REASON_PERMANENT_ERROR = "poll_permanent_provider_error";

export const ELEVENLABS_PROVIDER_MAX_DURATION_S = 600;

export const INBOUND_NACHLAUF_FRIST_MS = ELEVENLABS_PROVIDER_MAX_DURATION_S * MS_PER_SECOND;


const ABFRAGE_UEBERNAHME_MS = 30_000;
const ABFRAGE_FRIST_FEHLER = "[fristen] Abfrage-Frist schreiben fehlgeschlagen:";

function callUnderProviderCap(call) {
  const eigeneFrist = call.maxDurationS || ELEVENLABS_PROVIDER_MAX_DURATION_S;
  return { ...call, maxDurationS: Math.min(eigeneFrist, ELEVENLABS_PROVIDER_MAX_DURATION_S) };
}

export const EL_ABORT_PROVIDER_TIMEOUT_MS = 10000;

export const EL_TERMINATION_RESULT_ATTEMPTS = 3;

const AGENT_ROLE = "agent";
const CALLER_ROLE = "caller";

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

async function persistCollectedFields({ store, callId, conversation, politik }) {
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
  if (nextStep) await store.addActionItem(callId, nextStep.text, nextStep.type);
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

const objectiveAchievedOf = () => OBJECTIVE_ACHIEVED_UNKNOWN;

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

const busyAware = (reason) => (reasonWithoutCarrier(reason) === BUSY_INVITE_REASON ? "busy" : reason);

function endeGrundFuer(anchor, conversation) {
  if (anchor.answeredAtIso || anchor.keepExistingAnchor) return null;
  if (anchor.unclearReason === ANSWERED_REASON_NOT_ANSWERED && spokenLines(conversation).length === 0) return NICHT_ANGENOMMEN_GRUND;
  return busyAware(providerErrorReason(conversation.metadata?.error));
}

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

export { PLACEHOLDER_OPENER };

function calleeRelationText({ call, owner, offenlegung }) {
  if (call.calleeIsOwner !== true) return "";
  const block = `\n${EN_PROMPT.calleeRelation({ owner, disclosure: offenlegungssatz(offenlegung, owner) })}`;
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

const GATE_AVAILABLE = "available";
const GATE_UNAVAILABLE = "unavailable";

const ohneRueckfrageTor = () => false;

export function mitAuftragsurteil({ finishCall, summarizeCall }) {
  const bewertet = new WeakSet();
  return async (call) => {
    if (istOutboundElProfil(call) && call.status === CALL_COMPLETED && !bewertet.has(call)) {
      bewertet.add(call);
      await summarizeCall(call).catch((err) => console.error("[summary]", err.message));
    }
    return finishCall(call);
  };
}

const ohneRechercheTor = () => false;

export function dynamicVariables({
  call,
  owner,
  offenlegung,
  openingLine,
  eroeffnung = "",
  voicemailOpening = openingLine,
  time,
  consultAllowed,
  lookupAllowed,
  tenantToken,
  eroeffnungGesagt = "",
  callLimitS = "",
}) {
  return {
    ...(eroeffnungGesagt ? { eroeffnung_gesagt: eroeffnungGesagt } : {}),
    consult_available: consultAllowed === true ? GATE_AVAILABLE : GATE_UNAVAILABLE,
    lookup_available: lookupAllowed === true ? GATE_AVAILABLE : GATE_UNAVAILABLE,
    ...eroeffnungsVariablen({ openingLine: afterGreeting(openingLine), eroeffnung }),
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
    voicemail_line: voicemailText({ owner, offenlegung, openingLine: voicemailOpening }),
    call_limit_s: callLimitS,
    inbound_situation: "",
    tenant_token: tenantToken,
  };
}

function recordAbsenderMessung(store, callId, conversation) {
  store.recordActualSender(callId, {
    e164: conversation.metadata?.phone_call?.agent_number,
    source: FROM_SOURCE.PROVIDER_MEASURED,
  });
}

function bereitsGespeicherteAnbieterZeilen(gespeichert, zeilen) {
  const gleich = (eintrag, zeile) => eintrag.role === roleOf(zeile.role) && eintrag.text === entferneKlammern(zeile.message);
  const hoechstens = Math.min(gespeichert.length, zeilen.length);
  const laengen = Array.from(Array(hoechstens).keys(), (index) => hoechstens - index);
  const treffer = laengen.find((anzahl) =>
    gespeichert.slice(gespeichert.length - anzahl).every((eintrag, index) => gleich(eintrag, zeilen[index])),
  );
  return treffer ?? 0;
}

async function schreibeNeueAnbieterZeilenOnce(store, callId, zeilen) {
  const call = await store.leseCall(callId);
  if (!call) return;
  for (const zeile of zeilen.slice(bereitsGespeicherteAnbieterZeilen(call.transcript ?? [], zeilen)))
    await store.addTranscript(callId, roleOf(zeile.role), zeile.message);
}

const anbieterZeilenSchreiber = new Map();

function schreibeNeueAnbieterZeilen(store, callId, zeilen) {
  const ergebnis = (anbieterZeilenSchreiber.get(callId) ?? Promise.resolve()).then(() =>
    schreibeNeueAnbieterZeilenOnce(store, callId, zeilen),
  );
  const ende = ergebnis.catch(() => {});
  anbieterZeilenSchreiber.set(callId, ende);
  ende.then(() => {
    if (anbieterZeilenSchreiber.get(callId) === ende) anbieterZeilenSchreiber.delete(callId);
  });
  return ergebnis;
}

async function sichereErgebnisUndFelder({ store, callId, conversation, politik }) {
  try {
    store.recordProviderCallResult(callId, {
      summary: providerSummaryOf(conversation, politik),
      objectiveAchieved: objectiveAchievedOf(),
    });
    await persistCollectedFields({ store, callId, conversation, politik });
    return null;
  } catch (fehler) {
    return { fehler };
  }
}

async function persistProviderResult({ store, callId, conversation, belegNachreifbar, politik, stimmenAnzahlFuer }) {
  const zeilen = spokenLines(conversation);
  const audioTagMarken = reportAudioTags(callId, zeilen);
  const b1Treffer = reportDoubleAnnouncements(callId, zeilen);
  const stimmenAnzahl = await stimmenAnzahlFuer(callId);
  await store.recordElDetectorCounts(callId, {
    elTags: audioTagMarken.length,
    elB1: b1Treffer.length,
    ...(stimmenAnzahl === null ? {} : { stimmenAnzahl }),
  });
  await schreibeNeueAnbieterZeilen(store, callId, zeilen);
  const speicherFehler = await sichereErgebnisUndFelder({ store, callId, conversation, politik });
  const call = await store.leseCall(callId);
  if (call) meldeAgentErsteRede({ call, conversation });
  const fuehrtTelnyxSip = anrufFuehrtTelnyxSip(call);
  if (fuehrtTelnyxSip) store.recordSipCallId(callId, conversation.metadata?.phone_call?.call_id);
  recordAbsenderMessung(store, callId, conversation);
  recordElevenLabsKostenBelege({
    store,
    callId,
    conversation,
    belegNachreifbar,
    erwarteTelnyxSip: fuehrtTelnyxSip,
    jetzt: () => new Date(),
  });
  if (speicherFehler) throw speicherFehler.fehler;
}

function ownerFirstMessage({ call, offenlegung, firstName }) {
  if (call.calleeIsOwner !== true) return "";
  const openingLine = verifiedOpeningLine({ call, locale: offenlegung });
  return sichereEroeffnung([besitzerAnlassEroeffnung({ ownerOpening: offenlegung.ownerOpening, firstName, openingLine })]);
}

function sichereEroeffnung(teile) {
  const text = teile.filter(Boolean).join(" ").trim();
  return !text || text.includes(PLACEHOLDER_OPENER) ? "" : text;
}

function drittEroeffnung({ locale, offenlegung, owner, firstName, openingLine }) {
  if (locale.providerLanguage === locale.disclosureLanguage) {
    const { text, pflichtsatz } = drittEroeffnungText({
      language: locale.language,
      ownerName: owner,
      firstName: vornameOhnePlatzhalter(firstName),
      reason: openingLine,
    });
    return { text: sichereEroeffnung([text]), pflichtsatz };
  }
  const pflichtsatz = offenlegungssatz(offenlegung, owner);
  return { text: sichereEroeffnung([pflichtsatz, openingLine]), pflichtsatz };
}

function vornameOhnePlatzhalter(firstName) {
  const vorname = alsText(firstName);
  return vorname.includes(PLACEHOLDER_OPENER) ? "" : vorname;
}

function openingLinesOf({ call, locale }) {
  const bundle = localeFor(locale.language);
  return {
    openingLine: verifiedOpeningLine({ call, locale: bundle }),
    ownerLine: ownerOpeningLine({ call, locale: bundle }),
  };
}

export function eroeffnungFuerAnruf({ store, config, call }) {
  const { ownerName, firstName } = store.tenantContext(call.tenantId);
  const locale = callLocaleOf({ store, config, call, ownerName });
  const offenlegung = localeFor(locale.disclosureLanguage);
  const owner = auftraggeberAusdruck(ownerName, offenlegung);
  const { openingLine, ownerLine } = openingLinesOf({ call, locale });
  const ownerEroeffnung = ownerFirstMessage({ call, offenlegung, firstName });
  if (ownerEroeffnung) {
    return { text: ownerEroeffnung, pflichtsatz: offenlegung.ownerOpening(alsText(firstName)), voiceId: locale.voiceId };
  }
  const { text, pflichtsatz } = drittEroeffnung({ locale, offenlegung, owner, firstName, openingLine });
  return { text, pflichtsatz, voiceId: locale.voiceId };
}

export function initiationContent({
  call,
  ownerName,
  firstName,
  time,
  locale,
  consultAllowed,
  lookupAllowed,
  tenantToken,
  eroeffnungGesagt,
  environment,
}) {
  const bundle = localeFor(locale.language);
  const offenlegung = localeFor(locale.disclosureLanguage);
  const { openingLine, ownerLine } = openingLinesOf({ call, locale });
  const owner = auftraggeberAusdruck(ownerName, offenlegung);
  const start = anrufStart({
    sprachen: locale,
    dritt: drittEroeffnung({ locale, offenlegung, owner, firstName, openingLine }).text,
    ownerEroeffnung: ownerFirstMessage({ call, offenlegung, firstName }),
    eroeffnungGesagt: Boolean(eroeffnungGesagt),
    folgesatz: eroeffnungGesagt ? anschlussSatz({ language: locale.language, anlass: openingLine }) : "",
  });
  return {
    dynamic_variables: dynamicVariables({
      call,
      owner,
      offenlegung,
      openingLine,
      eroeffnung: start.eroeffnung,
      voicemailOpening: composedOpeningLine(ownerLine, bundle),
      time,
      consultAllowed,
      lookupAllowed,
      tenantToken,
      eroeffnungGesagt,
      callLimitS: String(callUnderProviderCap(call).maxDurationS),
    }),
    conversation_config_override: start.override,
    ...(environment === "production" ? {} : { environment }),
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
    return async () => store.setCallEndedAt(callId, status, carrierEndeIso(await store.leseCall(callId), nowMs));
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
  const call = await store.leseCall(callId);
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

async function finishNichtErreicht(deps) {
  await applyAnsweredAnchor(deps.store, deps.callId, clearAnchor(ANSWERED_REASON_NOT_ANSWERED));
  await finishWithoutProviderResult({ ...deps, failureReason: NICHT_ANGENOMMEN_GRUND });
}

async function finishOnPermanentError(deps) {
  const politik = nachlaufPolitikFuer(await deps.store.leseCall(deps.callId));
  await applyAnsweredAnchor(deps.store, deps.callId, ankerFuerPolitik(politik, clearAnchor(ANSWERED_UNCLEAR_REASON_PERMANENT_ERROR)));
  await finishWithoutProviderResult({ ...deps, failureReason: pollProviderErrorReason(deps.providerStatus) });
}

async function billingAfterAnchor({ store, callId, anchor, billThunk, finishCall }) {
  await applyAnsweredAnchor(store, callId, anchor);
  return billThunk(finishCall, store, callId);
}

const ERGEBNIS_SICHERN_FEHLER = "[el-nachlauf] Anbieter-Ergebnis nicht gesichert, Anruf wird trotzdem beendet und abgerechnet:";
const abschluesseImGang = new Set();

async function finishFromConversation(deps) {
  if (abschluesseImGang.has(deps.callId)) return;
  abschluesseImGang.add(deps.callId);
  try {
    await finishFromConversationOnce(deps);
  } finally {
    abschluesseImGang.delete(deps.callId);
  }
}

async function finishFromConversationOnce({ store, terminateAndBillCall, billThunk, finishCall, stimmenAnzahlFuer, callId, nowMs, conversation }) {
  const politik = nachlaufPolitikFuer(await store.leseCall(callId));
  try {
    await persistProviderResult({ store, callId, conversation, belegNachreifbar: true, politik, stimmenAnzahlFuer });
  } catch (fehler) {
    if (fehler?.frist) throw fehler;
    console.error(ERGEBNIS_SICHERN_FEHLER, `(call=${callId})`, String(fehler));
  }
  const vorlaeufig = ankerFuerPolitik(politik, answeredAnchorOutcome(new Date(nowMs).toISOString(), conversation));
  const status = endeGrundFuer(vorlaeufig, conversation) ? CALL_FAILED : endStatusOf(conversation);
  const endCall = endeSchreiberFuer({ store, callId, status, politik, nowMs });
  const ended = await endCall();
  const anchor = ankerFuerPolitik(politik, answeredAnchorOutcome(ended?.endedAt, conversation));
  const bill = await billingAfterAnchor({ store, callId, anchor, billThunk, finishCall });
  await terminateAndBillCall({
    persistEnd: persistEndWithReason({ store, callId, reason: endeGrundFuer(anchor, conversation), endCall }),
    hangUp: null,
    bill,
    callId,
  });
  store.leitungsplaetze?.freigeben(callId);
}

async function startInboundNachlauf({ store, laufendeInboundPolls, pollConversationResult, callId }) {
  const beanspruchen = store.beanspruecheInboundElNachlauf ?? store.markInboundElNachlaufStarted;
  const { call, changed } = await beanspruchen(callId, new Date().toISOString());
  if (!changed) return;
  console.log(`[el-inbound] nachlauf gestartet (call=${callId})`);
  if (laufendeInboundPolls.has(callId)) return;
  laufendeInboundPolls.add(callId);
  void pollConversationResult(callId, call.elevenlabsConversationId);
}

async function awaitAndPersistInboundElResult({ store, fetchConversationSoft, stimmenAnzahlFuer, pollMs, callId }) {
  const conversationId = (await store.leseCall(callId))?.elevenlabsConversationId;
  if (!conversationId) return;
  for (let versuch = 1; versuch <= EL_TERMINATION_RESULT_ATTEMPTS; versuch += 1) {
    const { conversation } = await fetchConversationSoft(conversationId, callId, EL_ABORT_PROVIDER_TIMEOUT_MS);
    if (anbieterErgebnisFertig(conversation)) {
      const politik = nachlaufPolitikFuer(await store.leseCall(callId));
      await persistProviderResult({ store, callId, conversation, belegNachreifbar: true, politik, stimmenAnzahlFuer });
      return;
    }
    if (versuch < EL_TERMINATION_RESULT_ATTEMPTS) await sleep(pollMs);
  }
  console.warn(`[el-inbound] Ergebnis beim Beenden nicht abrufbar (call=${callId})`);
}

async function applyAnsweredAnchor(store, callId, anchor) {
  if (!anchor.keepExistingAnchor) await store.trueUpAnsweredAt(callId, anchor.answeredAtIso);
  if (!anchor.unclearReason) return;
  await store.recordAnsweredUnclearReason(callId, anchor.unclearReason);
  console.error(`[el-outbound] Buchungsanker ohne Anbieter-Dauer (call=${callId}): ${anchor.unclearReason}`);
}

async function fetchConversationOutcome({ account, conversationId, callId, timeoutMs }) {
  try {
    const conversation = await fetchConversation({ fetchImpl: anfrageNachAussen, account, conversationId, timeoutMs });
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

async function saveProviderResultIfFetched({ store, fetchConversationSoft, stimmenAnzahlFuer, callId }) {
  const call = await store.leseCall(callId);
  const conversationId = call?.elevenlabsConversationId;
  if (!conversationId) return null;
  const { conversation } = await fetchConversationSoft(conversationId, callId, EL_ABORT_PROVIDER_TIMEOUT_MS);
  if (conversation) {
    const politik = nachlaufPolitikFuer(call);
    await persistProviderResult({ store, callId, conversation, belegNachreifbar: false, politik, stimmenAnzahlFuer });
    await applyAnsweredAnchor(store, callId, ankerFuerPolitik(politik, answeredAnchorOutcome(call.endedAt, conversation)));
  }
  return { callId, conversationId };
}

const MAX_GEMELDETE_GESPRAECHE = 1000;

function makeMedienwegWache(erwartetFn) {
  const gemeldet = new Set();
  return function meldeMedienweg({ conversation, callId, conversationId }) {
    try {
      if (gemeldet.has(conversationId)) return;
      const zeilen = medienwegZeilen({ conversation, callId, conversationId, erwartet: erwartetFn() });
      if (zeilen === null) return;
      if (gemeldet.size >= MAX_GEMELDETE_GESPRAECHE) gemeldet.delete(gemeldet.values().next().value);
      gemeldet.add(conversationId);
      console.log(zeilen.info);
      if (zeilen.abweichung) console.warn(zeilen.abweichung);
    } catch (err) {
      console.error(`[el-medienweg] Wache gescheitert (call=${callId}):`, err?.message);
    }
  };
}

async function deleteConversationAtProvider({ account, callId, conversationId }) {
  const { accepted, status } = await endConversation({
    fetchImpl: anfrageNachAussen,
    account,
    conversationId,
    timeoutMs: EL_ABORT_PROVIDER_TIMEOUT_MS,
  });
  if (!accepted)
    console.warn(`[el-outbound] Loeschversuch beim Anbieter fehlgeschlagen (call=${callId}) status=${status}`);
}

function makeInhaltsAnfrage({ store, config, consultAllowedForCall, lookupAvailableFor }) {
  return function inhaltsAnfrageFor(call) {
    const { ownerName, firstName } = store.tenantContext(call.tenantId);
    const time = callTimeContext({
      tenantTimezone: store.tenantTimezone(call.tenantId),
      callee: call.to,
      jetzt: () => new Date(),
    });
    const locale = callLocaleOf({ store, config, call, ownerName });
    const consultAllowed = consultAllowedForCall(call, store.resolveProfile(call.tenantId));
    const lookupAllowed = lookupAvailableFor(call, store.resolveProfile);
    const tenantToken = tenantToolToken({
      secret: config.voice.elevenLabsToolToken,
      tenantId: call.tenantId,
    });
    const { environment } = config.voice.elevenLabsOutbound;
    return { call, ownerName, firstName, time, locale, consultAllowed, lookupAllowed, tenantToken, environment };
  };
}

const uebergebeneEroeffnung = ({ conversation_config_override: override, dynamic_variables: variablen }) =>
  String(override.agent.first_message || variablen.eroeffnung || variablen.eroeffnung_gesagt || "");

function makeInitInhalt(inhaltsAnfrageFor) {
  return function initInhaltFor(call, eroeffnungGesagt) {
    const anfrage = inhaltsAnfrageFor(call);
    const inhalt = initiationContent(anfrage);
    const pruefkoerper = {
      conversation_initiation_client_data: {
        dynamic_variables: inhalt.dynamic_variables,
        conversation_config_override: inhalt.conversation_config_override,
      },
    };
    assertEroeffnungGeprueft(pruefkoerper, call.id, {
      calleeIsOwner: call.calleeIsOwner === true,
      disclosureLanguage: anfrage.locale.disclosureLanguage,
    });
    const gesendet = eroeffnungGesagt ? initiationContent({ ...anfrage, eroeffnungGesagt }) : inhalt;
    meldeVorspannEroeffnung({ callId: call.id, text: uebergebeneEroeffnung(gesendet) });
    return gesendet;
  };
}

function macheAnrufstartAuftragMit(verbindung, { store, config, settings, schreibeAbfrageFrist, beende }) {
  async function haltAnrufStartFest(call, conversationId) {
    store.recordElevenlabsConversationId(call.id, conversationId);
    await store.markAnswered(call.id);
    await schreibeAbfrageFrist(call, settings().resultPollMs ?? 0);
  }

  return makeAnrufstartAuftrag({
    ...verbindung,
    store,
    anbieterGespraeche: {
      liste: (query) => listConversations({ fetchImpl: anfrageNachAussen, account: settings(), query }),
      hole: (conversationId) => fetchConversation({ fetchImpl: anfrageNachAussen, account: settings(), conversationId }),
    },
    haltAnrufStartFest,
    beendeStartUnklar: (callId) =>
      finishWithoutProviderResult({ store, ...beende, callId, nowMs: Date.now(), failureReason: START_UNKLAR_REASON }),
    mandantenToken: (tenantId) => tenantToolToken({ secret: config.voice.elevenLabsToolToken, tenantId }),
    wartefristMs: settings().anrufstartWartefristMs,
  });
}

export function makeElevenLabsOutbound({
  store,
  config,
  terminateAndBillCall,
  billThunk,
  finishCall,
  consultAllowedForCall = ohneRueckfrageTor,
  lookupAvailableFor = ohneRechercheTor,
  endCarrierCall,
}) {
  const settings = () => config.voice.elevenLabsOutbound;
  const inhaltsAnfrageFor = makeInhaltsAnfrage({ store, config, consultAllowedForCall, lookupAvailableFor });
  const initInhaltFor = makeInitInhalt(inhaltsAnfrageFor);

  const resultPollMs = () => settings().resultPollMs ?? 0;

  const meldeMedienweg = makeMedienwegWache(() => settings().erwarteterMedienweg);
  const stimmenAnzahlFuer = (callId) => ermittleStimmenAnzahl({ store, config, callId });

  async function fetchConversationSoft(conversationId, callId, timeoutMs) {
    const ausgang = await fetchConversationOutcome({ account: settings(), conversationId, callId, timeoutMs });
    meldeMedienweg({ conversation: ausgang.conversation, callId, conversationId });
    return ausgang;
  }

  const laufendeInboundPolls = new Set();
  const laufendeKetten = new Set();

  async function pollConversationResult(callId, conversationId) {
    laufendeKetten.add(callId);
    try {
      await pollTakt(callId, conversationId);
    } finally {
      laufendeInboundPolls.delete(callId);
      laufendeKetten.delete(callId);
    }
  }

  async function schreibeAbfrageFrist(call, abstandMs) {
    const faelligAt = new Date(Date.now() + abstandMs).toISOString();
    try {
      await store.setzeAbfrageFrist({ callId: call.id, tenantId: call.tenantId, faelligAt });
    } catch (fehler) {
      console.error(ABFRAGE_FRIST_FEHLER, call.id, String(fehler));
    }
  }

  async function abfrageDurchLauf(callId) {
    const call = await store.leseCall(callId);
    const conversationId = call?.elevenlabsConversationId;
    if (!conversationId || laufendeKetten.has(callId)) return;
    if (bridgeStateOf(call) === BRIDGE_STATE.GEBUNDEN) laufendeInboundPolls.add(callId);
    void pollConversationResult(callId, conversationId);
  }

  async function pollTakt(callId, conversationId) {
    const call = await store.leseCall(callId);
    if (!pollDarfWirken(call)) return;
    const politik = nachlaufPolitikFuer(call);
    const nowMs = Date.now();
    const finishDeps = { store, terminateAndBillCall, billThunk, finishCall, stimmenAnzahlFuer, endActiveCall, endCarrierCall, callId, nowMs };
    if (pollFristAbgelaufen(call, nowMs, politik)) return finishExpiredPoll(finishDeps);
    await schreibeAbfrageFrist(call, REQUEST_TIMEOUT_MS + ABFRAGE_UEBERNAHME_MS);
    const { conversation, permanent, providerStatus } = await fetchConversationSoft(conversationId, callId);
    if (politik.frischPruefenNachAbruf && !pollDarfWirken(await store.leseCall(callId))) return;
    if (await permanentErrorStreakExceeded({ store, call, permanent }))
      return finishOnPermanentError({ ...finishDeps, providerStatus });
    if (!anbieterErgebnisFertig(conversation)) {
      if (conversation && nichtErreichtNachFrist({ call, conversation, nowMs })) return finishNichtErreicht(finishDeps);
      if (conversation) await schreibeNeueAnbieterZeilen(store, callId, spokenLines(conversation));
      await schreibeAbfrageFrist(call, resultPollMs());
      return;
    }
    await finishFromConversation({ ...finishDeps, conversation });
  }

  async function endActiveCall(callId) {
    const conversationRef = await saveProviderResultIfFetched({
      store,
      fetchConversationSoft,
      stimmenAnzahlFuer: async () => null,
      callId,
    });
    if (!conversationRef) return;
    await deleteConversationAtProvider({ account: settings(), ...conversationRef });
  }

  return {
    macheAnrufstartAuftrag: (verbindung) =>
      macheAnrufstartAuftragMit(verbindung, {
        store, config, settings, schreibeAbfrageFrist,
        beende: { terminateAndBillCall, billThunk, finishCall, endActiveCall, endCarrierCall },
      }),
    initInhaltFor,
    endActiveCall,
    abfrageDurchLauf,
    startInboundNachlauf: (callId) => startInboundNachlauf({ store, laufendeInboundPolls, pollConversationResult, callId }),
    awaitAndPersistInboundElResult: (callId) =>
      awaitAndPersistInboundElResult({ store, fetchConversationSoft, stimmenAnzahlFuer, pollMs: settings().resultPollMs, callId }),
  };
}
