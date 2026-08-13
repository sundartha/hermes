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
 * @param {{store: object, isDraining?: () => boolean, holdMs?: number, tickMs?: number}} deps
 *   holdMs/tickMs sind TEST-OVERRIDES nach dem Repo-Idiom von makeConsultDelivery; die
 *   Produktionsverdrahtung uebergibt sie nie.
 *   isDraining = das Drain-Signal des Consult-Kanals (consult/delivery.js). Default
 *   "nie" haelt jeden Bestands-Aufrufer unveraendert; die Produktionsverdrahtung reicht
 *   consultDelivery.isDraining herein (EIN Flag fuer alle Halter, G5).
 * @returns {(request: {callId: string, question: string}) => Promise<{kind: string,
 *   facts: string[], reason?: string}>} WIRFT NIE - jede erwartbare Ablehnung ist ein
 *   Ergebnis (kind), kein Reject.
 */
export function makeConsultRaised({
  store,
  isDraining = () => false,
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
  // (state-ops: der Consult-Datensatz traegt bewusst nur ihre LAGE - Startindex und
  // Anzahl -, kein zweiter Speicherort desselben Freitexts). Beide Zahlen setzt
  // answerConsult in DEMSELBEN synchronen Schritt, in dem es die Fakten anhaengt.
  //
  // NICHT am Rand nachgerechnet (Stand vor der Emission + Anzahl): addLookupFacts
  // (state-ops) haengt am SELBEN Anruf ebenfalls key_facts an - waehrend hier gewartet
  // wird. Ein nachgerechneter Offset lieferte dann fremde Suchtreffer als Antwort ins
  // laufende Gespraech. Fehlt die Lage (Fremd-/Altdatensatz), gibt es keine Fakten
  // statt falscher: fail-closed.
  function answeredFacts(call, consult) {
    const from = consult.answeredFactsFrom;
    if (!Number.isSafeInteger(from) || from < 0) return [];
    return keyFactsOf(call).slice(from, from + consult.answeredFacts);
  }

  async function awaitAnswer({ callId, consultId }) {
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
        return { kind: CONSULT_RESULT.ANSWERED, facts: answeredFacts(call, consult) };
      // Nicht mehr offen und nicht beantwortet = abgelaufen/verfallen (expireOpenConsults,
      // Wartezeit-Schritt). Der Grund-Token ist der Status selbst, PII-frei.
      if (consult.status !== CONSULT_STATUS.OPEN) return timedOut(consult.status);
      // EL-NEUSTART-6: der Fristablauf ist ein ZUSTAND, nicht bloss ein Ergebnis dieses
      // Aufrufs. Ohne diesen Schritt blieb der Datensatz OPEN stehen, obwohl niemand mehr
      // auf eine Antwort wartet: ein frischer Long-Poll bekaeme die tote Frage erneut
      // vorgelegt, answerConsult wiese die Antwort darauf als verfristet ab - und beim
      // naechsten Start waere eine BEZAHLTE abgelaufene Rueckfrage nicht von einer frisch
      // verwaisten zu unterscheiden (expireOrphanedConsults, src/boot.js).
      //
      // Derselbe Zustandsschritt wie in der Turn-Schleife der Budget-Engine
      // (consult/in-call.js -> advanceConsultWait) und derselbe Status timed_out: niemand
      // hat geantwortet, der Anruf ist NICHT beendet. Kein zweiter Schreibweg daneben.
      // waitMs IST hier holdMs: der Anbieter-Warter kennt keine kurze Ueberbrueckungsfrist,
      // er wartet die ganze Haltefrist. Erreichbar ist per Konstruktion ohnehin nur der
      // Fristablauf-Zweig - deadlineMs liegt nie vor askedAt + holdMs.
      const nowMs = Date.now();
      if (nowMs >= deadlineMs) {
        store.advanceInCallConsult(callId, { nowMs, waitMs: holdMs, openMs: holdMs });
        return timedOut("frist_abgelaufen");
      }
      // EL-BEFUND-4: Drain-Freigabe, gleiche Stelle und gleicher Grund wie in
      // ConsultDelivery.waitForEvent. Ohne sie haelt dieser Warter beim Deploy
      // httpServer.close() bis zu CONSULT_OPEN_MS auf, der Shutdown-Watchdog kappt mit
      // exit(0) - und der finale Store-Flush faellt aus (Datenverlust bei jedem Deploy).
      //
      // EL-NEUSTART-4: von den drei Beteiligten ueberlebt nur der DATENSATZ den Neustart -
      // der Warter stirbt hier gleich. Deshalb wird der Consult geschlossen, BEVOR
      // geantwortet wird: danach laeuft in diesem Prozess nichts mehr, was es noch tun
      // koennte. Ohne diesen Schritt legt der neu gestartete Dienst dieselbe Frage einem
      // frischen Poll erneut vor, und der Auftraggeber antwortete einem Wartenden, den es
      // nicht mehr gibt. Derselbe Mechanismus wie am Call-Ende (setCallEndedAt ->
      // expireOpenConsults) und derselbe Status: abgelaufen, NICHT beantwortet - diese
      // Frage hat nie eine Antwort bekommen. Das Zeitfenster des Drains bleibt gewahrt:
      // der Schreibweg ist synchron (json) bzw. reiht einen Flush ein (pg), die Antwort
      // geht unveraendert im selben Tick raus.
      if (isDraining()) {
        store.expireOpenConsults(callId);
        return timedOut("drain");
      }
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
    const consult = raise(callId, asked);
    if (!consult) return rejected("nicht_emittiert");
    logConsultRaised(callId, consult.id, holdMs);
    return awaitAnswer({ callId, consultId: consult.id });
  };
}
