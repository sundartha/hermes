// ---- Rueckfrage aus dem laufenden Gespraech, angestossen vom Laufwerk ----------------
// Implementierung von ConversationCallbacks.onConsultRaised (conversation-ports.js):
// dieselbe Rueckfrage wie in consult/in-call.js, nur nicht mehr von der eigenen
// Turn-Schleife ausgeloest, sondern von einem eingehenden Webhook des Laufwerks. Zustand
// (call.consults), Gate (consult/gate.js) und Sanitisierung (consult/question.js) bleiben,
// wo sie sind - diese Datei setzt sie neu zusammen. Genau so steht es im Port-Befund:
// consultAvailableFor (consult/in-call.js) traegt TURN-SCHLEIFEN-Fakten, die es an einer
// Webhook-Aufhaengung nicht gibt; consultAllowedFor ist unveraendert wiederverwendbar und
// haengt an der Route, VOR dieser Datei.
//
// ES WIRD GEWARTET, und das ist der Unterschied zu AL-P14: der Werkzeug-Aufruf des
// Anbieters ist ein Frage-Antwort-Zyklus - das Laufwerk haelt seinen Request offen und legt
// unsere Antwort seinem Modell als Werkzeug-Ergebnis vor. Haltezeit ist CONSULT_OPEN_MS,
// exakt das Fenster, in dem store.answerConsult eine Antwort ueberhaupt noch annimmt
// (G5: EINE Frist, nicht zwei) und knapp unter dem response_timeout_secs der
// Agenten-Vorlage. Zeitablauf ist ein GUELTIGES Ergebnis, kein Fehler - Muster
// ConsultDelivery.waitForEvent, aus dem auch die Tick-Kadenz kommt.
//
// STOP-PRAEDIKAT ist die EIGENE Rueckfrage, nicht "irgendeine offene": store.pendingConsult
// wuerde sofort auf die gerade selbst gestellte Frage ansprechen (Port-Befund 1) und der
// Aufruf kaeme mit leeren Haenden zurueck. Gewartet wird deshalb auf GENAU DEN Datensatz,
// den dieser Aufruf angelegt hat, wiedererkannt an seiner Kennung.
import { CONSULT_POLL_TICK_MS } from "../consult/delivery.js";
import { CONSULT_OPEN_MS } from "../consult/in-call.js";
import { sanitizeConsultQuestion } from "../consult/question.js";
import { CONSULT_STATUS } from "../store/defaults.js";

