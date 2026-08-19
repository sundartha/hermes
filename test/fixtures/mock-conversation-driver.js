// Attrappe fuer den Gespraechsfuehrungs-Vertrag (ConversationControl/ConversationCallbacks,
// src/conversation/conversation-ports.js). Kein echter Anbieter, kein Netz, keine
// Zugangsdaten - reine Fake-Infrastruktur fuer den lokalen Testlauf. Gegen diese Datei
// laeuft dieselbe Vertragspruefung (test/conversation-driver-contract.js), die spaeter der
// echte Adapter (GENAU EIN Adapter, s. conversation-ports.js) bestehen muss.
//
// Szenario-Steuerung ausschliesslich ueber StartConversationParams.objective
// (MOCK_OBJECTIVE, Testkonvention wie Stripe-Testkartennummern - importiert aus der
// Vertragspruefung, damit die Werte an genau einer Stelle stehen). Kein Zufall, keine
// Uhr als verstecktes Verhalten: gleiche Eingabe liefert immer dasselbe Ergebnis.

import { MOCK_OBJECTIVE } from "../conversation-driver-contract.js";

// Verzoegerung, mit der die Attrappe eingehende Laufwerk-Meldungen nachstellt (simuliert
// Asynchronitaet statt synchron innerhalb von startConversation zu feuern) - in
// Millisekunden steuerbar ueber den optionalen Parameter callbackDelayMs.
const DEFAULT_CALLBACK_DELAY_MS = 1;

const REJECT_REASON = "mock_abgelehnt";
const OUTCOME_SUMMARY = "Auftrag abgeschlossen (Attrappe-Laufwerk).";
const CONSULT_QUESTION = "Attrappe-Rueckfrage: passt der vorgeschlagene Termin?";
const CONSULT_QUESTION_SECOND = "Attrappe-Rueckfrage: reicht auch 15 statt 30 Minuten?";
const CONSULT_ANSWERED_PREFIX = "Antwort erhalten: ";
const CONSULT_UNANSWERED_PREFIX = "Keine Antwort erhalten: ";
const ENDED_MID_CONSULT_PREFIX = "Vom Auftraggeber beendet, bevor eine Antwort eintraf: ";
// Deterministisch EIN Wert aus dem Bestandsvokabular (telephony/failure-reason.js) - die
// Attrappe simuliert kein echtes Klingeln, sie pinnt nur, dass das Feld befuellt und aus
// dieser Menge ist.
const NEVER_CONNECTED_REASON = "no-answer";
const NEVER_CONNECTED_SUMMARY = "Niemand hat abgenommen (Attrappe-Laufwerk).";

let requestSequence = 0;

// Kennung EINER konkreten Rueckfrage (Befund 1) - fortlaufend statt zufaellig, damit die
// Attrappe deterministisch bleibt.
function nextRequestId(callId) {
  requestSequence += 1;
  return `${callId}-req-${requestSequence}`;
}

// Befund 4: der bisherige Gespraechsverlauf, den JEDE Rueckfrage-Anfrage mitliefern muss.
// Die Attrappe nutzt den tatsaechlich uebergebenen Offenlegungssatz als ersten Eintrag -
// naeher an einem echten Transkript als ein rein erfundener Platzhalter. NIE leer (V5): der
// Offenlegungssatz ist immer schon gesprochen, bevor ueberhaupt eine Rueckfrage entstehen kann.
function buildTranscriptSoFar(params) {
  return [params.disclosureSentence, "Ja, ich hoere."];
}

// Baut EINE Rueckfrage-Anfrage mit frischer requestId (Befund 1). Eigene Funktion statt
// Inline-Objekt, weil sowohl die sequenzielle als auch die gleichzeitige Rueckfrage-Szenario-
// Funktion sie brauchen.
function buildConsultRequest(callId, params, question) {
  return {
    callId,
    requestId: nextRequestId(callId),
    question,
    transcriptSoFar: buildTranscriptSoFar(params),
  };
}

