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
export function makeCallLifecycle({
  store,
  config,
  finishCall, // = callFinish.finishCall (INV-7: gleiche Referenz wie bridge/ingest)
  releaseReserve, // = callFinish.releaseReserve
  voiceControl,
  terminateAndBillCall,
  hangUpAction,
  billThunk,
  reattachActiveCallCore, // reattachActiveCall aus ./reattach.js
  cappedEndedAtMs,
  classifyCallTime,
}) {
  // Gemeinsame Call-Max-Dauer in ms (G5): armMaxDurationTimer UND der Reserve-Backstop-Timer
  // teilen diese Rechnung (call-eigenes Limit vor globalem Default).
  function callMaxDurationMs(call) {
    return (call.maxDurationS || config.maxCallDurationS) * 1000;
  }

  // F10 (A6): der EINZIGE Terminalisierungspfad des Max-Dauer-Caps - kein zweiter Bucht-freier
  // Weg (K1/K2). Provider-aware ueber call.provider (P6a): ein Telnyx-Call wird ueber Telnyx
  // beendet, nicht ueber Twilio. Fuer Telnyx-Outbound ist dieser Cap der EINZIGE harte
  // Max-Dauer-Cap (TimeLimit-Honorierung unbestaetigt) - Absolute Regel Max-Dauer. Setzt den
  // gekappten End-Anker (cappedEndedAtMs, nie Boot-Zeit), beendet den Provider-Leg ZUERST
  // (awaited) und bucht die Voice-Minuten idempotent ERST DANACH ueber finishCall (billedAt-
  // Guard, F9) - via terminateAndBillCall (F10 Runde 2, G5: derselbe Helper wie cancel_call).
  // Waere die Reihenfolge umgekehrt, bliebe der Anruf beim Provider technisch live, waehrend
  // die Buchungskette (LLM-Roundtrip + SMS) laeuft - Verstoss gegen die Max-Dauer-Regel.
  // status: "completed" (Timer-Ablauf) oder "failed" (Boot-Zombie). Idempotent: nur aus
  // 'active' (ein zwischenzeitlich beendeter Call -> No-op). Self-swallowing (Muster
  // releaseReserve): ein Store-/IO-Fehler ist secret-frei geloggt (err.message), nie eine
  // unhandled rejection. Nebeneffekt (Terminalisierung + Buchung) im Namen (N7).
  async function terminateCappedCall(callId, providerCallSid, status) {
    try {
      const call = store.getCall(callId);
      if (call?.status !== "active") return;
      const endedAtIso = new Date(
        cappedEndedAtMs(call, Date.now(), config.maxCallDurationS),
      ).toISOString();
      await terminateAndBillCall({
        persistEnd: () => store.setCallEndedAt(callId, status, endedAtIso),
        // P6 (Befund 1): call ist frisch (getCall oben) -> Call-Control-Call (callControlId
        // gesetzt) wird via endCallViaCallControl beendet, TeXML/Twilio byte-identisch ueber
        // endCall(providerCallSid). Damit sind rearm/reattach/scheduleMaxDurationEnd AUTOMATISCH
        // korrekt (sie laufen alle hier durch; ihr twilioSid-Argument wird bei C-Telnyx ignoriert).
        hangUp: hangUpAction(voiceControl, call, providerCallSid),
        bill: billThunk(finishCall, store, callId), // bucht genau EINMAL (billedAt, F9), gekappt
        callId, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
      });
    } catch (e) {
      console.error("[max-duration] Terminalisierung fehlgeschlagen:", e.message);
    }
  }

  // F10 (A6): armiert den Max-Dauer-Cap. Nach ms feuert der EINE Terminalisierungspfad
  // (status "completed"). Liest den Call beim Feuern frisch (Guard in terminateCappedCall);
  // ein frueher beendeter Call -> No-op. terminateCappedCall schluckt eigene Fehler -> void.
  function scheduleMaxDurationEnd(call, providerCallSid, ms) {
    setTimeout(() => void terminateCappedCall(call.id, providerCallSid, "completed"), ms);
  }

  // Max-Dauer hart durchsetzen (Budget-Engine; Realtime macht das die Bridge). Duenner Wrapper
  // um scheduleMaxDurationEnd (F10) mit dem vollen call-Limit; alle Aufrufer (/voice/incoming,
  // place_call) bleiben byte-identisch verdrahtet.
  function armMaxDurationTimer(call, providerCallSid) {
    scheduleMaxDurationEnd(call, providerCallSid, callMaxDurationMs(call));
  }

  // OUT-05 (F2): Reserve-Release-Backstop. Unabhaengig vom Provider-completed-Callback gibt dieser
  // Timer die Reserve nach maxDur + Grace frei (schliesst den "Originate 200, Callback verloren"-
  // Fall). BEIDE Engines (KEIN realtime-Guard), NUR nach erfolgreichem Originate armiert. Idempotent
  // ueber call.reserveReleased -> ein frueherer finishCall macht den Timer zum No-op; kein Timer-
  // Handle-Tracking noetig (Stil wie armMaxDurationTimer). Liest den Call beim Feuern frisch.
  function armReserveReleaseTimer(call) {
    const delay = callMaxDurationMs(call) + config.reserveReleaseGraceMs;
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
  function reattachActiveCall(callId) {
    return reattachActiveCallCore(callId, {
      attachActiveCall: store.attachActiveCall,
      maxCallDurationS: config.maxCallDurationS,
      terminateCappedCall,
      scheduleMaxDurationEnd,
    });
  }

  // F10 (A6): Boot-Re-Arm der Max-Dauer-Timer. Ein Deploy/Restart toetet sonst den
  // In-Prozess-setTimeout jedes laufenden Calls -> der harte Max-Dauer-Cap (Absolute
  // Regel 1) waere nach jedem Boot weg. NUR Budget-Engine (realtime cappt in der
  // Bridge). Aktive Calls mit Restzeit -> Timer relativ zum ECHTEN Call-Start (nie
  // Boot-Zeit); Zombies (Restzeit<=0, Downtime > Max-Dauer) -> sofort ueber den EINEN
  // Terminalisierungspfad beenden (gekappt+gebucht, kein Phantom-active, K2/K3). Die
  // Zombie-Buchung laeuft async (finishCall) und blockiert den Boot nicht.
  function rearmActiveCallTimers() {
    if (config.voiceEngine === "realtime") return;
    const nowMs = Date.now();
    let reArmed = 0;
    let terminalized = 0;
    for (const call of store.load().calls.filter((c) => c.status === "active")) {
      // G5 (Review-Blocker Runde 2): dieselbe Klassifikation wie reattachActiveCall() (F12) -
      // ausgelagert nach state-ops.js, um die Restzeit-Verzweigung nicht zweimal zu pflegen.
      const { remaining, expired } = classifyCallTime(call, nowMs, config.maxCallDurationS);
      if (expired) {
        void terminateCappedCall(call.id, call.twilioSid, "failed");
        terminalized++;
      } else {
        scheduleMaxDurationEnd(call, call.twilioSid, remaining);
        reArmed++;
      }
    }
    if (reArmed || terminalized)
      console.log(
        `[rearm] aktive Calls beim Boot: ${reArmed} re-armed, ${terminalized} terminalisiert (Zombie)`,
      );
  }

  return { armMaxDurationTimer, armReserveReleaseTimer, reattachActiveCall, rearmActiveCallTimers };
}
