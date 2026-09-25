// Call-Lifecycle (Server-Slim P5): Cap-Timer (Max-Dauer), Reserve-Release-Backstop,
// Re-Attach-Wrapper und Boot-Re-Arm. Reine Verschiebung aus server.js. Die Factory
// schliesst die injizierten Deps - KEIN eigener Import, KEINE zweite Instanz (INV-7).
// Konstruiert NACH callFinish (linearer DAG metering->call-finish->call-lifecycle):
// finishCall/releaseReserve kommen fertig gebunden herein (kein Lazy-Thunk, P15).
//
// INV-9 (Absolute Regel Max-Dauer): terminateCappedCall ist der EINZIGE Terminalisierungs-
// pfad des Caps - er beendet den Provider-Leg ZUERST (awaited) und bucht ERST DANACH,
// via terminateAndBillCall (unveraendert, in call-termination.js). rearmActiveCallTimers
// bleibt Boot-only; seine Aufrufposition in server.js (NACH allen exit1-Gates, VOR listen,
// INV-5) aendert sich durch die Extraktion NICHT.
import { callMaxDurationMs as computeMaxDurationMs } from "../call-duration.js";
import { MAX_CALL_DURATION_CAP_S } from "../store/defaults.js";
// TEIL B (Owner-Auftrag 15.08.2026): PURE (keine IO) -> direkter Import wie die drei oben,
// kein DI-Slot noetig (das Modul importiert bewusst nur Reines, s. Modul-Kopf "KEIN eigener
// Import" fuer STATEFULES - endActiveCall (die konkrete, laufzeitgebundene Implementierung)
// bleibt injiziert, s. makeCallLifecycle-Parameter unten).
import { elevenLabsHangUpAction, hangUpForCall, persistEndWithReason } from "./call-termination.js";
// IEL-B5 (E17): rein, direkter Import statt DI-Slot - jede Bestands-Konstruktion der Fabrik bleibt gueltig.
import { carrierEndMsOf } from "../store/state-ops.js";
// IE2: ebenfalls PURE (Zustand + Timer, alles IO injiziert) -> direkter Import wie die
// Reinen oben, kein DI-Slot in server.js noetig.
import { makeBudgetWatchdog } from "./budget-watchdog.js";
import { defaultSetTimer } from "../utils/timer.js";

// GAP-26: maschinenlesbarer Grund einer Terminalisierung DURCH DEN MAX-DAUER-CAP. Eigener
// Token neben der Provider-Vokabel aus telephony/failure-reason.js: die wird aus dem
// PROVIDER-Lifecycle abgeleitet (CallStatus/SIP-Cause) und hat fuer einen intern, vom
// Timer ausgeloesten Abbruch kein Gegenstueck - deshalb entsteht er hier, an seiner
// einzigen Quelle, statt als Sonderfall in einer Provider-Mapping-Funktion.
// Stabil und PII-frei: get_call_status reicht failure_reason unveraendert an MCP-Clients
// weiter; das Call-Widget rendert unbekannte Tokens roh (Diagnosewert, kein Bruch).
export const CAP_FAILURE_REASON = "max-duration-cap";

// KS-P1b: maschinenlesbarer Grund einer Terminalisierung DURCH DIE GELD-ACHSE. Eigener
// Token neben CAP_FAILURE_REASON aus derselben Ueberlegung (GAP-26): ohne ihn waere ein an
// der Decke gestorbener Anruf hinterher von einem am Zeit-Cap gestorbenen nicht zu
// unterscheiden. Stabil und PII-frei; get_call_status reicht failure_reason unveraendert an
// MCP-Clients weiter, das Call-Widget rendert unbekannte Tokens roh.
export const BUDGET_FAILURE_REASON = "budget-exhausted";

// IE2: der ANLASS einer Geld-Terminalisierung - welche Naht die Achse gefragt hat. EINE
// Logzeile, zwei Anlaesse: nie zwei Zeilen (oder zwei Labels) fuer denselben Sachverhalt.
// Der FAILURE-REASON am Record bleibt in beiden Faellen BUDGET_FAILURE_REASON (er reist
// ueber get_call_status zu MCP-Clients und behaelt seinen Wert).
export const BUDGET_TERMINATION_ORIGIN = Object.freeze({
  REATTACH: "re-attach",
  WATCHDOG: "wache",
});