// Baut aus einer beantworteten, abgelehnten oder verstrichenen Rueckfrage das
// ConversationOutcome, das die Attrappe fuer MOCK_OBJECTIVE.CONSULT anschliessend meldet.
// Zeitablauf/Ablehnung sind ein gueltiges Ergebnis (achieved:null), niemals achieved:false.
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

// Befund 3: wird endConversation aufgerufen, waehrend eine Rueckfrage noch offen haengt,
// darf die Attrappe NICHT laenger auf die (dann nie mehr relevante) Antwort warten - sie
// schliesst stattdessen sofort mit einem Ergebnis ab, dessen summary den Abbruchgrund
// erkennbar traegt.
function outcomeFromEndedConsult(callId, endReason) {
  return { callId, connected: true, achieved: null, summary: ENDED_MID_CONSULT_PREFIX + endReason };
}

// Pro Unterhaltung EIN geplanter Callback-Aufruf (Timer-Handle). endConversation storniert
// ihn, statt ihn nach dem Ende noch zuzustellen. Eigene Registry statt Inline-Map, damit
// makeMockConversationDriver selbst kurz bleibt (G30/max-lines-per-function).
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

// Pro Unterhaltung mit einer OFFENEN Rueckfrage EIN Abbruch-Signal (Befund 3):
// endConversation loest es aus, damit eine wartende Rueckfrage nicht auf eine Antwort
// haengen bleibt, die nach dem Ende noch eintreffen koennte.
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

/**
 * Baut eine Attrappe von ConversationControl. callbacks ist die (hier vom Aufrufer
 * gestellte) ConversationCallbacks-Implementierung, die die Attrappe bei Bedarf ansteuert.
 * @param {{ callbacks: import("../../src/conversation/conversation-ports.js").ConversationCallbacks,
 *           callbackDelayMs?: number }} deps
 * @returns {import("../../src/conversation/conversation-ports.js").ConversationControl}
 */
export function makeMockConversationDriver({ callbacks, callbackDelayMs = DEFAULT_CALLBACK_DELAY_MS }) {
  const timers = createTimerRegistry();
  const endSignals = createEndSignalRegistry();

  // Stellt EINE Rueckfrage und liefert entweder die Antwort ODER, falls waehrenddessen
  // endConversation eintrifft, das Abbruch-Signal - je nachdem, was zuerst eintrifft. So
  // wartet die Attrappe NIE laenger auf eine Antwort, als das Gespraech tatsaechlich lebt.
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

  // Befund 1 (Nachfassrunde): zwei Rueckfragen GLEICHZEITIG offen - beide Aufrufe starten,
  // OHNE dass der erste auf seine Antwort wartet. Die Zuordnung der eintreffenden Antworten
  // laeuft ueber eine mit requestId indizierte Map, NICHT ueber die Reihenfolge, in der die
  // Antworten eintreffen (die kann von der Stellreihenfolge abweichen - genau das prueft der
  // zugehoerige Vertragsfall aktiv, mit vertauschter Ankunftsreihenfolge).
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

  // Waehlt die Szenario-Funktion je exaktem objective-Wert - reine Zuordnung, kein
  // Verhalten (haelt startConversation selbst kurz, G30).
  function runnerFor(objective) {
    if (objective === MOCK_OBJECTIVE.OUTCOME) return runOutcome;
    if (objective === MOCK_OBJECTIVE.CONSULT) return runConsult;
    if (objective === MOCK_OBJECTIVE.CONSULT_TWICE) return runConsultTwice;
    if (objective === MOCK_OBJECTIVE.CONSULT_CONCURRENT) return runConsultConcurrent;
    if (objective === MOCK_OBJECTIVE.NEVER_CONNECTED) return runNeverConnected;
    return null; // MOCK_OBJECTIVE.SILENT und jedes unbekannte objective: bewusst kein Callback
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
