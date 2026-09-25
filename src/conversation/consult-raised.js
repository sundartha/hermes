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
// unsere Antwort seinem Modell als Werkzeug-Ergebnis vor. Zeitablauf ist ein GUELTIGES
// Ergebnis, kein Fehler - Muster ConsultDelivery.waitForEvent, aus dem auch die
// Tick-Kadenz kommt.
//
// P2 (W2): der Halt ist GESTAFFELT, nicht pauschal, und das ist KEINE Verletzung von G5
// ("EINE Frist, nicht zwei"): die drei Fristen beantworten drei VERSCHIEDENE Fragen
// ("kommt die Frage bei einem Client an?", "arbeitet dort jemand daran?", "wie lautet die
// Antwort?"), nicht dieselbe Frage zweimal. CONSULT_OPEN_MS bleibt unveraendert der Wert
// des MCP-Long-Poll-Wegs (E-5) und wird von dieser Datei nicht mehr gelesen.
//
// P3 (N-10): der gestaffelte Abbruch liefert zusaetzlich eine INHALTSFREIE Spur
// (abortTrace) mit - sie ist die Messung, die am 06.09. fehlte und deren Fehlen die
// Aufklaerung auf eine Zeugenaussage angewiesen liess. Sie verlaesst den Server NICHT
// Richtung Anbieter (consultResponseBody baut seine drei Felder ausdruecklich selbst).
//
// STOP-PRAEDIKAT ist die EIGENE Rueckfrage, nicht "irgendeine offene": store.pendingConsult
// wuerde sofort auf die gerade selbst gestellte Frage ansprechen (Port-Befund 1) und der
// Aufruf kaeme mit leeren Haenden zurueck. Gewartet wird deshalb auf GENAU DEN Datensatz,
// den dieser Aufruf angelegt hat, wiedererkannt an seiner Kennung.
import { config } from "../config.js";
import { CONSULT_POLL_TICK_MS } from "../consult/delivery.js";
import { sanitizeConsultQuestion } from "../consult/question.js";
import { CONSULT_STATUS, CONSULT_TIMEOUT_REASON } from "../store/defaults.js";
// EL-NEUSTART-9: die Schliessung MIT Verwaisungs-Marker. Direkt aus state-ops, wie das
// Boot-Netz sie ruft (src/boot.js) - die Fassade fuehrt diese Operation nicht, und eine
// zweite, eigene Formulierung im Drain waere genau der zweite Mechanismus, den der
// Kosten-Riegel nicht vertraegt (s. closeOrphaned).
import { expireOrphanedConsults } from "../store/state-ops.js";

// Ergebnis-Diskriminator (ConsultAnswer.kind): feste Menge statt Freitext - "abgelehnt"
// und "niemand hat geantwortet" sind fuer das Produkt zwei verschiedene Lagen.
export const CONSULT_RESULT = Object.freeze({
  ANSWERED: "answered",
  REJECTED: "rejected",
  TIMEOUT: "timeout",
});