// G25: Status eines Legs, das noch laeuft - benannt statt als Literal in den zwei NEUEN
// Lesestellen dieser Datei (Boot-Auswahl + die Abfrage der Geld-Wache). Modul-privat wie
// die gleichnamigen Konstanten in store/pg.js und store/state-ops.js.
const ACTIVE_CALL_STATUS = "active";

// Gemeinsame Call-Max-Dauer in ms: armMaxDurationTimer UND der Reserve-Backstop-Timer teilen
// dieselbe Rechnung (call-eigenes Limit vor Fallback). Die Formel selbst lebt in
// src/call-duration.js (G5: EINE Quelle innerhalb der Telephony-Schicht; state-ops.js#callLimitMs
// bleibt eine bewusst getrennte zweite Kopie, OQ-1); hier wird nur der Fallback gebunden.
//
// KS-P3: die Frist steht seit dieser Phase AM CALL (call.maxDurationS, beim Anlegen aus
// dem Restguthaben abgeleitet - Outbound im compute_reserve-Gate, Inbound in
// /voice/incoming). Der hier gebundene Wert ist nur noch der FALLBACK fuer Zeilen ohne
// eigene Frist (Calls, die den Deploy ueberlebt haben) und ist bewusst die absolute
// Obergrenze: MAX_CALL_DURATION_S als Operator-Knopf ist mit E2/E3 entfallen. Der
// Cap-Timer, der EINE Terminalisierungspfad (INV-9) und der Boot-Re-Arm sind unberuehrt.
//
// IE2: steht als REINE Funktion auf Modulebene statt im Fabrikrumpf - sie schliesst keine
// injizierte Abhaengigkeit ein, nur die Modul-Konstante (P15/G30).
function callMaxDurationMs(call) {
  return computeMaxDurationMs(call, MAX_CALL_DURATION_CAP_S);
}

// IE2: das Leg, wenn es noch laeuft - sonst null. EINE Formulierung fuer die Frage, die
// terminateActiveCall vor jedem Beenden stellt und die Geld-Wache in jeder Runde.
function runningLeg(call) {
  return call?.status === ACTIVE_CALL_STATUS ? call : null;
}

// IE2/G5: die EINE Zeile "welche Zeilen laufen noch" fuer BEIDE Boot-Re-Arms (Zeit-Achse
// und Geld-Achse) - vorher stand der Filter im Kopf der rearm-Schleife.
function activeCallsOf(store) {
  return store.load().calls.filter((call) => call.status === ACTIVE_CALL_STATUS);
}

