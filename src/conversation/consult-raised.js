import { config } from "../config.js";
import { CONSULT_POLL_TICK_MS } from "../consult/delivery.js";
import { sanitizeConsultQuestion } from "../consult/question.js";
import { CONSULT_STATUS, CONSULT_TIMEOUT_REASON } from "../store/defaults.js";
import { expireOrphanedConsults } from "../store/state-ops.js";

export const CONSULT_RESULT = Object.freeze({
  ANSWERED: "answered",
  REJECTED: "rejected",
  TIMEOUT: "timeout",
});

export const EL_CONSULT_STAGES = Object.freeze({
  deliveryDeadlineMs: config.tenancy.elConsultDeliveryMs,
  ackDeadlineMs: config.tenancy.elConsultDeliveryMs + config.tenancy.elConsultAckMs,
  answerDeadlineMs: config.tenancy.elConsultAnswerMs,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rejected = (reason) => ({ kind: CONSULT_RESULT.REJECTED, facts: [], reason });
const timedOut = (reason, abortTrace = null) => ({
  kind: CONSULT_RESULT.TIMEOUT,
  facts: [],
  reason,
  abortTrace,
});

function spanMs(vonIso, bisIso) {
  const von = Date.parse(vonIso ?? "");
  const bis = Date.parse(bisIso ?? "");
  return Number.isFinite(von) && Number.isFinite(bis) ? bis - von : null;
}

function makeAbortTrace(consult, holdMs) {
  return {
    consultId: consult.id,
    holdMs,
    deliveredAfterMs: spanMs(consult.askedAt, consult.askDeliveredAt),
    ackedAfterMs: spanMs(consult.askDeliveredAt, consult.ackedAt),
  };
}

function expiredStage(consult, ageMs, stages) {
  if (!consult.askDeliveredAt && ageMs >= stages.deliveryDeadlineMs)
    return { reason: CONSULT_TIMEOUT_REASON.NOT_DELIVERED, stageMs: stages.deliveryDeadlineMs };
  if (!consult.ackedAt && ageMs >= stages.ackDeadlineMs)
    return { reason: CONSULT_TIMEOUT_REASON.NOT_ACKED, stageMs: stages.ackDeadlineMs };
  if (ageMs >= stages.answerDeadlineMs)
    return { reason: CONSULT_TIMEOUT_REASON.TIMEOUT, stageMs: stages.answerDeadlineMs };
  return null;
}

function logConsultRaised(callId, consultId, stages) {
  console.log(
    `[consult-raised] gestellt call=${callId} event=${consultId} ` +
      `zustellung_ms=${stages.deliveryDeadlineMs} quittung_ms=${stages.ackDeadlineMs} ` +
      `antwort_ms=${stages.answerDeadlineMs}`,
  );
}

function keyFactsOf(call) {
  const context = call?.context;
  return Array.isArray(context?.key_facts) ? context.key_facts : [];
}

function consultById(call, consultId) {
  const chain = Array.isArray(call?.consults) ? call.consults : [];
  return chain.find((consult) => consult.id === consultId) || null;
}

export function makeConsultRaised({
  store,
  isDraining = () => false,
  stages = EL_CONSULT_STAGES,
  tickMs = CONSULT_POLL_TICK_MS,
}) {
  function raise(callId, question) {
    const call = store.emitConsult(callId, [question]);
    const chain = Array.isArray(call?.consults) ? call.consults : [];
    return chain.at(-1) || null;
  }

  function answeredFacts(call, consult) {
    const from = consult.answeredFactsFrom;
    if (!Number.isSafeInteger(from) || from < 0) return [];
    return keyFactsOf(call).slice(from, from + consult.answeredFacts);
  }

  function closeOrphaned(callId, nowMs) {
    const { changed } = expireOrphanedConsults(store.load(), callId, {
      nowMs,
      openMs: stages.answerDeadlineMs,
    });
    if (changed) store.save();
  }

  async function awaitAnswer({ callId, consultId }) {
    const startedAtMs = Date.now();
    for (;;) {
      const call = store.getCall(callId);
      if (!call || call.status !== "active") return timedOut("anruf_beendet");
      const consult = consultById(call, consultId);
      if (!consult) return timedOut("consult_verschwunden");
      if (consult.status === CONSULT_STATUS.ANSWERED)
        return { kind: CONSULT_RESULT.ANSWERED, facts: answeredFacts(call, consult) };
      if (consult.status !== CONSULT_STATUS.OPEN) return timedOut(consult.status);
      const nowMs = Date.now();
      const ageMs = nowMs - startedAtMs;
      const stage = expiredStage(consult, ageMs, stages);
      if (stage) {
        store.timeOutStagedConsult(callId, {
          consultId,
          reason: stage.reason,
          nowMs,
          stageMs: stage.stageMs,
        });
        return timedOut(stage.reason, makeAbortTrace(consult, ageMs));
      }
      if (isDraining()) {
        closeOrphaned(callId, nowMs);
        return timedOut("drain");
      }
      await sleep(tickMs);
    }
  }

  return async function onConsultRaised({ callId, question }) {
    const call = store.getCall(callId);
    if (!call) return rejected("kein_anruf");
    const asked = sanitizeConsultQuestion(question, call.transcript);
    if (!asked) return rejected("frage_abgelehnt");
    const consult = raise(callId, asked);
    if (!consult) return rejected("nicht_emittiert");
    logConsultRaised(callId, consult.id, stages);
    return awaitAnswer({ callId, consultId: consult.id });
  };
}
