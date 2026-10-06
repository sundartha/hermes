import { MOCK_OBJECTIVE } from "../conversation-driver-contract.js";

const DEFAULT_CALLBACK_DELAY_MS = 1;

const REJECT_REASON = "mock_abgelehnt";
const OUTCOME_SUMMARY = "Auftrag abgeschlossen (Attrappe-Laufwerk).";
const CONSULT_QUESTION = "Attrappe-Rueckfrage: passt der vorgeschlagene Termin?";
const CONSULT_QUESTION_SECOND = "Attrappe-Rueckfrage: reicht auch 15 statt 30 Minuten?";
const CONSULT_ANSWERED_PREFIX = "Antwort erhalten: ";
const CONSULT_UNANSWERED_PREFIX = "Keine Antwort erhalten: ";
const ENDED_MID_CONSULT_PREFIX = "Vom Auftraggeber beendet, bevor eine Antwort eintraf: ";
const NEVER_CONNECTED_REASON = "no-answer";
const NEVER_CONNECTED_SUMMARY = "Niemand hat abgenommen (Attrappe-Laufwerk).";

let requestSequence = 0;

function nextRequestId(callId) {
  requestSequence += 1;
  return `${callId}-req-${requestSequence}`;
}

function buildTranscriptSoFar(params) {
  return [params.disclosureSentence, "Ja, ich hoere."];
}

function buildConsultRequest(callId, params, question) {
  return {
    callId,
    requestId: nextRequestId(callId),
    question,
    transcriptSoFar: buildTranscriptSoFar(params),
  };
}

function outcomeFromConsultAnswer(callId, answer) {
  if (answer.kind === "answered") {
    return {
      callId,
      connected: true,
      achieved: true,
      summary: CONSULT_ANSWERED_PREFIX + answer.facts.join(", "),
    };
  }
  return { callId, connected: true, achieved: null, summary: CONSULT_UNANSWERED_PREFIX + answer.reason };
}

function outcomeFromEndedConsult(callId, endReason) {
  return { callId, connected: true, achieved: null, summary: ENDED_MID_CONSULT_PREFIX + endReason };
}

function createTimerRegistry() {
  const timers = new Map();
  return {
    schedule(callId, delayMs, run) {
      const timer = setTimeout(() => {
        timers.delete(callId);
        run();
      }, delayMs);
      timers.set(callId, timer);
    },
    cancel(callId) {
      const timer = timers.get(callId);
      if (timer) {
        clearTimeout(timer);
        timers.delete(callId);
      }
    },
  };
}

function createEndSignalRegistry() {
  const signals = new Map();
  return {
    signalFor(callId) {
      if (!signals.has(callId)) {
        let resolve;
        const promise = new Promise((res) => {
          resolve = res;
        });
        signals.set(callId, { promise, resolve });
      }
      return signals.get(callId);
    },
    clear(callId) {
      signals.delete(callId);
    },
    resolveWith(callId, reason) {
      const signal = signals.get(callId);
      if (signal) {
        signals.delete(callId);
        signal.resolve(reason);
      }
    },
  };
}

export function makeMockConversationDriver({ callbacks, callbackDelayMs = DEFAULT_CALLBACK_DELAY_MS }) {
  const timers = createTimerRegistry();
  const endSignals = createEndSignalRegistry();

  function raiseConsult(callId, params, question) {
    const request = buildConsultRequest(callId, params, question);
    const { promise: ended } = endSignals.signalFor(callId);
    return Promise.race([
      callbacks.onConsultRaised(request).then((answer) => ({ via: "answer", answer })),
      ended.then((reason) => ({ via: "end", reason })),
    ]);
  }

  async function runOutcome(callId) {
    await callbacks.onOutcomeDelivered({ callId, connected: true, achieved: true, summary: OUTCOME_SUMMARY });
  }

  async function runConsult(callId, params) {
    const race = await raiseConsult(callId, params, CONSULT_QUESTION);
    endSignals.clear(callId);
    if (race.via === "end") {
      await callbacks.onOutcomeDelivered(outcomeFromEndedConsult(callId, race.reason));
      return;
    }
    await callbacks.onOutcomeDelivered(outcomeFromConsultAnswer(callId, race.answer));
  }

  async function runConsultTwice(callId, params) {
    const first = await raiseConsult(callId, params, CONSULT_QUESTION);
    if (first.via === "end") {
      endSignals.clear(callId);
      await callbacks.onOutcomeDelivered(outcomeFromEndedConsult(callId, first.reason));
      return;
    }
    const second = await raiseConsult(callId, params, CONSULT_QUESTION_SECOND);
    endSignals.clear(callId);
    if (second.via === "end") {
      await callbacks.onOutcomeDelivered(outcomeFromEndedConsult(callId, second.reason));
      return;
    }
    const facts = [...first.answer.facts, ...second.answer.facts];
    await callbacks.onOutcomeDelivered({
      callId,
      connected: true,
      achieved: true,
      summary: CONSULT_ANSWERED_PREFIX + facts.join(", "),
    });
  }

  async function runConsultConcurrent(callId, params) {
    const requestA = buildConsultRequest(callId, params, CONSULT_QUESTION);
    const requestB = buildConsultRequest(callId, params, CONSULT_QUESTION_SECOND);
    const answersByRequestId = new Map();
    await Promise.all([
      callbacks.onConsultRaised(requestA).then((answer) => answersByRequestId.set(requestA.requestId, answer)),
      callbacks.onConsultRaised(requestB).then((answer) => answersByRequestId.set(requestB.requestId, answer)),
    ]);
    const answerA = answersByRequestId.get(requestA.requestId);
    const answerB = answersByRequestId.get(requestB.requestId);
    const facts = [...answerA.facts, ...answerB.facts];
    await callbacks.onOutcomeDelivered({
      callId,
      connected: true,
      achieved: true,
      summary: CONSULT_ANSWERED_PREFIX + facts.join(", "),
    });
  }

  async function runNeverConnected(callId) {
    await callbacks.onOutcomeDelivered({
      callId,
      connected: false,
      neverConnectedReason: NEVER_CONNECTED_REASON,
      achieved: null,
      summary: NEVER_CONNECTED_SUMMARY,
    });
  }

  function runnerFor(objective) {
    if (objective === MOCK_OBJECTIVE.OUTCOME) return runOutcome;
    if (objective === MOCK_OBJECTIVE.CONSULT) return runConsult;
    if (objective === MOCK_OBJECTIVE.CONSULT_TWICE) return runConsultTwice;
    if (objective === MOCK_OBJECTIVE.CONSULT_CONCURRENT) return runConsultConcurrent;
    if (objective === MOCK_OBJECTIVE.NEVER_CONNECTED) return runNeverConnected;
    return null;
  }

  async function startConversation(params) {
    const { callId, objective } = params;
    if (objective === MOCK_OBJECTIVE.REJECT) {
      return { ok: false, reason: REJECT_REASON };
    }
    const runner = runnerFor(objective);
    if (runner) timers.schedule(callId, callbackDelayMs, () => runner(callId, params));
    return { ok: true };
  }

  async function endConversation({ callId, reason }) {
    timers.cancel(callId);
    endSignals.resolveWith(callId, reason);
  }

  return { startConversation, endConversation };
}