// IE2: die GELD-Achse dieser Naht als EINE Einheit - das Praedikat (welche Achse sperrt
// gerade), der Vollzug (die eine Warnzeile + der eine Terminierungspfad), der
// wiederkehrende Takt und dessen Boot-Re-Arm. Eigene Einheit und nicht vier Glieder im
// Fabrikrumpf: der Rumpf verdrahtet, er formuliert nicht (G30), und die Geld-Achse ist
// damit an EINER Stelle lesbar statt zwischen den Zeit-Achse-Gliedern verteilt.
//
// terminateActiveCall kommt INJIZIERT herein: es bleibt der EINE Terminalisierungspfad
// (INV-9) im Fabrikrumpf, diese Einheit baut keinen zweiten. blockingBudgetAxis ebenfalls -
// es gibt weiterhin GENAU EINE Geld-Achse (budget-gate.js), hier nur gebunden (G5).
function makeBudgetAxisSeam({
  store, billing, blockingBudgetAxis, terminateActiveCall, intervalMs, setTimer,
}) {
  // Die EINE gebundene Geld-Achse dieser Naht: Re-Attach (F12) und die Geld-Wache (IE2)
  // fragen denselben Ausdruck, nicht zwei Kopien. tenantId kommt aus dem frisch geladenen
  // Call (I8: rowToCall hydriert ihn).
  function blockingAxisFor(call) {
    return blockingBudgetAxis({ store, billing, tenantId: call.tenantId });
  }

  // KS-P1b, Geld-Achse: ein Leg, dessen Guthaben aufgebraucht ist, wird beendet statt mit
  // frischer Frist weiterzulaufen. status "completed" (nicht "failed"): das Leg war
  // technisch gesund, wir haben es beendet - wie beim Timer-Ablauf; "failed" bleibt dem
  // Boot-Zombie vorbehalten. Die Logzeile ist Pflicht, nicht Kuer: ohne sie waere die
  // Terminalisierung im Betrieb voellig stumm (CLAUDE.md Regel 7). Nur die
  // server-generierte callId, kein PII.
  // IE2: seit dieser Phase gibt es ZWEI Anlaesse (Re-Attach und der wiederkehrende
  // Waechter) und weiterhin GENAU EINEN Weg, sie zu vollziehen - der Anlass reist als
  // Token mit (BUDGET_TERMINATION_ORIGIN), damit EINE Logzeile beide traegt. Objekt-
  // Argument statt eines dritten Positions-Werts (F1).
  async function terminateOverBudgetCall({ callId, providerCallSid, origin }) {
    console.warn(`[budget] ${origin}: Guthaben erschoepft (call=${callId}) -> terminalisiert`);
    await terminateActiveCall({
      callId, providerCallSid, status: "completed", failureReason: BUDGET_FAILURE_REASON,
    });
  }

  // EIN Waechter je Prozess: makeCallLifecycle wird genau einmal verdrahtet (INV-7), und
  // budget-watchdog.js ist PURE (Zustand + Timer, alles IO injiziert) - deshalb direkter
  // Import statt eines DI-Slots in server.js (Praezedenz elevenLabsHangUpAction/
  // persistEndWithReason). Eager konstruiert, kein Lazy-Init (P15).
  const watchdog = makeBudgetWatchdog({
    intervalMs,
    // Der Waechter kennt keinen Store: WELCHER Datensatz noch laeuft, entscheidet diese Naht.
    activeCallById: (callId) => runningLeg(store.getCall(callId)),
    blockingAxisFor,
    terminate: (call) =>
      terminateOverBudgetCall({
        callId: call.id,
        providerCallSid: call.twilioSid,
        origin: BUDGET_TERMINATION_ORIGIN.WATCHDOG,
      }),
    setTimer,
  });

  // Boot-Re-Arm der GELD-Achse - dieselbe Frage, die rearmActiveCallTimers fuer die
  // ZEIT-Achse stellt. Bewusst NICHT als Anhang dort: zwei Achsen, zwei Re-Arms, je eine
  // Aufgabe (G30). Die Takte leben als setTimeout im Prozess, ein Deploy nimmt sie mit, und
  // arm() faellt nur am Anrufstart bzw. am Re-Attach: ohne diesen Re-Arm haette ein
  // ueberlebendes Leg nur noch den Max-Dauer-Cap (Groessenordnung 1800 s) statt des Takts.
  // Setzt AUSSCHLIESSLICH Timer (INV-5 unberuehrt). Die Zeile erscheint nur, wenn wirklich
  // etwas gedeckt wurde (Muster rearmActiveCallTimers) und traegt nur Zahlen - kein PII.
  function rearmWatchdogs() {
    const { armedNow } = watchdog.rearm(activeCallsOf(store).map((call) => call.id));
    if (armedNow)
      console.log(
        `[budget] Boot-Re-Arm der Geld-Wache: ${armedNow} aktive Legs (Takt ${intervalMs} ms)`,
      );
  }

  return { blockingAxisFor, terminateOverBudgetCall, arm: watchdog.arm, rearmWatchdogs };
}