// P2 (W2): die drei Fristen des gestaffelten Halts, ABSOLUT ab Entstehung der Rueckfrage.
// ackDeadlineMs ist die SUMME (die Spec nennt Stufe 1 "zusaetzlich"), damit im Code nur
// noch absolute Grenzen stehen und keine Stelle zweimal addiert.
export const EL_CONSULT_STAGES = Object.freeze({
  deliveryDeadlineMs: config.tenancy.elConsultDeliveryMs,
  ackDeadlineMs: config.tenancy.elConsultDeliveryMs + config.tenancy.elConsultAckMs,
  answerDeadlineMs: config.tenancy.elConsultAnswerMs,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// facts ist NIE undefined - der Aufrufer darf es unabhaengig vom Ausgang iterieren.
const rejected = (reason) => ({ kind: CONSULT_RESULT.REJECTED, facts: [], reason });
// P3 (N-10): abortTrace ist NUR beim gestaffelten Abbruch gesetzt (E-2) - Drain, Call-Ende
// und "Consult verschwunden" sind KEINE gescheiterten Rueckfragen dieses Halts und tragen
// weiterhin null. Der Diskriminator ist damit strukturell, nicht ein Zeichenketten-Vergleich
// auf reason beim Aufrufer.
const timedOut = (reason, abortTrace = null) => ({
  kind: CONSULT_RESULT.TIMEOUT,
  facts: [],
  reason,
  abortTrace,
});

// P2: WELCHE Stufe hat ihr Ziel verfehlt? REIN - kein Store-Zugriff, kein Schreiben, keine
// Uhr. Genau deshalb ist der Fristnachweis ohne Server pruefbar (test/el-consult-
// staffelung.test.js). Eine Aufgabe, eine Abstraktionsebene (G30/G34).
//
// I-7: die Reihenfolge ist bindend, und die GESAMTFRIST steht zuletzt OHNE Vorbedingung.
// Es gibt damit keinen Pfad, auf dem eine Stufe die naechste ueberspringt und laenger
// haelt als answerDeadlineMs - egal, welche Marker fehlen.
// E-3: geprueft wird nur das FEHLEN des Markers. Ein Client, der ohne Vorab-Quittung
// direkt antwortet, wird von diesem Praedikat nie erreicht - der ANSWERED-Zweig im
// Wartelauf liegt davor.
// P3: Zeitspanne zwischen zwei ISO-Stempeln in ms. null, wo die Stufe nie erreicht wurde
// (fehlender Stempel) oder ein Stempel unlesbar ist - fail-closed nach dem Muster von
// consultAgeMs/consultAlive (state-ops): lieber KEIN Wert als ein erfundener. Genau dieser
// null-Fall ist die Aussage "Stufe nicht erreicht", die die Kalibrierung braucht.
function spanMs(vonIso, bisIso) {
  const von = Date.parse(vonIso ?? "");
  const bis = Date.parse(bisIso ?? "");
  return Number.isFinite(von) && Number.isFinite(bis) ? bis - von : null;
}

// P3 (N-10): die INHALTSFREIE Spur eines gescheiterten Halts - genau die Kennung und die
// drei Zahlen, aus denen die vorlaeufigen Fristen von Stufe 0/1 nachkalibriert werden
// (PLAN-ANRUFDEFEKTE P2, "Herleitung der Zahlen"). Der GRUND steht nicht hier: er steht am
// Ergebnis selbst (reason) und wird nicht verdoppelt (G5).
// Was hier NIE hineingehoert: Fragetext, Antworttext, Rufnummer, Transkriptfragment
// (Absolute Regel 4/5). holdMs kommt von der Wanduhr DES WARTERS (startedAtMs), nicht aus
// askedAt - dieselbe Quelle, gegen die auch die Fristen gemessen werden.
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

// PII-frei (Absolute Regel 4): server-eigene Kennungen und die Fristen, NIE die Frage, nie
// eine Nummer, nie ein Stueck Gespraechsinhalt. Muster logConsultAsked (consult/in-call.js).
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

/**
 * @param {{store: object, isDraining?: () => boolean, stages?: object, tickMs?: number}} deps
 *   stages/tickMs sind TEST-OVERRIDES nach dem Repo-Idiom von makeConsultDelivery; die
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
  stages = EL_CONSULT_STAGES,
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

  // EL-NEUSTART-9: die Rueckfrage schliessen UND ihren Kontingent-Platz freigeben. Der
  // Wartende stirbt hier gleich mit dem Prozess, waehrend seine Haltefrist noch laeuft -
  // diese Rueckfrage hat KEINE Gespraechszeit gekostet, ihr Platz muss frei werden
  // (consultQuotaUsed liest den Marker orphanedAt). Das Netz beim Start kann ihn nicht
  // nachtragen: es sucht ueber pendingConsult und sieht damit nur OFFENE Datensaetze -
  // diesen hier hat der Drain selbst geschlossen. Ohne den Marker bliebe der Platz nach
  // JEDEM Deploy verbraucht, und ein beim Anbieter weiterlaufender Anruf koennte nie
  // wieder rueckfragen.
  //
  // Die Unterscheidung "verwaist" gegen "abgelaufen, weil niemand antwortete" trifft die
  // Naht selbst, an derselben Wanduhr wie beim harten Abbruch - die Frist ist die
  // Gesamtfrist, die maximale Lebensdauer eines Warters (G5, keine zweite Zahl). Im
  // Zweifel gilt BEZAHLT, dann bleibt der Platz verbraucht. Geschrieben wird nach dem
  // mutate-then-save()-Muster des Boot-Netzes; das Zeitfenster des Drains bleibt gewahrt,
  // weil zwischen load(), Mutation und save() kein await liegt.
  function closeOrphaned(callId, nowMs) {
    const { changed } = expireOrphanedConsults(store.load(), callId, {
      nowMs,
      openMs: stages.answerDeadlineMs,
    });
    if (changed) store.save();
  }

  async function awaitAnswer({ callId, consultId }) {
    // Die eigene Wanduhr des Warters, wie bisher - NICHT consult.askedAt: der Datensatz
    // wird Sekundenbruchteile frueher gestempelt, und ein Date.parse an dieser Stelle
    // waere eine zweite, brechbare Zeitquelle im heissen Pfad.
    const startedAtMs = Date.now();
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
      const nowMs = Date.now();
      const ageMs = nowMs - startedAtMs;
      // P2: EIN Praedikat entscheidet ueber alle drei Stufen (expiredStage, rein). Der
      // Datensatz wird beim Abbruch geschlossen UND traegt den Grund - ein offener
      // Datensatz ohne Zustellweg ist ein Phantom (E-2): eine spaetere Antwort auf ihn
      // wird von answerConsult danach zuverlaessig abgelehnt, statt still zu gelingen.
      const stage = expiredStage(consult, ageMs, stages);
      if (stage) {
        store.timeOutStagedConsult(callId, {
          consultId,
          reason: stage.reason,
          nowMs,
          stageMs: stage.stageMs,
        });
        // P3: dieselbe Zahl, gegen die die Stufe entschieden wurde, ist die tatsaechlich
        // gehaltene Dauer - keine zweite Messung daneben (G5).
        return timedOut(stage.reason, makeAbortTrace(consult, ageMs));
      }
      // EL-BEFUND-4: Drain-Freigabe, gleiche Stelle und gleicher Grund wie in
      // ConsultDelivery.waitForEvent. Ohne sie haelt dieser Warter beim Deploy
      // httpServer.close() bis zur Gesamtfrist auf, der Shutdown-Watchdog kappt mit
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
      //
      // EL-NEUSTART-9: geschlossen wird MIT Verwaisungs-Marker (closeOrphaned) - dieselbe
      // Naht wie beim harten Abbruch, kein zweiter Mechanismus.
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
    logConsultRaised(callId, consult.id, stages);
    return awaitAnswer({ callId, consultId: consult.id });
  };
}