// Ergebnis-Diskriminator (ConsultAnswer.kind): feste Menge statt Freitext - "abgelehnt"
// und "niemand hat geantwortet" sind fuer das Produkt zwei verschiedene Lagen.
export const CONSULT_RESULT = Object.freeze({
  ANSWERED: "answered",
  REJECTED: "rejected",
  TIMEOUT: "timeout",
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// facts ist NIE undefined - der Aufrufer darf es unabhaengig vom Ausgang iterieren.
const rejected = (reason) => ({ kind: CONSULT_RESULT.REJECTED, facts: [], reason });
const timedOut = (reason) => ({ kind: CONSULT_RESULT.TIMEOUT, facts: [], reason });

// PII-frei (Absolute Regel 4): server-eigene Kennungen und die Frist, NIE die Frage, nie
// eine Nummer, nie ein Stueck Gespraechsinhalt. Muster logConsultAsked (consult/in-call.js).
function logConsultRaised(callId, consultId, holdMs) {
  console.log(`[consult-raised] gestellt call=${callId} event=${consultId} offen_ms=${holdMs}`);
}

function keyFactsOf(call) {
  const context = call?.context;
  return Array.isArray(context?.key_facts) ? context.key_facts : [];
}

function consultById(call, consultId) {
  const chain = Array.isArray(call?.consults) ? call.consults : [];
  return chain.find((consult) => consult.id === consultId) || null;
}

/**
 * @param {{store: object, holdMs?: number, tickMs?: number}} deps
 *   holdMs/tickMs sind TEST-OVERRIDES nach dem Repo-Idiom von makeConsultDelivery; die
 *   Produktionsverdrahtung uebergibt sie nie.
 * @returns {(request: {callId: string, question: string}) => Promise<{kind: string,
 *   facts: string[], reason?: string}>} WIRFT NIE - jede erwartbare Ablehnung ist ein
 *   Ergebnis (kind), kein Reject.
 */
export function makeConsultRaised({
  store,
  holdMs = CONSULT_OPEN_MS,
  tickMs = CONSULT_POLL_TICK_MS,
}) {
  // Der Datensatz, den emitConsult gerade angelegt hat: emitConsult liefert den CALL
  // zurueck (Bestandsform beider Backends), die neue Rueckfrage ist das letzte Glied der
  // push-geordneten Kette. Zwischen Emission und Zugriff liegt kein await - es kann sich
  // kein fremder Consult dazwischenschieben.
  function raise(callId, question) {
    const call = store.emitConsult(callId, [question]);
    const chain = Array.isArray(call?.consults) ? call.consults : [];
    return chain.at(-1) || null;
  }

  // Die Fakten GENAU DIESER Antwort. Sie leben ausschliesslich in call.context.key_facts
  // (state-ops: der Consult-Datensatz traegt bewusst nur ihre ANZAHL, kein zweiter
  // Speicherort desselben Freitexts). answerConsult haengt sie hinten an - der vor der
  // Emission gemerkte Stand ist deshalb ihr Anfang.
  function answeredFacts(call, consult, factsOffset) {
    return keyFactsOf(call).slice(factsOffset, factsOffset + consult.answeredFacts);
  }

  async function awaitAnswer({ callId, consultId, factsOffset }) {
    const deadlineMs = Date.now() + holdMs;
    for (;;) {
      const call = store.getCall(callId);
      // Der Anruf ist vorbei -> es wartet niemand mehr auf eine Antwort. Ohne diesen
      // Zweig hielte der Webhook die Leitung des Laufwerks noch offen, waehrend Hermes
      // den Anruf laengst als beendet fuehrt (Port-Befund 3).
      if (!call || call.status !== "active") return timedOut("anruf_beendet");
      const consult = consultById(call, consultId);
      if (!consult) return timedOut("consult_verschwunden");
      if (consult.status === CONSULT_STATUS.ANSWERED)
        return { kind: CONSULT_RESULT.ANSWERED, facts: answeredFacts(call, consult, factsOffset) };
      // Nicht mehr offen und nicht beantwortet = abgelaufen/verfallen (expireOpenConsults,
      // Wartezeit-Schritt). Der Grund-Token ist der Status selbst, PII-frei.
      if (consult.status !== CONSULT_STATUS.OPEN) return timedOut(consult.status);
      if (Date.now() >= deadlineMs) return timedOut("frist_abgelaufen");
      await sleep(tickMs);
    }
  }

  return async function onConsultRaised({ callId, question }) {
    const call = store.getCall(callId);
    if (!call) return rejected("kein_anruf");
    // Der Zitat-Riegel und die Laengengrenze liegen in consult/question.js und werden
    // hier NICHT verdoppelt. Der Verlauf kommt aus dem Store-Datensatz, weil das Laufwerk
    // heute keinen mitschickt; sobald ConsultRequest.transcriptSoFar existiert, wird er
    // hier eingespeist - dann aber in der Form, die containsVerbatimQuote liest
    // ({role, text}-Zeilen). Eine Liste blosser Strings faellt dort lautlos durch jede
    // caller-Zeilen-Pruefung: fail-OPEN, ohne Fehler, ohne Warnung.
    const asked = sanitizeConsultQuestion(question, call.transcript);
    if (!asked) return rejected("frage_abgelehnt");
    const factsOffset = keyFactsOf(call).length;
    const consult = raise(callId, asked);
    if (!consult) return rejected("nicht_emittiert");
    logConsultRaised(callId, consult.id, holdMs);
    return awaitAnswer({ callId, consultId: consult.id, factsOffset });
  };
}