export function makeCallLifecycle({
  store,
  config,
  finishCall, // = callFinish.finishCall (INV-7: gleiche Referenz wie bridge/ingest)
  releaseReserve, // = callFinish.releaseReserve
  voiceControl,
  terminateAndBillCall,
  hangUpAction,
  billThunk, endActiveCall, // TEIL B: konkrete EL-Beende-Implementierung (elevenLabsOutbound.endActiveCall)
  awaitAndPersistInboundElResult, // IEL-B5 (E10): Ergebnis-Teil des Bruecken-Beende-Thunks (elevenLabsOutbound)
  reattachActiveCallCore, // reattachActiveCall aus ./reattach.js
  cappedEndedAtMs,
  classifyCallTime,
  blockingBudgetAxis, // KS-P1b: die EINE Geld-Achse (budget-gate.js), injiziert wie classifyCallTime
  // IE2: der Takt der Geld-Wache ist injizierbar, der Cap-Timer bewusst NICHT. Grund: der
  // Cap feuert EINMAL und ist von den Bestandstests ueber den Zombie-Pfad (Restzeit<=0,
  // sofortige Terminalisierung) erreichbar; ein WIEDERKEHRENDER Takt hat keinen solchen
  // Pfad - ohne injizierten Timer waere der Negativfall "Achse frei -> nichts passiert"
  // nur mit Wanduhr-Warten pruefbar (P12). Default = Produktionsverhalten.
  setBudgetWatchTimer = defaultSetTimer,
}) {
  // F10 (A6): der EINZIGE Terminalisierungspfad des Max-Dauer-Caps - kein zweiter Bucht-freier
  // Weg (K1/K2). Provider-aware ueber call.provider (P6a): ein Telnyx-Call wird ueber Telnyx
  // beendet, nicht ueber einen fremden Anbieter. Fuer Telnyx-Outbound ist dieser Cap der EINZIGE
  // harte Max-Dauer-Cap (TimeLimit-Honorierung unbestaetigt) - Absolute Regel Max-Dauer. Setzt den
  // gekappten End-Anker (cappedEndedAtMs, nie Boot-Zeit), beendet den Provider-Leg ZUERST
  // (awaited) und bucht die Voice-Minuten idempotent ERST DANACH ueber finishCall (billedAt-
  // Guard, F9) - via terminateAndBillCall (F10 Runde 2, G5: derselbe Helper wie cancel_call).
  // Waere die Reihenfolge umgekehrt, bliebe der Anruf beim Provider technisch live, waehrend
  // die Buchungskette (LLM-Roundtrip + SMS) laeuft - Verstoss gegen die Max-Dauer-Regel.
  // status: "completed" (Timer-Ablauf) oder "failed" (Boot-Zombie). Idempotent: nur aus
  // 'active' (ein zwischenzeitlich beendeter Call -> No-op). Self-swallowing (Muster
  // releaseReserve): ein Store-/IO-Fehler ist secret-frei geloggt (err.message), nie eine
  // unhandled rejection. Nebeneffekt (Terminalisierung + Buchung) im Namen (N7).
  // GAP-26: schreibt zusaetzlich den maschinenlesbaren Grund (CAP_FAILURE_REASON) an den
  // Record. Ohne ihn ist ein am Dauer-Cap gestorbener Anruf hinterher von jedem anderen
  // Abbruch ununterscheidbar - genau die Forensik-Luecke, die dieses Repo schon einmal Tage
  // gekostet hat. Der Cap selbst aendert sich dadurch NICHT (Absolute Regel Max-Dauer):
  // Reihenfolge, Idempotenz und der EINE Terminalisierungspfad bleiben unberuehrt.
  // recordFailureReason ist set-once (state-ops.js) -> ein spaeterer /voice/status-Callback
  // ueberschreibt den Cap-Grund nicht, und umgekehrt gewinnt ein bereits vom Provider
  // gemeldeter Grund.
  // KS-P1b: der Grund ist jetzt ein Parameter statt einer Konstante im Body - es gibt seit
  // dieser Phase ZWEI Anlaesse (Zeit-Cap und erschoepfte Decke) und genau EINEN Weg, sie zu
  // vollziehen. Reihenfolge, Idempotenz und der EINE Terminalisierungspfad (INV-9) sind
  // unberuehrt. Ein Objekt-Argument statt vier Positionen (F1).
  async function terminateActiveCall({ callId, providerCallSid, status, failureReason }) {
    try {
      const call = store.getCall(callId);
      if (call?.status !== "active") return;
      // IEL-B5 (E17): Carrier-Ende statt jetzt - im Nachlauf endet die Leitung am Marker.
      const endedAtIso = new Date(
        cappedEndedAtMs(call, carrierEndMsOf(call, Date.now()), MAX_CALL_DURATION_CAP_S),
      ).toISOString();
      await terminateAndBillCall({
        persistEnd: persistEndWithReason({ // G27/C2-Fix: EINE Formulierung statt Handarbeit
          store, callId, reason: failureReason,
          endCall: () => store.setCallEndedAt(callId, status, endedAtIso),
        }),
        // P6 (Befund 1): call ist frisch (getCall oben) -> Call-Control-Altbestand (callControlId
        // gesetzt) wird via endCallViaCallControl beendet, TeXML byte-identisch ueber
        // endCall(providerCallSid). Damit sind rearm/reattach/scheduleMaxDurationEnd AUTOMATISCH
        // korrekt (sie laufen alle hier durch; ihr twilioSid-Argument wird beim Altbestand ignoriert).
        // TEIL B: ein EL-Call traegt keins von beiden (elevenlabsConversationId statt) ->
        // hangUpAction liefert null, der EL-Beende-Versuch greift NUR dann (s. dort).
        // IEL-B5 (E10): GEBUNDEN -> Traeger auflegen + Ergebnis sichern (hangUpForCall).
        hangUp: hangUpForCall({
          call,
          hangUp: hangUpAction(voiceControl, call, providerCallSid) ?? elevenLabsHangUpAction(endActiveCall, call),
          awaitAndPersistInboundElResult,
        }),
        bill: billThunk(finishCall, store, callId), // bucht genau EINMAL (billedAt, F9), gekappt
        callId, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
      });
    } catch (err) {
      console.error("[max-duration] Terminalisierung fehlgeschlagen:", err.message);
    }
  }

  // Zeit-Achse. Signatur und Verhalten unveraendert - alle drei Aufrufer
  // (scheduleMaxDurationEnd, rearmActiveCallTimers, der Re-Attach-Kern) bleiben, wie sie sind.
  async function terminateCappedCall(callId, providerCallSid, status) {
    await terminateActiveCall({ callId, providerCallSid, status, failureReason: CAP_FAILURE_REASON });
  }

  // IE2: die GELD-Achse dieser Naht, EINMAL gebunden (volle Doku an makeBudgetAxisSeam).
  // Sie bekommt terminateActiveCall herein - es bleibt der EINE Terminalisierungspfad.
  const budgetAxis = makeBudgetAxisSeam({
    store, billing: config.billing, blockingBudgetAxis, terminateActiveCall,
    intervalMs: config.safety.budgetWatchdogIntervalMs, setTimer: setBudgetWatchTimer,
  });

  // F10 (A6): armiert den Max-Dauer-Cap. Nach ms feuert der EINE Terminalisierungspfad
  // (status "completed"). Liest den Call beim Feuern frisch (Guard in terminateCappedCall);
  // ein frueher beendeter Call -> No-op. terminateCappedCall schluckt eigene Fehler -> void.
  function scheduleMaxDurationEnd(call, providerCallSid, ms) {
    setTimeout(() => void terminateCappedCall(call.id, providerCallSid, "completed"), ms);
  }

  // Max-Dauer hart durchsetzen (Budget-Engine). Duenner Wrapper
  // um scheduleMaxDurationEnd (F10) mit dem vollen call-Limit; alle Aufrufer (/voice/incoming,
  // place_call) bleiben byte-identisch verdrahtet.
  function armMaxDurationTimer(call, providerCallSid) {
    scheduleMaxDurationEnd(call, providerCallSid, callMaxDurationMs(call));
    // IE2: dieselbe Naht armiert die GELD-Achse - hier und NICHT an den vier Aufrufern
    // (routes/voice.js, drei Zweige in routes/api-calls.js). Eine Sicherung, die jeder neue
    // Anrufweg selbst aufrufen muss, ist eine Sicherung per Konvention (G27); die erste
    // vergessene Zeile waere ein ungedeckter Anruf. Der Funktionsname ist historisch - bis
    // IE2 armierte er nur die Zeit-Achse; ein Rename beruehrt vier Aufrufer und einen
    // quelltext-pruefenden Bestandstest und ist eine eigene Entscheidung.
    budgetAxis.arm(call.id);
  }

  // OUT-05 (F2): Reserve-Release-Backstop. Unabhaengig vom Provider-completed-Callback gibt dieser
  // Timer die Reserve nach maxDur + Grace frei (schliesst den "Originate 200, Callback verloren"-
  // Fall). Jeder Outbound-Pfad, NUR nach erfolgreichem Originate armiert. Idempotent
  // ueber call.reserveReleased -> ein frueherer finishCall macht den Timer zum No-op; kein Timer-
  // Handle-Tracking noetig (Stil wie armMaxDurationTimer). Liest den Call beim Feuern frisch.
  function armReserveReleaseTimer(call) {
    const delay = callMaxDurationMs(call) + config.safety.reserveReleaseGraceMs;
    setTimeout(() => releaseReserve(store.getCall(call.id) || call), delay);
  }

  // F12 (A6): Ein Deploy-/Instanzwechsel kann einen laufenden Call aus dem Prozess-Spiegel
  // verlieren -> der Folge-/voice-Webhook (turn/outbound/status) saehe einen unbekannten Call
  // und legte fail-closed auf (real: Testanruf call_mr3lg2g7t9zg, 2026-07-02). Duenner Wrapper
  // um den ausgelagerten Re-Attach-Kern (telephony/reattach.js, volle Doku + Rueckgabe-Vertrag
  // dort): bindet store/config/terminateCappedCall/scheduleMaxDurationEnd EINMAL fuer ALLE DREI
  // /voice/*-Handler IDENTISCH (G5) - genau diese gemeinsame Bindung fehlte /voice/status bisher
  // (Runde 2, S1-1): es rief store.attachActiveCall DIREKT auf und reanimierte so ein Ueber-
  // Zeit-Leg OHNE Restzeit-Pruefung/Timer-Rearm. Vertraut NUR der DB (nie dem Request-Body);
  // sitzt strukturell HINTER app.use("/voice") (Provider-Signatur, Regel 1). Nebeneffekt
  // (Spiegel-Mutation + evtl. Terminalisierung/Cap-Rearm) im Namen (N7).
  async function reattachActiveCall(callId) {
    const result = await reattachActiveCallCore(callId, {
      attachActiveCall: store.attachActiveCall,
      maxCallDurationS: MAX_CALL_DURATION_CAP_S,
      terminateCappedCall, scheduleMaxDurationEnd,
      // KS-P1b: die Geld-Achse als gebundene Query (Muster der uebrigen Deps) - G5: derselbe
      // gebundene Ausdruck, den die Geld-Wache in jeder Runde fragt.
      budgetAxisFor: budgetAxis.blockingAxisFor,
      // IE2: reattach.js bleibt BYTE-IDENTISCH - der Anlass wird hier gebunden, nicht dort
      // durchgereicht (kein Vertragsbruch am Kern, keine Test-Aenderung an reattach).
      terminateOverBudgetCall: (id, providerCallSid) =>
        budgetAxis.terminateOverBudgetCall({
          callId: id, providerCallSid, origin: BUDGET_TERMINATION_ORIGIN.REATTACH,
        }),
    });
    // IE2: ein Leg, das der Prozess gerade erst wiedergefunden hat, war beim Boot-Re-Arm
    // NICHT im Spiegel (store/pg.js#attachActiveCallRow pusht die DB-Zeile erst hier hinein).
    // Ohne diese Zeile liefe genau der Anruf ohne Geld-Wache weiter, fuer den sie am
    // dringendsten gebraucht wird. Der Kern hat die Achse fuer DIESEN Moment schon gefragt;
    // armiert wird der wiederkehrende Takt. arm() ist idempotent -> der In-Flight-Coalescing-
    // Pfad (RACE-1) kann keine zwei Takte stellen.
    if (result.call) budgetAxis.arm(result.call.id);
    return result;
  }

  // F10 (A6): Boot-Re-Arm der Max-Dauer-Timer. Ein Deploy/Restart toetet sonst den
  // In-Prozess-setTimeout jedes laufenden Calls -> der harte Max-Dauer-Cap (Absolute
  // Regel 1) waere nach jedem Boot weg. Aktive Calls mit Restzeit -> Timer relativ zum
  // ECHTEN Call-Start (nie Boot-Zeit); Zombies (Restzeit<=0, Downtime > Max-Dauer) ->
  // sofort ueber den EINEN Terminalisierungspfad beenden (gekappt+gebucht, kein
  // Phantom-active, K2/K3). Die Zombie-Buchung laeuft async (finishCall) und blockiert
  // den Boot nicht.
  function rearmActiveCallTimers() {
    const nowMs = Date.now();
    let reArmed = 0;
    let terminalized = 0;
    for (const call of activeCallsOf(store)) {
      // G5 (Review-Blocker Runde 2): dieselbe Klassifikation wie reattachActiveCall() (F12) -
      // ausgelagert nach state-ops.js, um die Restzeit-Verzweigung nicht zweimal zu pflegen.
      const { remaining, expired } = classifyCallTime(call, nowMs, MAX_CALL_DURATION_CAP_S);
      if (expired) {
        void terminateCappedCall(call.id, call.twilioSid, "failed");
        terminalized++;
      } else {
        scheduleMaxDurationEnd(call, call.twilioSid, remaining);
        reArmed++;
      }
    }
    if (reArmed || terminalized)
      console.log(`[rearm] aktive Calls beim Boot: ${reArmed} re-armed, ${terminalized} terminalisiert (Zombie)`);
  }

  return {
    armMaxDurationTimer, armReserveReleaseTimer,
    reattachActiveCall,
    rearmActiveCallTimers,
    // IE2: der Boot-Re-Arm der GELD-Achse, unveraendert durchgereicht aus der Naht
    // (dort seine Begruendung). Aufgerufen in boot.js unmittelbar nach dem Cap-Re-Arm.
    rearmBudgetWatchdogs: budgetAxis.rearmWatchdogs,
  };
}
